// api/_lib.js — READ = Firestore snapshot only | WRITE = GAS then background rebuild
const crypto = require('crypto');
const cache = require('./_cache');
const store = require('./_store');
const { fromSnapshot } = require('./_snapServe');

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
  'updateCommitmentStatus', 'updateDelegationStatus', 'updateIncrementAppraisal',
  'updatePayrollStatus', 'validateGpsForAttendance',
  'getSnapshot'
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

/** After a write: rebuild snapshot NOW (bypass lock) so next read is fresh */
async function rebuildAfterWrite() {
  try {
    await store.metaRef('sync').set({
      syncing: true, syncStartedAt: Date.now(), dirty: false, lastError: ''
    }, { merge: true });
  } catch (e) {}
  try {
    const snap = await callGas('getSnapshot', [], false);
    if (snap && snap.success !== false) {
      await store.saveSnapshot(snap);
      await store.metaRef('sync').set({
        syncing: false, dirty: false, lastSyncAt: Date.now(), lastError: ''
      }, { merge: true });
      return;
    }
    throw new Error((snap && snap.error) || 'getSnapshot failed');
  } catch (e) {
    console.error('rebuildAfterWrite', e.message);
    try {
      await store.metaRef('sync').set({
        syncing: false, dirty: true, lastError: String(e.message || e)
      }, { merge: true });
    } catch (e2) {}
  }
}


/** Instant patch SNAP after write — no GAS getSnapshot wait */
async function patchSnap(mutator) {
  try {
    const m = await store.getMeta();
    if (!m) return false;
    const snap = await store.loadSnapshot(m);
    const ok = mutator(snap);
    if (!ok) return false;
    snap.builtAt = new Date().toISOString();
    await store.saveSnapshot(snap);
    return true;
  } catch (e) {
    console.error('patchSnap', e.message);
    return false;
  }
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
    const nowTs = new Date().toISOString().slice(0, 19).replace('T', ' ');

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
    if (fn === 'markTaskDone') {
      // args: rowNum, occ, taskUid, taskName, taskPlanned, date, remarks
      const rowNum = clientArgs[0];
      const taskUid = String(clientArgs[2] || '');
      const taskName = String(clientArgs[3] || '');
      const planned = String(clientArgs[4] || clientArgs[5] || '');
      let hit = false;
      snap.checklistToday.forEach(t => {
        const byUid = taskUid && String(t.taskId || t.uid || '') === taskUid;
        const byRow = taskName && String(t.task || '') === taskName && String(t.rowNum) === String(rowNum);
        if (byUid || byRow) {
          t.status = 'Done';
          t.actual = planned || today;
          hit = true;
        }
      });
      return hit;
    }

    if (fn === 'markTeamTaskDone') {
      // args: rowNum, occ, taskName, empId, date, remarks
      const rowNum = clientArgs[0];
      const taskName = String(clientArgs[2] || '');
      const empId = String(clientArgs[3] || '');
      let hit = false;
      snap.checklistToday.forEach(t => {
        const matchName = !taskName || String(t.task || '') === taskName;
        const matchEmp = !empId || String(t.nameId || '') === empId;
        const matchRow = rowNum == null || String(t.rowNum) === String(rowNum);
        if (matchName && matchEmp && matchRow) {
          t.status = 'Done';
          hit = true;
        }
      });
      return hit;
    }

    if (fn === 'transferChecklistTask') {
      // args: rowNum, occ, taskUid, taskName, taskPlanned, fromEmpId, toEmpId, reason
      const taskUid = String(clientArgs[2] || '');
      const taskName = String(clientArgs[3] || '');
      const fromEmp = String(clientArgs[5] || '');
      const toEmp = String(clientArgs[6] || '');
      const reason = String(clientArgs[7] || '');
      let hit = false;
      snap.checklistToday.forEach(t => {
        const byUid = taskUid && String(t.taskId || t.uid || '') === taskUid;
        const byName = taskName && String(t.task || '') === taskName && String(t.nameId || '') === fromEmp;
        if (byUid || byName) {
          t.transferredTo = toEmp;
          t.transferBy = myCode || fromEmp;
          t.transferReason = reason;
          t.transferredAt = nowTs;
          hit = true;
        }
      });
      return hit;
    }

    if (fn === 'managerShiftTask') {
      // args: taskId, empId, fromDate, toDate — update planned date on checklist
      const taskId = String(clientArgs[0] || '');
      const empId = String(clientArgs[1] || '');
      const toDate = String(clientArgs[3] || '');
      let hit = false;
      snap.checklistToday.forEach(t => {
        if (taskId && String(t.taskId || t.uid || '') === taskId) {
          if (!empId || String(t.nameId || '') === empId) {
            if (toDate) t.planned = toDate;
            hit = true;
          }
        }
      });
      return hit;
    }

    if (fn === 'saveNewTask' && gasResult && gasResult.success !== false) {
      const o = clientArgs[0] || {};
      snap.taskList.unshift({
        setupId: String((gasResult && (gasResult.setup_id || gasResult.task_id || gasResult.uid)) || ('NEW-' + Date.now())),
        task: String(o.task_name || o.task || ''),
        doerId: String(o.doer_id || o.emp_id || ''),
        doerName: String(o.doer_name || ''),
        department: String(o.department || ''),
        frequency: String(o.frequency || o.freq || 'Daily'),
        weekDay: String(o.week_day || ''),
        monthDay: String(o.month_day || ''),
        dayDate: String(o.day_date || o.scheduled_time || ''),
        status: 'Active',
        startDate: String(o.start_date || today)
      });
      return true;
    }

    if (fn === 'portalDeleteTask' || fn === 'deactivateTask') {
      const uid = String(clientArgs[0] || '');
      const before = snap.taskList.length;
      snap.taskList = snap.taskList.filter(t => String(t.setupId || '') !== uid);
      snap.checklistToday.forEach(t => {
        if (String(t.taskId || t.uid || '') === uid) t.status = 'Inactive';
      });
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

async function tryGlobalSnap(fn, args, email, meta) {
  if (!SNAPSHOT_READS.has(fn)) return undefined;
  if (process.env.SNAPSHOT !== 'on') return undefined;
  try {
    const m = await store.getMeta();
    if (!m) {
      waitUntil(runSync().catch(() => {}));
      return undefined; // first boot only — no snap yet
    }
    const st = await store.getSyncState();
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

  // Only patch / rebuild if write looked successful
  const ok = r && r.success !== false && !r.error;
  if (ok) {
    try { await cache.bump(); } catch (e) {}
    // 1) Instant row-level SNAP patch (all MAIN/MY WORK writes)
    const patched = await applyWritePatch(fn, clientArgs, r, s.email);
    meta.snapPatched = !!patched;
    // 2) Full rebuild: background if patched, await if not (safety net)
    if (patched) {
      waitUntil(rebuildAfterWrite().catch(e => console.error('bg rebuild', e.message)));
    } else {
      await rebuildAfterWrite();
      meta.snapRebuilt = true;
    }
  }

  return r;
}

module.exports = { handle, ALLOWED, runSync, store };
