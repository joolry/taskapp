// api/_lib.js — shared logic (underscore = not an endpoint)
const crypto = require('crypto');
const cache = require('./_cache');
const isRead = (fn) => /^(get|validate)/.test(fn);

// Only these GAS functions are callable from the browser (mirror of Code.gs _callFn).
const ALLOWED = new Set([
  'approveLeaveRequest',
  'approveRegularization',
  'cancelLeaveRequest',
  'changePassword',
  'createDelegation',
  'deactivateTask',
  'deleteAnnouncement',
  'getAllAppConfigForFrontend',
  'getAllData',
  'getAllDelegations',
  'getAnalyticsSummary',
  'getAnalyticsSummaryV2',
  'getAnnouncements',
  'getAttendanceAnalytics',
  'getAttendanceAnalyticsV2',
  'getAttendanceStats',
  'getBootData',
  'getChecklistAnalytics',
  'getChecklistAnalyticsV2',
  'getDashboardStats',
  'getDashboardStatsFresh',
  'getDelegationAnalytics',
  'getDelegationAnalyticsV2',
  'getDeptTasks',
  'getDoerList',
  'getEMDashboard',
  'getEMDoerDetail',
  'getEmployeeDetailV2',
  'getEmployeeDirectory',
  'getEmployeeStats',
  'getHolidayList',
  'getIncrementAppraisals',
  'getLeaveBalance',
  'getLeaveRequests',
  'getLeaveSummary',
  'getMusterGrid',
  'getMusterReport',
  'getMyAttendance',
  'getMyDelegatedOut',
  'getMyDelegations',
  'getMyProfile',
  'getPayroll',
  'getPayrollSummary',
  'getPerformanceReport',
  'getRecentActivity',
  'getRegularizationRequests',
  'getTaskHistory',
  'getTaskSetup',
  'getTeamAttendanceStatus',
  'getTeamChecklistToday',
  'getTodayAttendanceStatus',
  'getTodayCelebrations',
  'getTodayTasks',
  'getTopPerformers',
  'getWeeklyCommitments',
  'getWeeklyTasks',
  'managerCompleteDelegation',
  'managerShiftDelegation',
  'managerShiftTask',
  'markStaffAttendance',
  'markTaskDone',
  'markTeamTaskDone',
  'portalDeleteTask',
  'portalGenerateChecklist',
  'postAnnouncement',
  'recordCheckIn',
  'recordCheckOut',
  'requestDateRevision',
  'requestLeave',
  'requestRegularization',
  'saveIncrementAppraisal',
  'saveNewTask',
  'savePayroll',
  'saveWeeklyCommitment',
  'transferChecklistTask',
  'updateCommitmentStatus',
  'updateDelegationStatus',
  'updateIncrementAppraisal',
  'updatePayrollStatus',
  'validateGpsForAttendance',
]);
// Read-only calls: safe to retry once. Everything else is a write => NEVER auto-retried.
const RETRY_SAFE = new Set([
  'getAllData','getBootData','getDashboardStats','getDashboardStatsFresh','getTodayTasks','getWeeklyTasks',
  'getDeptTasks','getTaskHistory','getTaskSetup','getMyDelegations','getMyDelegatedOut','getAllDelegations',
  'getTodayAttendanceStatus','getMyAttendance','getTeamAttendanceStatus','getMusterReport','getMusterGrid',
  'getLeaveRequests','getLeaveSummary','getLeaveBalance','getAnnouncements','getHolidayList','getDoerList',
  'getEmployeeDirectory','getMyProfile','getRecentActivity','getAllAppConfigForFrontend','getTodayCelebrations'
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
    return { success: false, error: 'Server busy. Pehle check kar lo ki entry save hui ya nahi (Refresh), phir dobara karo.' };
  } finally { clearTimeout(t); }
}

// token: from Authorization header. Server decides WHO the user is; client-sent user is ignored.
async function handle(fn, args, token) {
  args = Array.isArray(args) ? args : [];
  if (fn === 'serverUptime') return callGas('serverUptime', [], true);
  if (fn === 'processLogin') {
    const r = await callGas('processLogin', [args[0], args[1]], false);
    if (r && r.success && r.user && r.user.email) {
      r.token = sign({ email: String(r.user.email).toLowerCase(), exp: Date.now() + SESSION_HOURS * 3600e3 });
    }
    return r;
  }
  if (!ALLOWED.has(fn)) return { success: false, error: 'Unknown function' };
  const s = verify(token);
  if (!s) return { success: false, error: 'NOT_AUTHENTICATED' };
  // Contract: last arg is always the logged-in user (passedUser). Replace with verified identity.
  args = args.slice(0, -1).concat([{ email: s.email }]);
  const run = () => callGas(fn, args, isRead(fn));
  if (isRead(fn)) return cache.wrap(fn, args.slice(0, -1), s.email, run);
  const r = await run();
  await cache.bump();            // any write invalidates cached reads (no-op unless SNAPSHOT=on)
  return r;
}
module.exports = { handle, ALLOWED, RETRY_SAFE };
