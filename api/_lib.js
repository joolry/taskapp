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

/** Schedule one rebuild; multiple writes within 5s collapse to a single sync */
function scheduleSync() {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    runSync().catch((e) => console.error('bg sync', e.message));
  }, 5000);
  // Keep Vercel from freezing the timer
  waitUntil(new Promise((r) => setTimeout(r, 5500)));
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

  // ── WRITES: GAS only, then mark dirty + debounced rebuild ───────────────
  const g = Date.now();
  const r = await callGas(fn, gasArgs, false);
  meta.gasMs = Date.now() - g;
  meta.cache = 'WRITE';

  waitUntil((async () => {
    try { await cache.bump(); } catch (e) {}
    try { await store.markDirty(); } catch (e) {}
    scheduleSync();
  })());

  return r;
}

module.exports = { handle, ALLOWED, runSync, store };
