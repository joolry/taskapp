// api/_lib.js — READ = Firestore snapshot only | WRITE = GAS then background rebuild
const crypto = require('crypto');
const cache = require('./_cache');
const store = require('./_store');
const { fromSnapshot, normDate } = require('./_snapServe');

const isRead = (fn) => /^(get|validate)/.test(fn);

const ALLOWED = new Set([
  'approveLeaveRequest', 'approveRegularization', 'cancelLeaveRequest', 'changePassword',
  'createDelegation', 'deactivateTask', 'deleteAnnouncement',
  'getAllAppConfigForFrontend', 'getAllData', 'getAllDelegations',
  'getAnalyticsSummary', 'getAnalyticsSummaryV2', 'getAnnouncements',
  'getAttendanceAnalytics', 'getAttendanceAnalyticsV2', 'getAttendanceStats',
  'getBootData', 'getChecklistAnalytics', 'getChecklistAnalyticsV2',
  'getDashboardStats', 'getDashboardStatsFresh',
  'getDelegationAnalytics', 'getDelegationAnalyticsV2',
  'getDeptTasks', 'getDoerList', 'getEMDashboard', 'getEMDoerDetail',
  'getEmployeeDetailV2', 'getEmployeeDirectory', 'getEmployeeStats',
  'getHolidayList', 'getIncrementAppraisals', 'getLeaveBalance',
  'getLeaveRequests', 'getLeaveSummary', 'getMusterGrid', 'getMusterReport',
  'getMyAttendance', 'getMyDelegatedOut', 'getMyDelegations', 'getMyProfile',
  'getPayroll', 'getPayrollSummary', 'getPerformanceReport', 'getRecentActivity',
  'getRegularizationRequests', 'getTaskHistory', 'getTaskSetup',
  'getTeamAttendanceStatus', 'getTeamChecklistToday', 'getTodayAttendanceStatus',
  'getTodayCelebrations', 'getTodayTasks', 'getTopPerformers',
  'getWeeklyCommitments', 'getWeeklyTasks',
  'managerCompleteDelegation', 'managerShiftDelegation', 'managerShiftTask',
  'markStaffAttendance', 'markTaskDone', 'markTeamTaskDone',
  'portalDeleteTask', 'portalGenerateChecklist', 'postAnnouncement',
  'recordCheckIn', 'recordCheckOut', 'requestDateRevision', 'requestLeave',
  'requestRegularization', 'saveIncrementAppraisal', 'saveNewTask',
  'savePayroll', 'saveWeeklyCommitment', 'transferChecklistTask',
  'updateCommitmentStatus', 'updateDelegationStatus',
  'updateEmployee', 'updateIncrementAppraisal',
  'updatePayrollStatus', 'validateGpsForAttendance',
  'getSnapshot', 'clientForceSync'
]);

// These MUST never wait on GAS when a snapshot exists
const SNAPSHOT_READS = new Set([
  // Dashboard / boot
  'getBootData', 'getAllData', 'getDashboardStats', 'getDashboardStatsFresh',
  'getTodayAttendanceStatus', 'getTodayCelebrations', 'getRecentActivity',
  // Checklist
  'getTodayTasks', 'getWeeklyTasks', 'getTaskHistory', 'getDeptTasks', 'getTaskSetup',
  'getTeamChecklistToday',
  // Delegation
  'getMyDelegations', 'getMyDelegatedOut', 'getAllDelegations',
  // Attendance & Leave
  'getMyAttendance', 'getTeamAttendanceStatus',
  'getLeaveBalance', 'getLeaveSummary', 'getLeaveRequests',
  'getRegularizationRequests',
  // Shared
  'getAnnouncements', 'getAllAppConfigForFrontend', 'getHolidayList', 'getDoerList'
]);

const SESSION_HOURS = 12;
const b64 = (b) => Buffer.from(b).toString('base64url');

function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [body, sig] = token.split('.');
  const exp = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p && p.email && Date.now() < p.exp ? p : null;
  } catch (e) { return null; }
}

async function callGas(action, args, retry) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 55000);
  try {
    const r = await fetch(process.env.GAS_URL, {
      method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, args, secret: process.env.GAS_SECRET })
    });
    return await r.json();
  } catch (e) {
    if (retry) return callGas(action, args, false);
    return {
      success: false,
      error: 'Server busy. Pehle check kar lo ki entry save hui ya nahi (Refresh), phir dobara karo.'
    };
  } finally { clearTimeout(t); }
}

let waitUntil = (p) => { p.catch(() => {}); };
try { waitUntil = require('@vercel/functions').waitUntil || waitUntil; } catch (e) {}

const MAX_LOOPS = 3;
let _syncTimer = null;

async function acquireSync() {
  const ref = store.metaRef('sync');
  return store.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const s = snap.exists ? snap.data() : {};
    const now = Date.now();
    const leaseAlive = s.syncing && (now - (s.syncStartedAt || 0) < store.LEASE_MS);
    if (leaseAlive) {
      tx.set(ref, { dirty: true }, { merge: true });
      return false;
    }
    // Lease expired or idle → take lock (clears stuck syncing:true)
    tx.set(ref, { syncing: true, syncStartedAt: now, dirty: false, lastError: '' }, { merge: true });
    return true;
  });
}

async function releaseSync() {
  const ref = store.metaRef('sync');
  return store.db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const s = snap.exists ? snap.data() : {};
    if (s.dirty) {
      tx.set(ref, { dirty: false, syncStartedAt: Date.now() }, { merge: true });
      return true;
    }
    tx.set(ref, { syncing: false, lastSyncAt: Date.now(), lastError: '' }, { merge: true });
    return false;
  });
}

async function runSync() {
  let stage = 'acquire';
  let acquired = false;
  let loops = 0;
  try {
    if (!(await acquireSync())) return { ran: false, queued: true };
    acquired = true;
    for (;;) {
      loops++;
      stage = 'getSnapshot';
      const snap = await callGas('getSnapshot', [], false);
      stage = 'validate';
      if (!snap || snap.success === false) {
        throw new Error((snap && snap.error) || 'getSnapshot failed');
      }
      stage = 'save';
      await store.saveSnapshot(snap);
      stage = 'release';
      if (!(await releaseSync())) break;
      if (loops >= MAX_LOOPS) {
        await store.metaRef('sync').set({ syncing: false, dirty: true }, { merge: true });
        break;
      }
    }
    return { ran: true, loops };
  } catch (e) {
    e.stage = stage;
    if (acquired) {
      await store.metaRef('sync').set({
        syncing: false,
        lastError: stage + ': ' + String(e.message || e)
      }, { merge: true }).catch(() => {});
    }
    throw e;
  }
}

/** Debounced rebuild for non-critical (dirty flag self-heal) */
function scheduleSync() {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    runSync().catch((e) => console.error('bg sync', e.message));
  }, 3000);
  waitUntil(new Promise((r) => setTimeout(r, 3500)));
}

/** Full rebuild from GAS — NEVER overwrite a good SNAP with empty/broken data */
async function rebuildAfterWrite() {
  try {
    await store.metaRef('sync').set({
      syncing: true, syncStartedAt: Date.now(), dirty: false, lastError: ''
    }, { merge: true });
  } catch (e) {}
  try {
    const snap = await callGas('getSnapshot', [], false);
    if (!snap || snap.success === false) {
      throw new Error((snap && snap.error) || 'getSnapshot failed');
    }
    // Guard: reject empty snapshot (protects UI from going blank)
    const doers = (snap.doers || []).length;
    const hasAny = doers > 0
      || (snap.checklistToday || []).length > 0
      || (snap.delegations || []).length > 0
      || (snap.attendance || []).length > 0;
    if (!hasAny) {
      throw new Error('getSnapshot returned empty payload — keeping previous SNAP');
    }
    await store.saveSnapshot(snap);
    await store.metaRef('sync').set({
      syncing: false, dirty: false, lastSyncAt: Date.now(), lastError: ''
    }, { merge: true });
  } catch (e) {
    console.error('rebuildAfterWrite', e.message);
    try {
      await store.metaRef('sync').set({
        syncing: false, dirty: true, lastError: String(e.message || e)
      }, { merge: true });
    } catch (e2) {}
  }
}


/** Instant patch SNAP after write.
 *  Compare-and-swap: the save only commits if nobody else saved in between; otherwise we re-read the
 *  newer snapshot and re-apply this change on top of it (so 10 people tapping "Done" together all stick).
 *  Clone first so a bad mutator cannot wipe the live SNAP. */
let _patchChain = Promise.resolve();   // writes on the SAME instance go one after another (no self-conflicts)
function patchSnap(mutator) {
  const run = _patchChain.then(() => patchOnce(mutator));
  _patchChain = run.catch(() => {});
  return run;
}
async function patchOnce(mutator) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const m = await store.getMeta();
      if (!m) return false;
      const live = await store.loadSnapshot(m);
      const snap = JSON.parse(JSON.stringify(live));
      const beforeDoers = (snap.doers || []).length;
      const ok = mutator(snap);
      if (!ok) return false;
      if (beforeDoers > 0 && !(snap.doers || []).length) {
        console.error('patchSnap refused: mutator cleared doers');
        return false;
      }
      snap.builtAt = new Date().toISOString();
      await store.saveSnapshot(snap, m.version);
      return true;
    } catch (e) {
      if (e && e.code === 'SNAP_CONFLICT') {            // another instance saved first → redo on top of theirs
        await new Promise(r => setTimeout(r, Math.random() * 25 * (attempt + 1)));
        continue;
      }
      console.error('patchSnap', e.message);
      return false;
    }
  }
  console.error('patchSnap: too many conflicts');
  return false;
}

function applyWritePatch(fn, clientArgs, gasResult, email) {
  return patchSnap((snap) => {
    if (!snap.delegations) snap.delegations = [];
    if (!snap.checklistToday) snap.checklistToday = [];
    if (!snap.attendance) snap.attendance = [];
    if (!snap.leaveRequests) snap.leaveRequests = [];
    if (!snap.regRequests) snap.regRequests = [];
    if (!snap.taskList) snap.taskList = [];

    const today = snap.today || new Date(Date.now() + 19800000).toISOString().slice(0, 10);
    const em = String(email || '').toLowerCase();
    const me = (snap.doers || []).find(d => String(d.email || '').toLowerCase() === em);
    const myCode = me ? String(me.emp_id || '') : '';
    const myName = me ? String(me.name || '') : '';
    const myDept = me ? String(me.department || '') : '';
    const nowTs = new Date(Date.now() + 19800000).toISOString().slice(0, 19).replace('T', ' ');   // IST, same clock as the sheet

    function findDel(taskId) {
      return snap.delegations.find(d => String(d.taskId) === String(taskId));
    }
    function patchDel(taskId, fields) {
      let hit = false;
      snap.delegations.forEach(d => {
        if (String(d.taskId) === String(taskId)) {
          Object.assign(d, fields);
          hit = true;
        }
      });
      return hit;
    }

    // ═══════════════ DELEGATION ═══════════════
    if (fn === 'createDelegation' && gasResult && (gasResult.success !== false) && gasResult.task_id) {
      const o = clientArgs[0] || {};
      snap.delegations.unshift({
        taskId: String(gasResult.task_id),
        task: String(o.task_desc || o.task || ''),
        status: 'Pending',
        delegatedBy: myCode,
        delegatedTo: String(o.delegated_to || ''),
        firstDate: String(o.first_date || ''),
        finalDate: String(o.first_date || o.final_date || ''),
        priority: String(o.priority || 'Normal'),
        remark: '',
        timestamp: nowTs
      });
      return true;
    }

    if (fn === 'managerCompleteDelegation') {
      return patchDel(clientArgs[0], {
        status: 'Completed',
        remark: String(clientArgs[1] || '')
      });
    }

    if (fn === 'updateDelegationStatus') {
      return patchDel(clientArgs[0], {
        status: String(clientArgs[1] || 'Completed'),
        remark: String(clientArgs[2] || '')
      });
    }

    if (fn === 'managerShiftDelegation') {
      const fields = { status: 'Shifted' };
      if (clientArgs[1]) fields.finalDate = String(clientArgs[1]);
      if (clientArgs[2]) fields.remark = String(clientArgs[2]);
      return patchDel(clientArgs[0], fields);
    }

    if (fn === 'requestDateRevision') {
      // staff asks new date — often stays Pending/Shifted with new finalDate pending approval
      const fields = {};
      if (clientArgs[1]) fields.finalDate = String(clientArgs[1]);
      if (clientArgs[1]) fields.status = 'Shifted';
      return patchDel(clientArgs[0], fields);
    }

    // ═══════════════ CHECKLIST ═══════════════
    // Today / Week / Team / History all read checklistToday + checklistRecent, so EVERY patch hits BOTH
    // (before: only checklistToday changed → Week & History kept showing the old Pending copy).
    const chkEach = (f) => {
      let hit = false;
      ['checklistToday', 'checklistRecent'].forEach(k => {
        if (Array.isArray(snap[k])) snap[k].forEach(t => { if (f(t)) hit = true; });
      });
      return hit;
    };
    const sameDay = (t, d) => !d || normDate(t.planned) === d;

    if (fn === 'markTaskDone') {
      // args: rowNum, occ, taskUid, taskName, taskPlanned, date, remarks   (also used to EDIT a remark)
      const rowNum = clientArgs[0];
      const taskUid = String(clientArgs[2] || '');
      const taskName = String(clientArgs[3] || '');
      const pd = normDate(clientArgs[4] || clientArgs[5] || '');
      const remark = clientArgs[6] == null ? null : String(clientArgs[6]);
      return chkEach(t => {
        const byUid = taskUid && String(t.taskId || t.uid || '') === taskUid;
        const byRow = taskName && String(t.task || '') === taskName && String(t.rowNum) === String(rowNum);
        if (!(byUid || byRow) || !sameDay(t, pd)) return false;
        if (t.status !== 'Done' || !t.actual) t.actual = nowTs;   // keep original completion time on remark edits
        t.status = 'Done';
        if (remark !== null) t.remark = remark;
        return true;
      });
    }

    if (fn === 'markTeamTaskDone') {
      // args: rowNum, occ, taskName, empId, date, remarks
      const rowNum = clientArgs[0];
      const taskName = String(clientArgs[2] || '');
      const empId = String(clientArgs[3] || '');
      const pd = normDate(clientArgs[4] || '');
      const remark = clientArgs[5] == null ? null : String(clientArgs[5]);
      if (!taskName && !empId) return false;
      return chkEach(t => {
        const matchName = !taskName || String(t.task || '') === taskName;
        const matchEmp = !empId || String(t.nameId || '') === empId;
        const matchRow = rowNum == null || rowNum === '' || String(t.rowNum) === String(rowNum);
        if (!(matchName && matchEmp && matchRow) || !sameDay(t, pd)) return false;
        if (t.status !== 'Done' || !t.actual) t.actual = nowTs;
        t.status = 'Done';
        if (remark !== null) t.remark = remark;
        return true;
      });
    }

    if (fn === 'transferChecklistTask') {
      // args: rowNum, occ, taskUid, taskName, taskPlanned, fromEmpId, toEmpId, reason
      const taskUid = String(clientArgs[2] || '');
      const taskName = String(clientArgs[3] || '');
      const pd = normDate(clientArgs[4] || '');
      const fromEmp = String(clientArgs[5] || '');
      const toEmp = String(clientArgs[6] || '');
      const reason = String(clientArgs[7] || '');
      return chkEach(t => {
        const byUid = taskUid && String(t.taskId || t.uid || '') === taskUid;
        const byName = taskName && String(t.task || '') === taskName && String(t.nameId || '') === fromEmp;
        if (!(byUid || byName) || !sameDay(t, pd)) return false;
        t.transferredTo = toEmp;
        t.transferBy = myCode || fromEmp;
        t.transferReason = reason;
        t.transferredAt = nowTs;
        return true;
      });
    }

    if (fn === 'managerShiftTask') {
      // args: taskId, empId, fromDate, toDate — move the checklist row to the new planned date
      const taskId = String(clientArgs[0] || '');
      const empId = String(clientArgs[1] || '');
      const toDate = String(clientArgs[3] || '');
      if (!taskId) return false;
      return chkEach(t => {
        if (String(t.taskId || t.uid || '') !== taskId) return false;
        if (empId && String(t.nameId || '') !== empId) return false;
        if (toDate) t.planned = toDate;
        return true;
      });
    }

    if (fn === 'saveNewTask' && gasResult && gasResult.success !== false) {
      const o = clientArgs[0] || {};
      const freq = String(o.frequency || o.freq || 'D');
      const sd = String(o.start_date || '').slice(0, 10);
      const tm = String(o.task_time || String(o.start_date || '').slice(11, 16) || '').slice(0, 5);
      const dm = sd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      // Same Day/Date text Code.gs writes to the Task List: "dd/MM/yyyy HH:mm:ss"
      const dayDate = (dm && tm.indexOf(':') > 0) ? dm[3] + '/' + dm[2] + '/' + dm[1] + ' ' + tm + ':00' : String(o.day_date || o.scheduled_time || '');
      const DN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      let weekDay = String(o.week_day || ''), monthDay = String(o.month_day || '');
      if (!weekDay && ['W', 'E1st', 'E2nd', 'E3rd', 'E4th', 'ELast'].indexOf(freq) > -1) {
        const dow = o.day_of_week !== undefined ? Number(o.day_of_week) : (dm ? new Date(Date.UTC(+dm[1], +dm[2] - 1, +dm[3], 12)).getUTCDay() : -1);
        weekDay = DN[dow] || '';
      }
      if (!monthDay && ['M', '2M', 'Q', '4M', 'H', 'Y'].indexOf(freq) > -1) {
        monthDay = String(o.day_of_month !== undefined ? Number(o.day_of_month) : (dm ? +dm[3] : ''));
      }
      snap.taskList.unshift({
        // Code.gs returns { task_uid } — the real id (a fake NEW-... id made Deactivate fail on new tasks)
        setupId: String((gasResult && (gasResult.task_uid || gasResult.setup_id || gasResult.task_id || gasResult.uid)) || ('NEW-' + Date.now())),
        task: String(o.task_name || o.task || ''),
        doerId: String(o.emp_id || o.doer_id || ''),
        doerName: String(o.emp_name || o.doer_name || ''),
        department: String(o.dept || o.department || ''),
        frequency: freq,
        weekDay: weekDay,
        monthDay: monthDay,
        dayDate: dayDate,
        status: (gasResult && gasResult.rows > 0) ? 'Sent' : 'Active',
        deleteRepeated: '',
        startDate: sd || today
      });
      return true;
    }

    if (fn === 'portalDeleteTask' || fn === 'deactivateTask') {
      const uid = String(clientArgs[0] || '');
      const before = snap.taskList.length;
      snap.taskList = snap.taskList.filter(t => String(t.setupId || '') !== uid);
      // Code.gs deletes these rows from the sheets, so drop them here too (match task id or its UID)
      const gone = (t) => String(t.uid || '') === uid || String(t.taskId || '') === uid || String(t.taskId || '').indexOf(uid + '_') === 0;
      snap.checklistToday = snap.checklistToday.filter(t => !gone(t));
      if (Array.isArray(snap.checklistRecent)) snap.checklistRecent = snap.checklistRecent.filter(t => !gone(t));
      return snap.taskList.length !== before || true;
    }

    // ═══════════════ ATTENDANCE ═══════════════
    if (fn === 'recordCheckIn') {
      const existing = snap.attendance.find(a => String(a.emp_id) === myCode && String(a.date) === today);
      const hhmm = nowTs.slice(11, 16);
      if (existing) {
        existing.check_in = hhmm;
        existing.status = existing.status || 'Present';
      } else {
        snap.attendance.push({
          att_id: 'CI-' + Date.now(),
          emp_id: myCode,
          emp_name: myName,
          dept: myDept,
          date: today,
          day: '',
          check_in: hhmm,
          check_out: '',
          total_hours: '',
          status: 'Present',
          check_in_device_ts: String(clientArgs[0] || nowTs),
          check_out_device_ts: ''
        });
      }
      return !!myCode;
    }

    if (fn === 'recordCheckOut') {
      const existing = snap.attendance.find(a => String(a.emp_id) === myCode && String(a.date) === today);
      const hhmm = nowTs.slice(11, 16);
      if (existing) {
        existing.check_out = hhmm;
        return true;
      }
      if (myCode) {
        snap.attendance.push({
          att_id: 'CO-' + Date.now(),
          emp_id: myCode,
          emp_name: myName,
          dept: myDept,
          date: today,
          check_in: '',
          check_out: hhmm,
          total_hours: '',
          status: 'Present',
          check_in_device_ts: '',
          check_out_device_ts: String(clientArgs[0] || nowTs)
        });
        return true;
      }
      return false;
    }

    if (fn === 'markStaffAttendance') {
      // args: records[] = [{ emp_id, status, check_in, check_out, ... }]
      const records = Array.isArray(clientArgs[0]) ? clientArgs[0] : [];
      let hit = false;
      records.forEach(rec => {
        const eid = String(rec.emp_id || '');
        const dt = String(rec.date || today);
        if (!eid) return;
        let row = snap.attendance.find(a => String(a.emp_id) === eid && String(a.date) === dt);
        if (!row) {
          row = { att_id: 'MS-' + Date.now() + '-' + eid, emp_id: eid, emp_name: String(rec.emp_name || ''), dept: String(rec.dept || ''), date: dt, check_in: '', check_out: '', total_hours: '', status: '' };
          snap.attendance.push(row);
        }
        if (rec.status != null) row.status = String(rec.status);
        if (rec.check_in != null) row.check_in = String(rec.check_in);
        if (rec.check_out != null) row.check_out = String(rec.check_out);
        hit = true;
      });
      return hit;
    }

    // ═══════════════ LEAVE ═══════════════
    if (fn === 'requestLeave') {
      const o = clientArgs[0] || {};
      const rid = String((gasResult && (gasResult.request_id || gasResult.id)) || ('LV-' + Date.now()));
      snap.leaveRequests.unshift({
        request_id: rid,
        emp_id: myCode,
        emp_name: myName,
        dept: myDept,
        leave_type: String(o.leave_type || o.type || ''),
        from_date: String(o.from_date || ''),
        to_date: String(o.to_date || ''),
        num_days: String(o.num_days || o.days || ''),
        reason: String(o.reason || ''),
        status: 'Pending',
        requested_at: nowTs,
        reviewed_by: '',
        reviewed_at: '',
        remark: ''
      });
      return true;
    }

    if (fn === 'approveLeaveRequest' || fn === 'updateLeaveStatus') {
      const rid = String(clientArgs[0] || '');
      const st = String(clientArgs[1] || 'Approved');
      const remark = String(clientArgs[2] || '');
      let hit = false;
      snap.leaveRequests.forEach(r => {
        if (String(r.request_id) === rid) {
          r.status = st;
          if (remark) r.remark = remark;
          r.reviewed_by = myName || myCode;
          r.reviewed_at = nowTs;
          hit = true;
        }
      });
      return hit;
    }

    if (fn === 'cancelLeaveRequest') {
      const rid = String(clientArgs[0] || '');
      let hit = false;
      snap.leaveRequests.forEach(r => {
        if (String(r.request_id) === rid) {
          r.status = 'Cancelled';
          hit = true;
        }
      });
      return hit;
    }

    // ═══════════════ REGULARIZATION ═══════════════
    if (fn === 'requestRegularization') {
      const o = clientArgs[0] || {};
      const rid = String((gasResult && (gasResult.reg_id || gasResult.id)) || ('RG-' + Date.now()));
      snap.regRequests.unshift({
        reg_id: rid,
        emp_id: myCode,
        emp_name: myName,
        dept: myDept,
        date: String(o.reg_date || o.date || ''),
        req_in: String(o.expected_in || o.req_in || ''),
        req_out: String(o.expected_out || o.req_out || ''),
        reason: String(o.reason || ''),
        status: 'Pending',
        remark: '',
        requested_at: nowTs
      });
      return true;
    }

    if (fn === 'approveRegularization') {
      const rid = String(clientArgs[0] || '');
      const st = String(clientArgs[1] || 'Approved');
      const remark = String(clientArgs[2] || '');
      let hit = false;
      snap.regRequests.forEach(r => {
        if (String(r.reg_id) === rid) {
          r.status = st;
          if (remark) r.remark = remark;
          hit = true;
        }
      });
      return hit;
    }

    // Unknown write → signal caller to rely on full rebuild only
    return false;
  });
}

// Writes that add/remove checklist rows in the sheets. The sheet is the truth, so after these we
// re-read just Checklist_Today + Task List (light GAS call) and patch the snapshot — Today, Week,
// Team, History and Task Setup all see the change at once, with real row numbers.
const CHECKLIST_WRITES = new Set(['saveNewTask', 'deactivateTask', 'portalDeleteTask', 'portalGenerateChecklist']);
async function refreshChecklistPart() {
  try {
    const part = await callGas('getSnapshotPart', [['checklistToday', 'taskList']], true);
    if (!part || part.success === false || !Array.isArray(part.checklistToday) || !Array.isArray(part.taskList)) return false;
    return await patchSnap((snap) => {
      // Guard: a failed sheet read comes back empty — never blank a good snapshot with it
      if (!part.checklistToday.length && (snap.checklistToday || []).length > 20) return false;
      if (!part.taskList.length && (snap.taskList || []).length > 20) return false;
      // Replace the dates the sheet just returned; KEEP older days already in checklistRecent
      // (before: checklistRecent was cut down to today → Week / History / past dates went empty).
      const fresh = new Set(part.checklistToday.map(r => normDate(r.planned)));
      const older = (snap.checklistRecent || []).filter(r => !fresh.has(normDate(r.planned)));
      snap.checklistToday = part.checklistToday;
      snap.checklistRecent = older.concat(part.checklistToday);
      snap.taskList = part.taskList;
      return true;
    });
  } catch (e) {
    console.error('refreshChecklistPart', e.message);
    return false;
  }
}

async function tryGlobalSnap(fn, args, email, meta) {
  if (!SNAPSHOT_READS.has(fn)) return undefined;
  if (process.env.SNAPSHOT !== 'on') return undefined;
  try {
    // Both Firestore reads in parallel (was one after the other = 2 round trips)
    const [m, st] = await Promise.all([store.getMeta(), store.getSyncState()]);
    if (!m) {
      waitUntil(runSync().catch(() => {}));
      return undefined; // first boot only — no snap yet
    }
    const snap = await store.loadSnapshot(m);
    const out = fromSnapshot(fn, args, email, snap);
    if (out !== undefined) {
      meta.cache = 'SNAP';
      meta.gasMs = 0;
      if (st.dirty && !st.syncing) scheduleSync();
      return out;
    }
  } catch (e) {
    console.error('[tryGlobalSnap]', e.message);
  }
  return undefined;
}

async function handle(fn, args, token, meta) {
  meta = meta || {};
  args = Array.isArray(args) ? args : [];

  if (fn === 'serverUptime') return callGas('serverUptime', [], true);

  if (fn === 'processLogin') {
    const r = await callGas('processLogin', [args[0], args[1]], false);
    if (r && r.success && r.user && r.user.email) {
      r.token = sign({
        email: String(r.user.email).toLowerCase(),
        exp: Date.now() + SESSION_HOURS * 3600e3
      });
      if (process.env.SNAPSHOT === 'on') {
        waitUntil(runSync().catch(() => {}));
      }
    }
    return r;
  }

  // Authenticated force snapshot rebuild (Refresh page button)
  if (fn === 'clientForceSync') {
    const s0 = verify(token);
    if (!s0) return { success: false, error: 'NOT_AUTHENTICATED' };
    try {
      await runSync();
    } catch (e) {
      console.error('clientForceSync', e.message);
    }
    // Return fresh boot-ish payload from new snap so UI can paint immediately
    const out = { success: true, synced: true };
    try {
      const snapOut = await tryGlobalSnap('getDashboardStatsFresh', [], s0.email, meta);
      if (snapOut && typeof snapOut === 'object') Object.assign(out, snapOut);
    } catch (e2) {}
    try {
      const tOut = await tryGlobalSnap('getTodayTasks', [null, null], s0.email, meta);
      if (Array.isArray(tOut)) out.todayTasks = tOut;
      else if (tOut && Array.isArray(tOut.tasks)) out.todayTasks = tOut.tasks;
    } catch (e3) {}
    meta.cache = 'SYNC';
    return out;
  }

  if (!ALLOWED.has(fn)) return { success: false, error: 'Unknown function' };

  const s = verify(token);
  if (!s) return { success: false, error: 'NOT_AUTHENTICATED' };

  const clientArgs = args.slice(0, -1);
  const gasArgs = clientArgs.concat([{ email: s.email }]);

  // ── READS: snapshot first; NEVER block UI on rebuild ────────────────────
  if (isRead(fn)) {
    const snapOut = await tryGlobalSnap(fn, clientArgs, s.email, meta);
    if (snapOut !== undefined) return snapOut;

    // Only non-SNAPSHOT_READS (analytics etc.) or first-ever miss → cache/GAS
    const run = async () => {
      const g = Date.now();
      const out = await callGas(fn, gasArgs, true);
      meta.gasMs = Date.now() - g;
      return out;
    };
    return cache.wrap(fn, clientArgs, s.email, run, meta);
  }

  // ── WRITES: GAS → instant SNAP patch → respond; full rebuild in background
  const g = Date.now();
  const r = await callGas(fn, gasArgs, false);
  meta.gasMs = Date.now() - g;
  meta.cache = 'WRITE';

  // Only touch SNAP if write succeeded
  const ok = r && r.success !== false && !r.error;
  if (ok) {
    try { await cache.bump(); } catch (e) {}
    // Instant row patch — primary path (no full getSnapshot)
    const patched = await applyWritePatch(fn, clientArgs, r, s.email);
    meta.snapPatched = !!patched;
    if (CHECKLIST_WRITES.has(fn)) meta.snapChecklist = await refreshChecklistPart();
    if (!patched && !(CHECKLIST_WRITES.has(fn) && meta.snapChecklist)) {
      // Unknown write type: careful full rebuild (guarded against empty)
      await rebuildAfterWrite();
      meta.snapRebuilt = true;
    }
    // NOTE: no automatic background full rebuild after patch —
    // it was wiping good SNAP when getSnapshot returned incomplete data.
    // Use /api/sync?force=1 for manual sheet edits.
  }

  return r;
}

module.exports = { handle, ALLOWED, runSync, store };
