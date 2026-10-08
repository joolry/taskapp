// api/_cache.js — Firestore result cache for READ calls (collections: _meta, _snap)
// OFF by default. Turn on with env SNAPSHOT=on. Any failure => silently falls back to live GAS.
const crypto = require('crypto');
let _db = null, _inc = null;
let defer = async (p) => { await p; };
try { const { waitUntil } = require('@vercel/functions'); defer = async (p) => { try { waitUntil(p); } catch (e) { await p; } }; } catch (e) {}

function db() {
  if (_db) return _db;
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (raw[0] !== '{') raw = Buffer.from(raw, 'base64').toString();
  const sa = JSON.parse(raw);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  if (!getApps().length) initializeApp({ credential: cert(sa) });
  return (_db = getFirestore());
}
const inc = (n) => (_inc ? _inc(n) : require('firebase-admin/firestore').FieldValue.increment(n));

// seconds. STATIC = rarely changes, TTL only. DYN = also invalidated by any write (version bump).
const STATIC = { getAllAppConfigForFrontend: 600, getHolidayList: 600, getTodayCelebrations: 600, getDoerList: 300, getEmployeeDirectory: 300, getTaskSetup: 120 };
const DYN = {
  getAnnouncements: 300, getAllData: 60, getBootData: 60, getDashboardStats: 60, getTodayTasks: 60, getWeeklyTasks: 60,
  getDeptTasks: 60, getTaskHistory: 120, getTeamChecklistToday: 60, getMyDelegations: 60, getMyDelegatedOut: 60,
  getAllDelegations: 60, getMyAttendance: 60, getTeamAttendanceStatus: 30, getMusterGrid: 120, getMusterReport: 120,
  getLeaveRequests: 60, getLeaveSummary: 60, getLeaveBalance: 60, getRegularizationRequests: 60, getRecentActivity: 60,
  getWeeklyCommitments: 60, getEMDashboard: 120, getEMDoerDetail: 120, getEmployeeDetailV2: 120, getEmployeeStats: 120,
  getAttendanceStats: 120, getTopPerformers: 300, getPerformanceReport: 300, getChecklistAnalytics: 300,
  getChecklistAnalyticsV2: 300, getAnalyticsSummary: 300, getAnalyticsSummaryV2: 300, getAttendanceAnalytics: 300,
  getAttendanceAnalyticsV2: 300, getDelegationAnalytics: 300, getDelegationAnalyticsV2: 300
};
// NEVER cached: getDashboardStatsFresh, getTodayAttendanceStatus, getMyProfile, getPayroll*, getIncrementAppraisals, validate*, processLogin

// Serve an EXPIRED snapshot instantly (up to N sec old) and refresh it in the background.
const H6 = 21600, H24 = 86400;
const STALE = Object.assign({}, { getAllAppConfigForFrontend: H24, getHolidayList: H24, getTodayCelebrations: H24, getDoerList: H24, getEmployeeDirectory: H24, getTaskSetup: H6,
  getChecklistAnalytics: H6, getChecklistAnalyticsV2: H6, getAnalyticsSummary: H6, getAnalyticsSummaryV2: H6, getAttendanceAnalytics: H6,
  getAttendanceAnalyticsV2: H6, getDelegationAnalytics: H6, getDelegationAnalyticsV2: H6, getTopPerformers: H6, getPerformanceReport: H6, getMusterReport: 1800, getMusterGrid: 1800 });
const istDay = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);   // day rollover => automatic miss

const enabled = () => process.env.SNAPSHOT === 'on';
const ttlOf = (fn) => STATIC[fn] || DYN[fn] || 0;
let verMem = { v: 0, t: 0 };
async function ver(force) {
  if (!force && Date.now() - verMem.t < 1500) return verMem.v;
  const d = await db().doc('_meta/state').get();
  verMem = { v: (d.exists && d.data().ver) || 0, t: Date.now() };
  return verMem.v;
}
async function bump() {
  if (!enabled()) return;
  try { await db().doc('_meta/state').set({ ver: inc(1), ts: Date.now() }, { merge: true }); verMem.t = 0; } catch (e) {}
}
async function wrap(fn, args, email, loader, meta) {
  meta = meta || {};
  const ttl = ttlOf(fn);
  if (!enabled() || !ttl) { meta.cache = 'OFF'; return loader(); }
  let v0 = 0, ref;
  try {
    const key = crypto.createHash('sha1').update(fn + '|' + istDay() + '|' + email + '|' + JSON.stringify(args)).digest('hex');
    ref = db().doc('_snap/' + key);
    const both = await Promise.all([ver(), ref.get()]);   // one round-trip instead of two
    v0 = both[0]; const s = both[1];
    if (s.exists) {
      const d = s.data();
      if (Date.now() - d.ts < ttl * 1000 && (STATIC[fn] || d.ver === v0)) { meta.cache = 'HIT'; return JSON.parse(d.json); }
      if (STALE[fn] && Date.now() - d.ts < STALE[fn] * 1000) {          // instant answer now, fresh copy for next time
        meta.cache = 'STALE';
        await defer((async () => { try {
          const o = await loader();
          if (o && o.success !== false) { const j = JSON.stringify(o); if (j.length < 900000) await ref.set({ fn, ver: v0, ts: Date.now(), json: j, exp: new Date(Date.now() + 36 * 3600e3) }); }
        } catch (e) {} })());
        return JSON.parse(d.json);
      }
    }
  } catch (e) { meta.cache = 'ERR'; return loader(); }
  meta.cache = 'MISS';
  const out = await loader();
  try {
    const json = JSON.stringify(out);
    if (ref && out && out.success !== false && json.length < 900000) {
      await defer(ref.set({ fn, ver: v0, ts: Date.now(), json, exp: new Date(Date.now() + 36 * 3600e3) }));   // ver = version seen BEFORE the GAS call
    }
  } catch (e) {}
  return out;
}
module.exports = { wrap, bump, ver, enabled, _set: (d, i) => { _db = d; _inc = i; } };
