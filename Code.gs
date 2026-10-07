// ── WhatsApp API Credentials (global — must be at top) ──────────────────────
var WA_API_KEY = 'f6a1a1229eef6fb4927df1fae50a1f3c27fb8fea0ec2de147d';
var WA_BASIC_AUTH = 'am9vbHJ5Okpvb2xyeUBAMjAyNg==';


// ════════════════════════════════════════════════════════════════════════════
// Architecture : GAS Single-File web app + Drive-hosted HTML frontend
// Auth model   : passedUser object passed from frontend on every call
// Modules      : Dashboard · Checklist · Delegation · Attendance · Analytics
//                Employee Directory · Announcements · Profile · Activity Feed
//                Holiday Calendar · Performance Reports · Team Analytics
//                Leave Management · Muster Report
// ════════════════════════════════════════════════════════════════════════════

// ── Sheet IDs ──────────────────────────────────────────────────────────────
var MASTER_SHEET_ID = '13QnK9hOuNB1MDwBDK3OhFl1k1DQWON2wPHcTBjNrigo';
var CHECKLIST_MASTER_ID = '1EtscEgGkIEDe3s8R5Iu-ZBkQ82N9d7LnLaT_AxRdop0';
const NEW_ATTENDANCE_SHEET_ID = '1wT3-vUs5LMCfn840Jjk3755jr_cM0-4o49zfA4zOB-4';

// MASTER_PASSWORD and TIMEZONE now come from AppConfig sheet.
// Fallback values used if AppConfig not yet loaded or key missing.
// ── Global SpreadsheetApp cache ────────────────────────────────────────────
// openById is a network call — cache result per GAS execution to avoid
// 10+ redundant calls per request (each wastes ~50-200ms)
var _SS_CACHE = {};
function _getSpreadsheet(id) {
  if (!_SS_CACHE[id]) _SS_CACHE[id] = SpreadsheetApp.openById(id);
  return _SS_CACHE[id];
}

function _getTimezone() { return getConfig('TIMEZONE', 'Asia/Kolkata'); }
function _getMasterPw() { return getConfig('MASTER_PASSWORD', 'joolry@2026'); }

// ════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════
function doGet(e) {
  var cb = (e && e.parameter && e.parameter.callback) || '';
  var payload = (e && e.parameter && e.parameter.payload) || '';

  var result;

  if (!payload || (e && e.parameter && e.parameter.action === 'serverUptime')) {
    result = { ok: true, serverUptime: getServerUptime() };
  } else {
    try {
      var body = JSON.parse(decodeURIComponent(payload));
      var action = String(body.action || '');
      var args = body.args || [];
      if (action === 'processLogin') {
        result = processLogin(args[0], args[1]);
      } else {
        result = _callFn(action, args);
      }
    } catch (err) {
      result = { success: false, error: err.message };
    }
  }

  var json = JSON.stringify(result);
  var output = cb ? cb + '(' + json + ')' : json;
  return ContentService.createTextOutput(output)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// // Code.gs — optional faster boot payload
// function getBootData(passedUser) {
//   var user = verifyUser(passedUser);
//   if (!user) throw new Error('NOT_AUTHENTICATED');
//   var result = {};
//   try { result.dashStats = getDashboardStats(passedUser); } catch (e) { result.dashStats = {}; }
//   try { result.todayAtt = getTodayAttendanceStatus(passedUser); } catch (e) { result.todayAtt = { status: 'not_checked_in' }; }
//   try { result.announcements = getAnnouncements(passedUser); } catch (e) { result.announcements = []; }
//   try { result.myDelegations = getMyDelegations(passedUser); } catch (e) { result.myDelegations = []; }
//   try { result.appConfig = getAllAppConfigForFrontend(passedUser); } catch (e) { result.appConfig = {}; }
//   return result;
// }

function doPost(e) {
  var result;
  try {
    var body = JSON.parse(e.postData.contents);
    var action = String(body.action || '');
    var args = body.args || [];
    if (action === 'processLogin') {
      result = processLogin(args[0], args[1]);
    } else {
      result = _callFn(action, args);
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function _callFn(action, args) {
  var fns = {
    'serverUptime': function (a) { return { ok: true, serverUptime: getServerUptime() }; },
    'getAllData': function (a) { return getAllData.apply(null, a); },
    'getDashboardStatsFresh': function (a) { return getDashboardStatsFresh.apply(null, a); },
    'getDashboardStats': function (a) { return getDashboardStats.apply(null, a); },
    'getTodayTasks': function (a) { return getTodayTasks.apply(null, a); },
    'getWeeklyTasks': function (a) { return getWeeklyTasks.apply(null, a); },
    'markTaskDone': function (a) { return markTaskDone.apply(null, a); },
    'getTaskSetup': function (a) { return getTaskSetup.apply(null, a); },
    'saveNewTask': function (a) { return saveNewTask.apply(null, a); },
    'deactivateTask': function (a) { return deactivateTask.apply(null, a); },
    'portalGenerateChecklist': function (a) { return portalGenerateChecklist.apply(null, a); },
    'portalDeleteTask': function (a) { return portalDeleteTask.apply(null, a); },
    'getTaskHistory': function (a) { return getTaskHistory.apply(null, a); },
    'getDeptTasks': function (a) { return getDeptTasks.apply(null, a); },
    'getMyDelegations': function (a) { return getMyDelegations.apply(null, a); },
    'getMyDelegatedOut': function (a) { return getMyDelegatedOut.apply(null, a); },
    'getAllDelegations': function (a) { return getAllDelegations.apply(null, a); },
    'createDelegation': function (a) { return createDelegation.apply(null, a); },
    'updateDelegationStatus': function (a) { return updateDelegationStatus.apply(null, a); },
    'requestDateRevision': function (a) { return requestDateRevision.apply(null, a); },
    'getDelegationAnalytics': function (a) { return getDelegationAnalytics.apply(null, a); },
    'getDelegationAnalyticsV2': function (a) { return getDelegationAnalyticsV2.apply(null, a); },
    'getAttendanceAnalyticsV2': function (a) { return getAttendanceAnalyticsV2.apply(null, a); },
    'getAnalyticsSummaryV2': function (a) { return getAnalyticsSummaryV2.apply(null, a); },
    'getEmployeeDetailV2': function (a) { return getEmployeeDetailV2.apply(null, a); },
    'getTodayAttendanceStatus': function (a) { return getTodayAttendanceStatus.apply(null, a); },
    'getMyAttendance': function (a) { return getMyAttendance.apply(null, a); },
    'recordCheckIn': function (a) { return recordCheckIn.apply(null, a); },
    'validateGpsForAttendance': function (a) { return validateGpsForAttendance.apply(null, a); },
    'recordCheckOut': function (a) { return recordCheckOut.apply(null, a); },
    'getAttendanceStats': function (a) { return getAttendanceStats.apply(null, a); },
    'getAttendanceAnalytics': function (a) { return getAttendanceAnalytics.apply(null, a); },
    'getMusterReport': function (a) { return getMusterReport.apply(null, a); },
    'getChecklistAnalytics': function (a) { return getChecklistAnalytics.apply(null, a); },
    'getChecklistAnalyticsV2': function (a) { return getChecklistAnalyticsV2.apply(null, a); },
    'getMusterGrid': function (a) { return getMusterGrid.apply(null, a); },
    'requestRegularization': function (a) { return requestRegularization.apply(null, a); },
    'getRegularizationRequests': function (a) { return getRegularizationRequests.apply(null, a); },
    'approveRegularization': function (a) { return approveRegularization.apply(null, a); },
    'requestLeave': function (a) { return requestLeave.apply(null, a); },
    'getLeaveRequests': function (a) { return getLeaveRequests.apply(null, a); },
    'cancelLeaveRequest': function (a) { return cancelLeaveRequest.apply(null, a); },
    'approveLeaveRequest': function (a) { return approveLeaveRequest.apply(null, a); },
    'getLeaveSummary': function (a) { return getLeaveSummary.apply(null, a); },
    'getLeaveBalance': function (a) { return getLeaveBalance.apply(null, a); },
    'getTodayCelebrations': function (a) { return getTodayCelebrations.apply(null, a); },
    'getAnnouncements': function (a) { return getAnnouncements.apply(null, a); },
    'postAnnouncement': function (a) { return postAnnouncement.apply(null, a); },
    'deleteAnnouncement': function (a) { return deleteAnnouncement.apply(null, a); },
    'getAnalyticsSummary': function (a) { return getAnalyticsSummary.apply(null, a); },
    'getPerformanceReport': function (a) { return getPerformanceReport.apply(null, a); },
    'getTopPerformers': function (a) { return getTopPerformers.apply(null, a); },
    'getEmployeeStats': function (a) { return getEmployeeStats.apply(null, a); },
    'getDoerList': function (a) { return getDoerList.apply(null, a); },
    'getEmployeeDirectory': function (a) { return getEmployeeDirectory.apply(null, a); },
    'getHolidayList': function (a) { return getHolidayList.apply(null, a); },
    'getMyProfile': function (a) { return getMyProfile.apply(null, a); },
    'changePassword': function (a) { return changePassword.apply(null, a); },
    'getRecentActivity': function (a) { return getRecentActivity.apply(null, a); },
    'getAllAppConfigForFrontend': function (a) { return getAllAppConfigForFrontend.apply(null, a); },
    'getEMDashboard': function (a) { return getEMDashboard.apply(null, a); },
    'getEMDoerDetail': function (a) { return getEMDoerDetail.apply(null, a); },
    'getTeamAttendanceStatus': function (a) { return getTeamAttendanceStatus.apply(null, a); },
    'markStaffAttendance': function (a) { return markStaffAttendance.apply(null, a); },
    'getTeamChecklistToday': function (a) { return getTeamChecklistToday.apply(null, a); },
    'markTeamTaskDone': function (a) { return markTeamTaskDone.apply(null, a); },
    'transferChecklistTask': function (a) { return transferChecklistTask.apply(null, a); },
    'managerShiftTask': function (a) { return managerShiftTask.apply(null, a); },
    'managerCompleteDelegation': function (a) { return managerCompleteDelegation.apply(null, a); },
    'managerShiftDelegation': function (a) { return managerShiftDelegation.apply(null, a); },
    'saveWeeklyCommitment': function (a) { return saveWeeklyCommitment.apply(null, a); },
    'getWeeklyCommitments': function (a) { return getWeeklyCommitments.apply(null, a); },
    'updateCommitmentStatus': function (a) { return updateCommitmentStatus.apply(null, a); },
    'saveIncrementAppraisal': function (a) { return saveIncrementAppraisal.apply(null, a); },
    'getIncrementAppraisals': function (a) { return getIncrementAppraisals.apply(null, a); },
    'updateIncrementAppraisal': function (a) { return updateIncrementAppraisal.apply(null, a); },
    'getPayroll': function (a) { return getPayroll.apply(null, a); },
    'savePayroll': function (a) { return savePayroll.apply(null, a); },
    'updatePayrollStatus': function (a) { return updatePayrollStatus.apply(null, a); },
    'getPayrollSummary': function (a) { return getPayrollSummary.apply(null, a); },
    'getBootData': function (a) { return getBootData.apply(null, a); }
  };
  if (!fns[action]) return { success: false, error: 'Unknown action: ' + action };
  try {
    return fns[action](args);
  } catch (err) {
    console.error('[_callFn] ' + action + ': ' + err.message);
    return { success: false, error: err.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIG — cached per script execution (fast, avoids repeated sheet reads)
// ════════════════════════════════════════════════════════════════════════════
var _cc = null;   // AppConfig cache

// ════════════════════════════════════════════════════════════════════════════
// APP CONFIG — reads from MASTER_SHEET_ID > AppConfig tab
// Columns expected: | config_key | config_value | description |
// Cache TTL: 10 min (see cacheTTL above).  Call _cfgReset() to force reload.
//
// Keys currently used (add rows in sheet to control these):
//   TIMEZONE              — e.g. Asia/Kolkata
//   MASTER_PASSWORD       — portal master password
//   SKIP_SUNDAYS          — Yes / No
//   COMPANY_NAME          — shown in portal header
//   OFFICE_LOC1_LAT       — primary geofence latitude
//   OFFICE_LOC1_LNG       — primary geofence longitude
//   OFFICE_LOC1_RADIUS_KM — primary radius in km   (e.g. 0.05 = 50m)
//   OFFICE_LOC1_NAME      — label for the location
//   OFFICE_LOC2_LAT       — secondary geofence latitude
//   OFFICE_LOC2_LNG       — secondary geofence longitude
//   OFFICE_LOC2_RADIUS_KM — secondary radius in km  (e.g. 0.1 = 100m)
//   OFFICE_LOC2_NAME      — label for the second location
//   GPS_ATTENDANCE        — Yes / No  (enforce GPS check-in)
//   WORK_START_TIME       — e.g. 09:00
//   WORK_END_TIME         — e.g. 18:30
//   LATE_THRESHOLD_MINS   — minutes after work start = Late  (e.g. 30)
//   HALF_DAY_THRESHOLD_HRS— hours worked below = Half Day    (e.g. 4)
//   LEAVE_TYPES           — comma-separated: Sick Leave,Paid Leave,CL,LWP
//   SESSION_HOURS         — frontend session validity in hours (e.g. 12)
//   WA_API_KEY            — messageautosender.com API key (overrides hardcoded)
//   WA_BASIC_AUTH         — messageautosender.com Basic auth (overrides hardcoded)
//   WA_CHECKIN_NOTIFY     — Yes/No — send WA on check-in/check-out (default: Yes)
//   WA_LATE_ALERT         — Yes/No — alert managers on late check-in (default: Yes)
//   WA_GPS_BLOCK_NOTIFY   — Yes/No — notify manager when GPS block triggered (default: Yes)
// ════════════════════════════════════════════════════════════════════════════
// ── Defends against a common Google Sheets gotcha: typing "09:00" into any
// cell (AppConfig values, Doer List's Office IN/OUT) without first setting
// that column to Plain Text format causes Sheets to auto-detect it as a
// TIME value. getSheetData() reads via SpreadsheetApp.getValues(), which
// then returns a native JS Date object for that cell — NOT the "09:00"
// string that was typed. Blindly String()-ing that Date object produces a
// garbled "Sat Dec 30 1899 09:00:00 GMT+..." string, which still happens to
// contain colons, so naive validation doesn't catch it — but every HH:mm
// comparison downstream silently breaks (parseInt on the wrong segments
// produces NaN, and every NaN-guarded comparison just returns false). This
// converts either a Date object or a plain string into a clean "HH:mm".


/**
 * Universal time normalizer — returns always "HH:mm" (24h) or "" / "-".
 * Handles every format that AppSheet + Portal + Sheets have ever written:
 *   Date object, Excel serial (0.458 / 46031.8125),
 *   "HH:mm", "H:mm", "HH:mm:ss",
 *   "dd/MM/yyyy HH:mm:ss", "yyyy-MM-dd HH:mm:ss",
 *   "Sat Dec 30 1899 13:00:00 GMT+0530...",
 *   "10:30 AM" / "5:05 PM"
 */
function _extractTimeStr(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v === '-') return '-';

  // ── Date object (Sheets time cell) ───────────────────────────────────────
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    try {
      return Utilities.formatDate(v, 'Asia/Kolkata', 'HH:mm');
    } catch (e) {
      return '';
    }
  }

  // ── Number: Excel serial (full date+time OR time-only fraction) ──────────
  if (typeof v === 'number') {
    var frac = v - Math.floor(v);
    if (frac < 0.00001) return '';
    var totalMins = Math.round(frac * 1440);
    if (totalMins >= 1440) totalMins = 0;
    var hh = Math.floor(totalMins / 60);
    var mm = totalMins % 60;
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  var s = String(v).trim();
  if (!s || s === '-' || s === 'undefined' || s === 'null') return s === '-' ? '-' : '';

  // ── Numeric string from cache ("46257.458" or "0.458") ───────────────────
  if (/^\d+(\.\d+)?$/.test(s)) {
    var nv = parseFloat(s);
    var frac2 = nv - Math.floor(nv);
    if (frac2 < 0.00001) return '';
    var tm2 = Math.round(frac2 * 1440);
    if (tm2 >= 1440) tm2 = 0;
    return (Math.floor(tm2 / 60) < 10 ? '0' : '') + Math.floor(tm2 / 60) + ':' +
      (tm2 % 60 < 10 ? '0' : '') + (tm2 % 60);
  }

  // ── ISO with Z / offset → convert to IST ────────────────────────────────
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && /Z|[+-]\d{2}:?\d{2}/.test(s)) {
    try {
      var isoD = new Date(s);
      if (!isNaN(isoD.getTime())) {
        return Utilities.formatDate(isoD, 'Asia/Kolkata', 'HH:mm');
      }
    } catch (eIso) {}
  }

  // ── "Sat Dec 30 1899 13:00:00 GMT+0530..." ───────────────────────────────
  var gmtM = s.match(/(?:[A-Za-z]{3}\s+){1,2}\d{1,2}\s+\d{4}\s+(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (gmtM) {
    var gh = parseInt(gmtM[1], 10), gm = parseInt(gmtM[2], 10);
    return (gh < 10 ? '0' : '') + gh + ':' + (gm < 10 ? '0' : '') + gm;
  }
  var gmt2 = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:GMT|UTC)/i);
  if (gmt2) {
    var g2h = parseInt(gmt2[1], 10), g2m = parseInt(gmt2[2], 10);
    return (g2h < 10 ? '0' : '') + g2h + ':' + (g2m < 10 ? '0' : '') + g2m;
  }

  // ── 12-hour AM/PM: "10:30 AM", "5:05PM" ─────────────────────────────────
  var ampm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampm) {
    var ah = parseInt(ampm[1], 10), am = parseInt(ampm[2], 10);
    var ap = ampm[3].toUpperCase();
    if (ap === 'PM' && ah < 12) ah += 12;
    if (ap === 'AM' && ah === 12) ah = 0;
    return (ah < 10 ? '0' : '') + ah + ':' + (am < 10 ? '0' : '') + am;
  }

  // ── "yyyy-MM-dd HH:mm:ss" or "...T..." without Z (already wall-clock) ───
  if (s.length > 10 && (s.charAt(4) === '-' || s.indexOf('T') > 0)) {
    var tIdx = s.indexOf('T') > 0 ? s.indexOf('T') : s.indexOf(' ');
    if (tIdx > 0) {
      var part = s.slice(tIdx + 1).trim();
      var hm = part.match(/^(\d{1,2}):(\d{2})/);
      if (hm) {
        var ih = parseInt(hm[1], 10), im = parseInt(hm[2], 10);
        return (ih < 10 ? '0' : '') + ih + ':' + (im < 10 ? '0' : '') + im;
      }
    }
  }

  // ── AppSheet: "dd/MM/yyyy HH:mm:ss" ─────────────────────────────────────
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    var sp = s.split(/\s+/);
    if (sp.length >= 2) {
      var hm2 = sp[1].match(/^(\d{1,2}):(\d{2})/);
      if (hm2) {
        var h2 = parseInt(hm2[1], 10), m2 = parseInt(hm2[2], 10);
        return (h2 < 10 ? '0' : '') + h2 + ':' + (m2 < 10 ? '0' : '') + m2;
      }
    }
  }

  // ── Plain "HH:mm" / "H:mm" / "HH:mm:ss" (FORMATTED_VALUE) ───────────────
  var plain = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (plain) {
    var ph = parseInt(plain[1], 10), pm = parseInt(plain[2], 10);
    if (ph >= 0 && ph <= 23 && pm >= 0 && pm <= 59) {
      return (ph < 10 ? '0' : '') + ph + ':' + (pm < 10 ? '0' : '') + pm;
    }
  }

  // Last resort: first HH:mm found in string
  var any = s.match(/(\d{1,2}):(\d{2})/);
  if (any) {
    var xh = parseInt(any[1], 10), xm = parseInt(any[2], 10);
    if (xh >= 0 && xh <= 23 && xm >= 0 && xm <= 59) {
      return (xh < 10 ? '0' : '') + xh + ':' + (xm < 10 ? '0' : '') + xm;
    }
  }

  return '';
}


/**
 * Reliable punch times from a Daily-Attendance row.
 * Prefer device_ts (full datetime text) over time-only cells (Date/UTC cache bugs).
 * Always returns { check_in: 'HH:mm'|'-', check_out: 'HH:mm'|'-' }
 */
function _attTimesFromRow(r) {
  if (!r) return { check_in: '-', check_out: '-' };

  var ciDev = _extractTimeStr(r['check_in_device_ts'] || r['device_ts'] || '');
  var coDev = _extractTimeStr(r['check_out_device_ts'] || '');
  var ciMain = _extractTimeStr(r['check_in'] || r['check_in_ts'] || '');
  var coMain = _extractTimeStr(r['check_out'] || r['check_out_ts'] || '');

  // Prefer device timestamps when present
  var ci = (ciDev && ciDev !== '-') ? ciDev : (ciMain && ciMain !== '-' ? ciMain : '-');
  var co = (coDev && coDev !== '-') ? coDev : (coMain && coMain !== '-' ? coMain : '-');

  // Guard: if IN is after OUT same day and IN looks like midnight junk (00:xx / 23:xx)
  // while main column has a sane daytime value, prefer main
  if (ci !== '-' && ciMain && ciMain !== '-' && ci !== ciMain) {
    var ciH = parseInt(ci.split(':')[0], 10);
    var mainH = parseInt(ciMain.split(':')[0], 10);
    if ((ciH <= 1 || ciH >= 22) && mainH >= 6 && mainH <= 20) {
      ci = ciMain;
    }
  }

  return { check_in: ci || '-', check_out: co || '-' };
}

function _cfgLoad() {
  _cc = {};
  try {
    var rows = getSheetData(MASTER_SHEET_ID, 'AppConfig');
    rows.forEach(function (r) {
      // Support both column naming styles: config_key or Config Key
      var k = String(r['config_key'] || r['Config Key'] || r['config key'] || r['Key'] || r['key'] || '').trim();
      var v = r['config_value'] !== undefined ? r['config_value']
        : r['Config Value'] !== undefined ? r['Config Value']
          : r['config value'] !== undefined ? r['config value']
            : r['Value'] !== undefined ? r['Value']
              : r['value'] !== undefined ? r['value'] : '';
      if (v instanceof Date) v = _extractTimeStr(v);
      if (k) _cc[k] = String(v);
    });
    console.log('[AppConfig] Loaded ' + Object.keys(_cc).length + ' keys: ' + Object.keys(_cc).join(', '));
  } catch (e) { console.warn('[AppConfig] Load failed: ' + e.message); }
}

function _cfgReset() { _cc = null; }  // force reload next call

function getConfig(key, defaultVal) {
  if (!_cc) _cfgLoad();
  var v = _cc[key];
  if (v === undefined || v === '') return defaultVal !== undefined ? String(defaultVal) : '';
  return v;
}

// Typed helpers
function _cfgNum(key, def) { var v = parseFloat(getConfig(key, '')); return isNaN(v) ? def : v; }
function _cfgBool(key, def) { var v = getConfig(key, '').toLowerCase(); return v === 'yes' || v === 'true' ? true : v === 'no' || v === 'false' ? false : def; }

// Expose to frontend via getAllData
function getAllAppConfigForFrontend(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!_cc) _cfgLoad();
  // Only expose non-sensitive keys to frontend
  var expose = ['COMPANY_NAME', 'TIMEZONE', 'GPS_ATTENDANCE', 'OFFICE_LOC1_LAT', 'OFFICE_LOC1_LNG',
    'OFFICE_LOC1_RADIUS_KM', 'OFFICE_LOC1_NAME', 'OFFICE_LOC2_LAT', 'OFFICE_LOC2_LNG',
    'OFFICE_LOC2_RADIUS_KM', 'OFFICE_LOC2_NAME', 'WORK_START_TIME', 'WORK_END_TIME',
    'LATE_THRESHOLD_MINS', 'HALF_DAY_THRESHOLD_HRS', 'LEAVE_TYPES', 'SESSION_HOURS', 'SKIP_SUNDAYS'];
  var out = {};
  expose.forEach(function (k) { if (_cc[k] !== undefined) out[k] = _cc[k]; });
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// AUTHENTICATION
// ════════════════════════════════════════════════════════════════════════════
function processLogin(email, password) {
  try {
    var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
    for (var i = 0; i < doers.length; i++) {
      var u = doers[i];
      var em = String(u['Office Email'] || '').toLowerCase().trim();
      if (em !== String(email || '').toLowerCase().trim()) continue;

      var pw = String(u['Password'] || '').trim();
      var ec = String(u['Emp ID'] || '').trim();
      if (password !== pw && password !== ec && password !== _getMasterPw())
        return { success: false, error: 'Invalid password. Please try again.' };

      return { success: true, user: buildUserObj(u) };
    }
    return { success: false, error: 'Email not found. Check your registered email.' };
  } catch (e) {
    console.error('[processLogin] ' + e.message);
    return { success: false, error: 'Login error: ' + e.message };
  }
}

function buildUserObj(u) {
  var na = String(u['NeedAttendance'] || u.need_attendance || 'Yes').trim().toLowerCase();
  var nl = String(u['NeedLocation'] || u.need_location || 'Yes').trim().toLowerCase();
  return {
    user_id: String(u['Emp ID'] || u.user_id || ''),
    emp_code: String(u['Emp ID'] || u.emp_code || ''),
    name: String(u['Name'] || u.full_name || ''),
    email: String(u['Office Email'] || u.email || '').toLowerCase().trim(),
    role: String(u['Role'] || u.role || 'STAFF'),
    dept: String(u['Department'] || u.department || ''),
    photo: String(u['PHOTO'] || u.photo_url || ''),
    need_attendance: na !== 'no',  // false = skip ALL attendance UI
    need_location: nl !== 'no'   // false = can mark from anywhere, no GPS check
  };
}

// Re-verify the passedUser object on every backend call for security
function verifyUser(passedUser) {
  // 1. Try passedUser first (fast path — no sheet read if already cached)
  if (passedUser && passedUser.email) {
    var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
    for (var i = 0; i < doers.length; i++) {
      var em = String(doers[i]['Office Email'] || '').toLowerCase().trim();
      if (em === String(passedUser.email).toLowerCase().trim()) return doers[i];
    }
  }
  // 2. Fall back to GAS session email (when running from Replit/apps-script UI)
  try {
    var sessionEmail = Session.getActiveUser().getEmail();
    if (sessionEmail) {
      var d2 = getSheetData(MASTER_SHEET_ID, 'Doer List');
      for (var j = 0; j < d2.length; j++) {
        if (String(d2[j]['Office Email'] || '').toLowerCase() === sessionEmail.toLowerCase())
          return d2[j];
      }
    }
  } catch (e) { }
  return null;
}

function isOwner(user) { return user && String(user['Role'] || user.role || '') === 'OWNER'; }
function isManager(user) { var r = String(user['Role'] || user.role || ''); return r === 'OWNER' || r === 'MANAGER'; }
function isMarkAttendanceAllowed(user) {
  var r = String(user['Role'] || user.role || '');
  return r === 'OWNER' || r === 'MANAGER' || r === 'COORDINATOR';
}
function _myCode(user) { return String(user['Emp ID'] || user.emp_code || user.user_id || ''); }

// All checklist data now in Checklist sheet
function _deptSheet() {
  return { id: CHECKLIST_MASTER_ID, tab: 'Checklist' };
}

// ════════════════════════════════════════════════════════════════════════════
// SHEET HELPERS — generic read / write / update
// ════════════════════════════════════════════════════════════════════════════

/**
 * Read all data rows from a sheet tab as an array of plain objects.
 * Row 1 is treated as the header row; subsequent rows become object keys.
 * Empty rows are skipped.
 */
// Cache TTL per tab type (seconds)
var _CACHE_TTL = {
  'Doer List': 300,   // 5 min — rarely changes mid-day
  'Task List': 30,    // 30s — short TTL so new tasks appear quickly after add
  'Holiday List': 3600, // 60 min — holidays are set in advance
  'Announcements': 300, // 5 min — rarely changes
  'AppConfig': 600,   // 10 min — config is rarely changed
  'Working Day Calender': 1800, // 30 min — rarely changes
  'Week List': 1800,  // 30 min
  'Delegation': 90,   // 90s — updated a few times per hour at most
  'Checklist_Today': 0, // never cache — done/transfer writes must reflect immediately
  'Daily-Attendance': 0, // never — write-heavy, always fresh
  'leave_requests': 0,   // never — write-heavy
  'regularization_requests': 0  // never
};

// ── Cache invalidation helper ──────────────────────────────────────────────
// Called after any write (appendRow / updateRowByField) so the next read
// always reflects the just-written data instead of serving a stale cache hit.
function _clearSheetCache(sheetId, tabName) {
  try {
    var key = 'sd_' + sheetId.slice(-6) + '_' + tabName.replace(/\s/g, '_');
    CacheService.getScriptCache().remove(key);
  } catch (e) { }
}

function getSheetData(sheetId, tabName) {
  var _t0 = Date.now();
  try {
    var ttl = _CACHE_TTL[tabName];
    if (ttl === undefined) ttl = 180;

    var cacheKey = '';
    var cached = null;
    if (ttl > 0) {
      cacheKey = 'sd_' + sheetId.slice(-6) + '_' + tabName.replace(/\s/g, '_');
      try {
        var cs = CacheService.getScriptCache();
        cached = cs.get(cacheKey);
        if (cached) {
          var result = JSON.parse(cached);
          console.log('[getSheetData] CACHE HIT  ' + tabName + ' → ' + (Date.now() - _t0) + 'ms, rows=' + result.length);
          return result;
        }
      } catch (ce) { }
    }

    var ss = _getSpreadsheet(sheetId);
    var sh = ss.getSheetByName(tabName);
    if (!sh) { console.warn('[getSheetData] Tab not found: ' + tabName); return []; }
    var lr = sh.getLastRow();
    if (lr < 2) return [];
    var lc = sh.getLastColumn();
    if (lc < 1) return [];

    var rng = sh.getRange(1, 1, lr, lc);
    var data = rng.getValues();
    var disp = rng.getDisplayValues(); // "10:49" exactly as sheet UI
    var hdrs = data[0].map(function (h) { return String(h || '').trim(); });
    var res = [];

    for (var i = 1; i < data.length; i++) {
      var row = {}, hasData = false;
      for (var j = 0; j < hdrs.length; j++) {
        if (!hdrs[j]) continue;
        var raw = data[i][j];
        var shown = disp[i][j];

        if (Object.prototype.toString.call(raw) === '[object Date]' && !isNaN(raw.getTime())) {
          // Prefer what user sees in Sheets (avoids UTC shift in Cache JSON)
          if (shown && String(shown).trim() !== '') {
            row[hdrs[j]] = String(shown).trim();
          } else {
            try {
              row[hdrs[j]] = Utilities.formatDate(raw, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
            } catch (eFmt) {
              row[hdrs[j]] = String(raw);
            }
          }
        } else {
          row[hdrs[j]] = raw;
        }

        if (row[hdrs[j]] !== '' && row[hdrs[j]] !== null && row[hdrs[j]] !== undefined) {
          hasData = true;
        }
      }
      if (hasData) res.push(row);
    }

    if (ttl > 0 && cacheKey) {
      try {
        var str = JSON.stringify(res);
        if (str.length < 90000) CacheService.getScriptCache().put(cacheKey, str, ttl);
      } catch (ce2) { }
    }

    console.log('[getSheetData] SHEET READ  ' + tabName + ' → ' + (Date.now() - _t0) + 'ms, rows=' + res.length);
    return res;
  } catch (e) {
    console.error('[getSheetData] ' + tabName + ': ' + e.message);
    return [];
  }
}

/**
 * Append a new row to a sheet tab using a plain object.
 * Keys in rowObj must match the header row exactly (trimmed).
 */
function appendRow(sheetId, tabName, rowObj) {
  var ss = SpreadsheetApp.openById(sheetId);
  var sh = ss.getSheetByName(tabName);
  if (!sh) throw new Error('Tab not found: ' + tabName);
  var hdrs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(hdrs.map(function (h) {
    var k = String(h || '').trim();
    return rowObj[k] !== undefined ? rowObj[k] : '';
  }));
  // Invalidate the script-level cache for this tab immediately — otherwise
  // getSheetData returns the stale cached version for up to the tab's TTL,
  // making the new row invisible to the next read from any function.
  _clearSheetCache(sheetId, tabName);
}

/**
 * Update columns in the first row matching fieldName === fieldVal.
 * Returns true if a row was found and updated, false otherwise.
 */
function updateRowByField(sheetId, tabName, fieldName, fieldVal, updates) {
  var ss = SpreadsheetApp.openById(sheetId);
  var sh = ss.getSheetByName(tabName);
  if (!sh) throw new Error('Tab not found: ' + tabName);
  var data = sh.getDataRange().getValues();
  var hdrs = data[0].map(function (h) { return String(h || '').trim(); });
  var fi = hdrs.indexOf(fieldName);
  if (fi < 0) throw new Error('Field not found: ' + fieldName + ' in ' + tabName);
  // Auto-create missing update columns so remarks are never silently dropped
  Object.keys(updates || {}).forEach(function (k) {
    if (hdrs.indexOf(k) < 0) {
      sh.getRange(1, hdrs.length + 1).setValue(k);
      hdrs.push(k);
    }
  });
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][fi]).trim() === String(fieldVal).trim()) {
      Object.keys(updates).forEach(function (k) {
        var ci = hdrs.indexOf(k);
        if (ci >= 0) sh.getRange(i + 1, ci + 1).setValue(updates[k]);
      });
      _clearSheetCache(sheetId, tabName);
      return true;
    }
  }
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// DATE / UTILITY HELPERS
// ════════════════════════════════════════════════════════════════════════════
function getServerUptime() { return Utilities.formatDate(new Date(), _getTimezone(), 'yyyy-MM-dd HH:mm:ss'); }
function getISTDate() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd'); }
function getISTTimestamp() { return Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'); }
function _hex8() { return Math.random().toString(36).substring(2, 6) + Math.random().toString(36).substring(2, 6); }

function _daysAgo(n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  return Utilities.formatDate(d, _getTimezone(), 'yyyy-MM-dd');
}

function _daysLater(n) {
  var d = new Date();
  d.setDate(d.getDate() + n);
  return Utilities.formatDate(d, _getTimezone(), 'yyyy-MM-dd');
}

/**
 * Safely convert ANY value (Date object, string, number) that comes out of a
 * Google Sheets cell into an ISO "YYYY-MM-DD" string.
 *
 * This is the canonical fix for:
 *   TypeError: (d.Timestamp || "").substring is not a function
 *
 * The root cause: GAS returns Date-typed cells as JS Date objects.
 * If you write  (d['Timestamp'] || '').substring(0,10)  and Timestamp IS a
 * Date object, the || '' short-circuit DOES NOT fire (Date is truthy),
 * so you get Date.substring which does not exist.
 *
 * ALWAYS call _safeStr(value) first, then .substring(0,10).
 */
function _safeStr(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, _getTimezone(), 'yyyy-MM-dd HH:mm:ss');
  return String(v);
}

/**
 * Normalise a date value coming from any sheet column (Date object, DD-MM-YYYY,
 * DD-Mon-YYYY, or already YYYY-MM-DD) → always returns "YYYY-MM-DD" or "".
 */
function _normDate(dStr) {
  // Numeric: Sheets date serial (UNFORMATTED_VALUE returns numbers for date-type cells)
  // AppSheet often stores dates as date-type cells, not text.
  if (typeof dStr === 'number') {
    var n = dStr;
    if (n > 36526 && n < 60000) { // roughly year 2000-2064
      try {
        var d0 = new Date(Math.round((n - 25569) * 86400000));
        return Utilities.formatDate(d0, 'UTC', 'yyyy-MM-dd');
      } catch (e) { }
    }
  }
  var s = String(dStr || '').trim();
  if (!s || s === '-' || s === 'undefined' || s === 'null') return '';
  // Numeric string e.g. "46257" from JSON cache of a number
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    var nv = parseFloat(s);
    if (nv > 36526 && nv < 60000) {
      try { return Utilities.formatDate(new Date(Math.round((nv - 25569) * 86400000)), 'UTC', 'yyyy-MM-dd'); } catch (e) { }
    }
  }
  // Already YYYY-MM-DD (may have time after it — just take first 10 chars)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY or DD/MM/YYYY HH:mm:ss (AppSheet text date with or without time)
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    var sp = s.slice(0, 10).split('/');
    if (sp.length === 3) return sp[2].slice(0, 4) + '-' + sp[1].padStart(2, '0') + '-' + sp[0].padStart(2, '0');
  }
  // DD-MM-YYYY or DD-Mon-YYYY
  var p = s.split('-');
  if (p.length >= 3) {
    var MONTHS = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
    };
    var yr = p[2].length === 4 ? p[2] : '20' + p[2].substring(0, 2);
    var mo = isNaN(parseInt(p[1])) ? (MONTHS[p[1]] || '01') : String(parseInt(p[1])).padStart(2, '0');
    var day = String(parseInt(p[0])).padStart(2, '0');
    return yr + '-' + mo + '-' + day;
  }
  // Try parsing any other format via GAS date utilities
  try {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, _getTimezone(), 'yyyy-MM-dd');
  } catch (e) { }
  return s.substring(0, 10);
}

/**
 * Safe version of _normDate that accepts Date objects directly.
 * Use this for ANY column that might contain a GAS Date object.
 */
function _normDateSafe(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, _getTimezone(), 'yyyy-MM-dd');
  if (typeof v === 'number') return _normDate(v);
  return _normDate(_safeStr(v));
}

// ════════════════════════════════════════════════════════════════════════════
// DOER LIST — cached 10 min (static master data, rarely changes)
// ════════════════════════════════════════════════════════════════════════════
function getDoerList(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var cache = CacheService.getScriptCache();
  var hit = cache.get('doer_list_v3');
  if (hit) { try { return JSON.parse(hit); } catch (e) { } }

  var raw = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var doers = raw.map(function (r) {
    // Parse week_off_day: 0=Sun (default), 1=Mon...6=Sat
    var wod = r['Week Off Day'];
    var weekOffDay = 0;
    if (wod !== undefined && wod !== null && wod !== '') {
      var wodStr = String(wod).trim().toLowerCase();
      var dayMap = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
      if (dayMap[wodStr] !== undefined) weekOffDay = dayMap[wodStr];
      else { var n = parseInt(wodStr, 10); if (!isNaN(n) && n >= 0 && n <= 6) weekOffDay = n; }
    }
    return {
      emp_id: String(r['Emp ID'] || ''),
      name: String(r['Name'] || ''),
      department: String(r['Department'] || ''),
      email: String(r['Office Email'] || '').toLowerCase(),
      role: String(r['Role'] || 'STAFF'),
      photo: String(r['PHOTO'] || ''),
      phone: String(r['Phone'] || r['Mobile'] || ''),
      week_off_day: weekOffDay
    };
  }).filter(function (d) { return d.emp_id; });

  var str = JSON.stringify(doers);
  if (str.length < 90000) cache.put('doer_list_v3', str, 600);
  return doers;
}

// ════════════════════════════════════════════════════════════════════════════
// BULK LOAD — getAllData()
// Called once after login. Returns everything the frontend needs.
// Replaces 8-10 individual GAS calls with 1.
// ════════════════════════════════════════════════════════════════════════════
function getAllData(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var result = {};

  // ── 1. Dashboard Stats ───────────────────────────────────────────────────
  try { result.dashStats = getDashboardStats(passedUser); } catch (e) { result.dashStats = {}; }

  // ── 2. Today's Attendance Status ─────────────────────────────────────────
  try { result.todayAtt = getTodayAttendanceStatus(passedUser); } catch (e) { result.todayAtt = { status: 'not_checked_in' }; }

  // ── 3. Today's Tasks ─────────────────────────────────────────────────────
  try { result.todayTasks = getTodayTasks(null, null, passedUser); } catch (e) { result.todayTasks = []; }

  // ── 4. Announcements ─────────────────────────────────────────────────────
  try { result.announcements = getAnnouncements(passedUser); } catch (e) { result.announcements = []; }

  // ── 5. Leave Balance ─────────────────────────────────────────────────────
  try { result.leaveBalance = getLeaveBalance(passedUser); } catch (e) { result.leaveBalance = {}; }

  // ── 5b. AppConfig — send to frontend at login ───────────────────────────────
  try { result.appConfig = getAllAppConfigForFrontend(passedUser); } catch (e) { result.appConfig = {}; }

  // ── 6. Holiday List (current year) ───────────────────────────────────────
  try { result.holidays = getHolidayList(new Date().getFullYear(), passedUser); } catch (e) { result.holidays = []; }

  // ── 7. My Delegations ────────────────────────────────────────────────────
  try { result.myDelegations = getMyDelegations(passedUser); } catch (e) { result.myDelegations = []; }

  // ── 8. Employee Directory (manager only) ─────────────────────────────────
  var role = String(user.role || '').toUpperCase();
  if (role === 'OWNER' || role === 'MANAGER' || role === 'HR') {
    try { result.empDir = getEmployeeDirectory(passedUser); } catch (e) { result.empDir = []; }
    try { result.celebrations = getTodayCelebrations(passedUser); } catch (e) { result.celebrations = []; }
    // analyticsSummary is fetched async after login (non-blocking)
  }

  // ── 9. My Attendance (current month) ─────────────────────────────────────
  try {
    var currMonth = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM');
    result.myAttendance = getMyAttendance(null, currMonth, passedUser);
  } catch (e) { result.myAttendance = { records: [], summary: {} }; }

  return result;
}

// ── Lightweight cache-busting refresh ─────────────────────────────────────
// Clears all frequently-read sheet caches then returns just the data the
// dashboard / header badges need to update instantly. Called by the frontend
// every 90 seconds and on manual refresh, much cheaper than full getAllData.
function getDashboardStatsFresh(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  // NOTE: Do NOT clear sheet cache here — that made every poll a cold full-sheet read.
  // Use clearAllCaches() only from Script Editor when you intentionally need a flush.
  var result = {};
  try { result.dashStats = getDashboardStats(passedUser); } catch (e) { }
  try { result.todayAtt = getTodayAttendanceStatus(passedUser); } catch (e) { }
  try { result.announcements = getAnnouncements(passedUser); } catch (e) { }
  try { result.myDelegations = getMyDelegations(passedUser); } catch (e) { }
  return result;
}

/**
 * Fast login payload — NO cache clear, Checklist_Today only for task counts.
 * Target: < 5s warm, < 12s cold.
 */
function getBootData(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var result = {};
  var today = getISTDate();
  var empCode = _myCode(user);

  // ── dashStats (light) ────────────────────────────────────────────────────
  var stats = {
    pendingTasks: 0,
    doneTasks: 0,
    totalTasks: 0,
    overdueDelegations: 0,
    myAttendanceToday: '-',
    unreadAnnouncements: 0,
    name: String(user['Name'] || user.full_name || ''),
    dept: String(user['Department'] || user.department || ''),
    role: String(user['Role'] || user.role || 'STAFF')
  };

  // Tasks from Checklist_Today only (NOT full Checklist)
  try {
    var logs = getSheetData(CHECKLIST_MASTER_ID, 'Checklist_Today').filter(function (l) {
      return String(l['Name Id'] || '') === empCode &&
        _normDateSafe(l['Planned']) === today;
    });
    stats.totalTasks = logs.length;
    stats.doneTasks = logs.filter(function (l) {
      return String(l['Status'] || '') === 'Done';
    }).length;
    stats.pendingTasks = stats.totalTasks - stats.doneTasks;
  } catch (e) { }

  // Overdue delegations (cached sheet ok)
  try {
    var dels = getSheetData(MASTER_SHEET_ID, 'Delegation');
    stats.overdueDelegations = dels.filter(function (d) {
      if (String(d['Delegated To'] || '') !== empCode) return false;
      if (String(d['Status'] || '') === 'Completed') return false;
      var due = _normDateSafe(d['Final Date'] || d['First Date'] || '');
      return due && due < today;
    }).length;
  } catch (e) { }

  result.dashStats = stats;

  try { result.todayAtt = getTodayAttendanceStatus(passedUser); } catch (e) {
    result.todayAtt = { status: 'not_checked_in' };
  }
  try { result.announcements = getAnnouncements(passedUser); } catch (e) {
    result.announcements = [];
  }
  try { result.myDelegations = getMyDelegations(passedUser); } catch (e) {
    result.myDelegations = [];
  }
  try { result.appConfig = getAllAppConfigForFrontend(passedUser); } catch (e) {
    result.appConfig = {};
  }

  return result;
}


// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
function getDashboardStats(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var today = getISTDate();
  var empCode = _myCode(user);

  var stats = {
    pendingTasks: 0,
    doneTasks: 0,
    totalTasks: 0,
    overdueDelegations: 0,
    myAttendanceToday: '-',
    unreadAnnouncements: 0,
    name: String(user['Name'] || user.full_name || ''),
    dept: String(user['Department'] || user.department || ''),
    role: String(user['Role'] || user.role || 'STAFF')
  };

  // ── Tasks ────────────────────────────────────────────────────────────────
  try {
    // Prefer Checklist_Today (weekly snapshot) — full Checklist is 50k+ rows
    var logs = getSheetData(CHECKLIST_MASTER_ID, 'Checklist_Today').filter(function (l) {
      return String(l['Name Id'] || '') === empCode &&
        _normDateSafe(l['Planned']) === today;
    });
    stats.totalTasks = logs.length;
    stats.doneTasks = logs.filter(function (l) { return String(l['Status']) === 'Done'; }).length;
    stats.pendingTasks = stats.totalTasks - stats.doneTasks;
  } catch (e) { console.warn('[getDashboardStats] tasks: ' + e.message); }

  // ── Delegations ──────────────────────────────────────────────────────────
  try {
    var dels = getSheetData(MASTER_SHEET_ID, 'Delegation');
    stats.overdueDelegations = dels.filter(function (d) {
      if (String(d['Delegated To'] || '') !== empCode) return false;
      if (String(d['Status'] || '') === 'Completed') return false;
      var due = _normDateSafe(d['Final Date'] || d['First Date'] || '');
      return due && due < today;
    }).length;
  } catch (e) { console.warn('[getDashboardStats] delegations: ' + e.message); }

  // ── Attendance today (Daily-Attendance) ─────────────────────────────────
  try {
    var attRows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance');
    var rec = null;
    for (var ai = 0; ai < attRows.length; ai++) {
      if (_normDateSafe(attRows[ai]['date']) === today && String(attRows[ai]['emp_id']) === empCode) {
        rec = attRows[ai]; break;
      }
    }
    if (rec) {
      var rs = String(rec['status'] || '').trim();
      stats.myAttendanceToday = rs || (rec['check_in'] && rec['check_in'] !== '-' ? 'Present' : '-');
    }
  } catch (e) { console.warn('[getDashboardStats] attendance: ' + e.message); }

  // ── Announcements count ──────────────────────────────────────────────────
  try {
    stats.unreadAnnouncements = getSheetData(MASTER_SHEET_ID, 'Announcements')
      .filter(function (a) { return String(a['is_active'] || 'Yes') !== 'No'; }).length;
  } catch (e) { }

  return stats;
}

// ════════════════════════════════════════════════════════════════════════════
// CHECKLIST MODULE
// ════════════════════════════════════════════════════════════════════════════
function getTodayTasks(empId, date, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var target = date || getISTDate();
  var code = empId || _myCode(user);
  var isToday = (target === getISTDate());
  var isHol = getSheetData(MASTER_SHEET_ID, 'Holiday List').some(function (h) {
    return _normDateSafe(h['Date']) === target;
  });

  var ss = _getSpreadsheet(CHECKLIST_MASTER_ID);
  var sh = ss.getSheetByName(isToday ? 'Checklist_Today' : 'Checklist');
  if (!sh) return [];
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return [];

  var data = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var hdrs = data[0].map(function (h) { return String(h || '').trim(); });
  var iNId = hdrs.indexOf('Name Id'), iPlnd = hdrs.indexOf('Planned');
  var iTsk = hdrs.indexOf('Task'), iStat = hdrs.indexOf('Status');
  var iAct = hdrs.indexOf('Actual'), iFreq = hdrs.indexOf('Freq');
  var iTid = hdrs.indexOf('Task ID'), iUID = hdrs.indexOf('UID In TaskLIst');
  var iTransTo = hdrs.indexOf('Transferred To');
  var iTransAt = hdrs.indexOf('Transferred At');
  var iTransBy = hdrs.indexOf('Transfer By');
  var iTransRea = hdrs.indexOf('Transfer Reason');
  var iRemark = hdrs.indexOf('Remark');

  // Build planned_time map from Task List's Day/Date column
  // New format: "dd/MM/yyyy HH:mm:ss" e.g. "08/08/2026 14:00:00"
  var taskTimeMap = {};
  try {
    getSheetData(MASTER_SHEET_ID, 'Task List').forEach(function (tl) {
      var uid = String(tl['Setup Task ID'] || '').trim();
      var rawDD = tl['Day/Date'];
      if (!uid) return;
      var timePart = '';
      function _t12(h, m) { var ap = h >= 12 ? 'PM' : 'AM'; return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + ap; }
      if (rawDD instanceof Date) {
        // Sheets parsed the value as a Date (old records without text format)
        timePart = _t12(rawDD.getHours(), rawDD.getMinutes());
      } else {
        var dd = String(rawDD || '').trim();
        // NEW format: "dd/MM/yyyy HH:mm:ss" — extract HH:mm
        var ddmmMatch = dd.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
        if (ddmmMatch) {
          timePart = _t12(parseInt(ddmmMatch[4], 10), parseInt(ddmmMatch[5], 10));
        }
        // ISO datetime "2026-03-31T18:30:00.000Z" (old records)
        else if (dd.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)) {
          var iso = new Date(dd);
          if (!isNaN(iso.getTime())) timePart = _t12(iso.getHours(), iso.getMinutes());
        }
        // Corrupted "Sat Dec 30 1899 13:00:00 GMT+..."
        else if (dd.match(/\d{4}\s+(\d{2}):(\d{2})/)) {
          var gm = dd.match(/\d{4}\s+(\d{2}):(\d{2})/);
          timePart = _t12(parseInt(gm[1], 10), parseInt(gm[2], 10));
        }
        // Old "Daily · 1:00 PM" or "Monday · 10:30 AM" — extract after ·
        else if (dd.indexOf(' · ') > -1) timePart = dd.substring(dd.indexOf(' · ') + 3).trim();
        // Already "11:00 AM" or "11:00"
        else if (dd.match(/^\d{1,2}:\d{2}/)) timePart = dd;
      }
      if (timePart) taskTimeMap[uid] = timePart;
    });
  } catch (eTm) { }

  var out = [];
  var occCount = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var nameId = iNId >= 0 ? String(row[iNId] || '').trim() : '';
    var transTo = iTransTo >= 0 ? String(row[iTransTo] || '').trim() : '';
    var rowDate = iPlnd >= 0 ? _normDateSafe(row[iPlnd]) : '';

    if (rowDate && rowDate !== target) continue; // always filter by date (Checklist_Today has full week)

    var isOwn = nameId === String(code);
    // Task received by me = Name Id is mine AND Transferred To is also mine (task routed to me)
    var isReceived = isOwn && !!transTo && transTo === String(code);
    // Task sent away by me = Name Id is mine AND Transferred To is SOMEONE ELSE
    var isTransOut = isOwn && !!transTo && transTo !== String(code);

    // Show this task if: (a) it's mine OR (b) it was transferred FROM someone else TO me
    var isMine = isOwn;
    var isFromSomeone = !isOwn && transTo === String(code);
    if (!isMine && !isFromSomeone) continue;

    var taskName = iTsk >= 0 ? String(row[iTsk] || '').trim() : '';
    var taskUid = (iTid >= 0 ? String(row[iTid] || '') : '') || (iUID >= 0 ? String(row[iUID] || '') : '');
    var occKey = nameId + '|' + taskName;
    var occ = occCount[occKey] || 0;
    occCount[occKey] = occ + 1;

    var st = iStat >= 0 ? String(row[iStat] || '').trim() : '';
    out.push({
      row_num: i + 1,
      occ: occ,
      task_uid: taskUid,
      task_name: taskName,
      frequency: iFreq >= 0 ? String(row[iFreq] || '') : '',
      emp_id: nameId,
      planned: rowDate || target,
      status: st || (isHol ? 'Holiday' : 'Pending'),
      actual: iAct >= 0 ? String(row[iAct] || '') : '',
      transferred_to: transTo,
      transferred_at: iTransAt >= 0 ? String(row[iTransAt] || '') : '',
      transfer_by: iTransBy >= 0 ? String(row[iTransBy] || '') : '',
      transfer_reason: iTransRea >= 0 ? String(row[iTransRea] || '') : '',
      is_transferred: isTransOut,  // I sent this away → no Done button, orange badge
      is_received: isReceived || isFromSomeone,  // came TO me → Done button, purple badge
      remark: iRemark >= 0 ? String(row[iRemark] || '') : '',
      scheduled_time: taskTimeMap[taskUid] || taskTimeMap[(taskUid || '').split('_')[0]] || ''
    });
  }
  return out;
}

function getDeptTasks(dept, date, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  // Task List se seedha read karo — Active tasks sirf
  var setup = getSheetData(MASTER_SHEET_ID, 'Task List');

  return setup.filter(function (t) {
    if (String(t['Delete Repeated Task'] || '') === 'Yes') return false;
    if (String(t['Status'] || '') === 'Inactive') return false;
    if (dept && dept !== 'All' && String(t['Department'] || '') !== dept) return false;
    return true;
  }).map(function (t) {
    var freq = String(t['Frequency'] || '');
    var weekDay = String(t['Week Day'] || '').trim();
    var monthDay = String(t['Month Day'] || '').trim();
    var rawDayDate = t['Day/Date'];
    var dayDate = '';
    function _ddT12(h, m) { var ap = h >= 12 ? 'PM' : 'AM'; return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + ap; }

    if (rawDayDate instanceof Date) {
      // Sheets parsed it — extract time only
      dayDate = _ddT12(rawDayDate.getHours(), rawDayDate.getMinutes());
    } else {
      dayDate = String(rawDayDate || '').trim();
      if (!dayDate.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}:\d{2}/)) {
        // ISO "2026-03-31T18:30:00.000Z"
        if (dayDate.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)) {
          var isoD = new Date(dayDate);
          if (!isNaN(isoD.getTime())) dayDate = _ddT12(isoD.getHours(), isoD.getMinutes());
        }
        // Corrupted "Sat Dec 30 1899 13:00:00 GMT..."
        else if (dayDate.match(/\d{4}\s+(\d{2}):(\d{2})/)) {
          var gc2 = dayDate.match(/\d{4}\s+(\d{2}):(\d{2})/);
          dayDate = _ddT12(parseInt(gc2[1], 10), parseInt(gc2[2], 10));
        }
        // Old "Daily · 2:00 PM"
        else if (dayDate.indexOf(' · ') > -1) {
          dayDate = dayDate.substring(dayDate.indexOf(' · ') + 3).trim();
        }
      }
    }

    // Build display label: "8 Aug 2026 2:00 PM" for new format, or frequency info for old
    var dayLabel = dayDate;
    var _MNS2 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var ddmmFull = dayDate.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    if (ddmmFull) {
      var _fd = parseInt(ddmmFull[1], 10), _fmo = parseInt(ddmmFull[2], 10) - 1;
      var _fyr = ddmmFull[3], _fh = parseInt(ddmmFull[4], 10), _fm = parseInt(ddmmFull[5], 10);
      var _fap = _fh >= 12 ? 'PM' : 'AM', _fh12 = _fh % 12 || 12;
      var _ftm = _fh12 + ':' + (_fm < 10 ? '0' : '') + _fm + ' ' + _fap;
      if (weekDay) dayLabel = weekDay + ' · ' + _ftm;
      else if (monthDay) dayLabel = monthDay + ' of month · ' + _ftm;
      else dayLabel = _fd + ' ' + _MNS2[_fmo] + ' ' + _fyr + ' ' + _ftm;
    }
    return {
      task_uid: String(t['Setup Task ID'] || ''),
      task_name: String(t['Task'] || ''),
      frequency: String(t['Frequency'] || ''),
      emp_id: String(t['Doer ID'] || ''),
      emp_name: String(t['Doer Name'] || ''),
      dept: String(t['Department'] || ''),
      day_date: dayDate,
      day_label: dayLabel,
      week_day: weekDay,
      month_day: monthDay
    };
  });
}

function getWeeklyTasks(empId, weekNum, yearNum, passedUser) {
  // yearNum is optional — if omitted passedUser slides into yearNum position
  if (yearNum && typeof yearNum === 'object' && !passedUser) {
    passedUser = yearNum; yearNum = null;
  }
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var code = empId || _myCode(user);
  var yr = yearNum ? Number(yearNum) : new Date().getFullYear();
  var wk = Number(weekNum) || 1;

  // Calculate Monday of the ISO week
  var jan4 = new Date(yr, 0, 4);
  var jan4Dow = jan4.getDay() || 7;
  var week1Mon = new Date(jan4);
  week1Mon.setDate(jan4.getDate() - (jan4Dow - 1));
  var startDate = new Date(week1Mon);
  startDate.setDate(week1Mon.getDate() + (wk - 1) * 7);

  // Build array of 7 date strings for this week
  var weekDates = [];
  var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (var d = 0; d < 7; d++) {
    var dt = new Date(startDate);
    dt.setDate(startDate.getDate() + d);
    weekDates.push({
      date: Utilities.formatDate(dt, _getTimezone(), 'yyyy-MM-dd'),
      dow: dt.getDay()
    });
  }

  // Holiday set for this week
  var holSet = {};
  try {
    getSheetData(MASTER_SHEET_ID, 'Holiday List').forEach(function (h) {
      var hd = _normDateSafe(h['Date'] || h['Holiday Date'] || '');
      if (hd) holSet[hd] = true;
    });
  } catch (e) { }

  // ── Strategy 1: Try Checklist sheet first (has actual done/pending status) ─
  var checklistRows = [];
  try {
    checklistRows = getSheetData(CHECKLIST_MASTER_ID, 'Checklist').filter(function (l) {
      if (String(l['Name Id'] || '') !== String(code)) return false;
      var pd = _normDateSafe(l['Planned']);
      return weekDates.some(function (wd) { return wd.date === pd; });
    });
  } catch (e) { console.warn('[getWeeklyTasks] Checklist read: ' + e.message); }

  // ── Strategy 2: If no Checklist rows, fall back to Task List (show planned) ─
  var taskListRows = [];
  if (!checklistRows.length) {
    try {
      taskListRows = getSheetData(MASTER_SHEET_ID, 'Task List').filter(function (t) {
        if (String(t['Doer ID'] || '') !== String(code)) return false;
        if (String(t['Delete Repeated Task'] || '') === 'Yes') return false;
        if (String(t['Status'] || '') === 'Inactive') return false;
        return true;
      });
    } catch (e) { console.warn('[getWeeklyTasks] Task List read: ' + e.message); }
  }

  // Build days array
  var days = weekDates.map(function (wd) {
    var isHol = holSet[wd.date] || false;
    var tasks;

    if (checklistRows.length) {
      // Use real checklist rows for this date
      tasks = checklistRows
        .filter(function (l) { return _normDateSafe(l['Planned']) === wd.date; })
        .map(function (l) {
          var st = String(l['Status'] || '').trim();
          return {
            task_uid: String(l['Task ID'] || ''),
            task_name: String(l['Task'] || ''),
            frequency: String(l['Freq'] || ''),
            status: st || (isHol ? 'Holiday' : 'Pending'),
            actual_dt: _normDateSafe(l['Actual'] || '')
          };
        });
    } else {
      // Fallback: show tasks from Task List that apply to this day
      tasks = taskListRows
        .filter(function (t) {
          var freq = String(t['Frequency'] || '').trim();
          var dow = wd.dow; // 0=Sun, 1=Mon...6=Sat
          if (wd.date > getISTDate()) return false; // only show up to today
          if (freq === 'D' || freq === 'Daily') return dow !== 0;  // Mon-Sat
          if (freq === 'W' || freq === 'Weekly') return dow === 1; // Mondays
          if (freq === 'F' || freq === 'Fortnightly') return dow === 1;
          if (freq === 'M' || freq === 'Monthly') return dow === 1;
          return true; // show others always
        })
        .map(function (t) {
          return {
            task_uid: String(t['Setup Task ID'] || ''),
            task_name: String(t['Task'] || ''),
            frequency: String(t['Frequency'] || ''),
            status: isHol ? 'Holiday' : 'Planned',
            actual_dt: ''
          };
        });
    }

    return {
      date: wd.date,
      day: dayNames[wd.dow],
      tasks: tasks,
      isHol: isHol
    };
  });

  return days;
}

function getTaskHistory(empId, fromDate, toDate, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var from = fromDate || _daysAgo(30);
  var to = toDate || getISTDate();
  var code = empId || _myCode(user);

  var logs = getSheetData(CHECKLIST_MASTER_ID, 'Checklist').filter(function (l) {
    if (String(l['Name Id'] || '') !== String(code)) return false;
    var d = _normDateSafe(l['Planned']);
    return d >= from && d <= to;
  }).map(function (l) {
    return {
      log_id: String(l['Task ID'] || ''),
      task_uid: String(l['UID In TaskLIst'] || ''),
      emp_id: String(l['Name Id'] || ''),
      emp_name: String(l['Name'] || ''),
      date: _normDateSafe(l['Planned'] || ''),
      actual_dt: _normDateSafe(l['Actual'] || ''),
      task_name: String(l['Task'] || ''),
      frequency: String(l['Freq'] || ''),
      status: String(l['Status'] || ''),
      remark: String(l['Remark'] || '')
    };
  });

  logs.sort(function (a, b) { return b.date.localeCompare(a.date); });
  return logs.slice(0, 200);
}

// ════════════════════════════════════════════════════════════════════════════
// MARK TEAM CHECKLIST (OWNER / MANAGER / COORDINATOR)
// ════════════════════════════════════════════════════════════════════════════

function getTeamChecklistToday(dateStr, deptFlt, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isMarkAttendanceAllowed(user)) throw new Error('PERMISSION_DENIED');

  var date = _normDate(dateStr) || getISTDate();
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var empMap = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '').trim();
    if (id) empMap[id] = { name: String(d['Name'] || ''), dept: String(d['Department'] || ''), role: String(d['Role'] || 'STAFF') };
  });

  var isToday = date === getISTDate();
  var ss = _getSpreadsheet(CHECKLIST_MASTER_ID);
  var sh = ss.getSheetByName(isToday ? 'Checklist_Today' : 'Checklist');
  if (!sh) return [];
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2) return [];

  var data = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var hdrs = data[0].map(function (h) { return String(h || '').trim(); });
  var iNameId = hdrs.indexOf('Name Id');
  var iPlanned = hdrs.indexOf('Planned');
  var iTask = hdrs.indexOf('Task');
  var iStatus = hdrs.indexOf('Status');
  var iActual = hdrs.indexOf('Actual');
  var iFreq = hdrs.indexOf('Frequency') >= 0 ? hdrs.indexOf('Frequency') : hdrs.indexOf('Freq');
  var iTaskId = hdrs.indexOf('Task ID');
  var iUID = hdrs.indexOf('UID In TaskLIst');
  var iTransTo = hdrs.indexOf('Transferred To');
  var iTransBy = hdrs.indexOf('Transfer By');
  var iTransAt = hdrs.indexOf('Transferred At');
  var iTransRea = hdrs.indexOf('Transfer Reason');
  var iRemark = hdrs.indexOf('Remark');

  var out = [];
  var occCount = {};

  // ── Build planned_time map from Task List Day/Date column ──
  // New format: "dd/MM/yyyy HH:mm:ss" e.g. "08/08/2026 14:00:00"
  var teamTaskTimeMap = {};
  try {
    getSheetData(MASTER_SHEET_ID, 'Task List').forEach(function (tl) {
      var uid = String(tl['Setup Task ID'] || '').trim();
      var rawDD = tl['Day/Date'];
      if (!uid) return;
      var timePart = '';
      function _t12(h, m) { var ap = h >= 12 ? 'PM' : 'AM'; return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + ap; }
      if (rawDD instanceof Date) {
        timePart = _t12(rawDD.getHours(), rawDD.getMinutes());
      } else {
        var dd = String(rawDD || '').trim();
        var ddmmMatch = dd.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
        if (ddmmMatch) { timePart = _t12(parseInt(ddmmMatch[4], 10), parseInt(ddmmMatch[5], 10)); }
        else if (dd.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)) { var iso = new Date(dd); if (!isNaN(iso.getTime())) timePart = _t12(iso.getHours(), iso.getMinutes()); }
        else if (dd.match(/\d{4}\s+(\d{2}):(\d{2})/)) { var gm = dd.match(/\d{4}\s+(\d{2}):(\d{2})/); timePart = _t12(parseInt(gm[1], 10), parseInt(gm[2], 10)); }
        else if (dd.indexOf(' · ') > -1) timePart = dd.substring(dd.indexOf(' · ') + 3).trim();
        else if (dd.match(/^\d{1,2}:\d{2}/)) timePart = dd;
      }
      if (timePart) teamTaskTimeMap[uid] = timePart;
    });
  } catch (e2) { }

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var eid = iNameId >= 0 ? String(row[iNameId] || '').trim() : '';
    if (!eid) continue;
    var rowDate = iPlanned >= 0 ? _normDateSafe(row[iPlanned]) : '';
    if (!isToday && rowDate !== date) continue;
    if (deptFlt && deptFlt !== 'all' && (empMap[eid] || {}).dept !== deptFlt) continue;

    var taskName = iTask >= 0 ? String(row[iTask] || '').trim() : '';
    // task_uid: Task ID is most reliable (unique per occurrence), fall back to UID
    var taskUid = (iTaskId >= 0 ? String(row[iTaskId] || '') : '')
      || (iUID >= 0 ? String(row[iUID] || '') : '');

    var occKey = eid + '|' + taskName;
    var occ = occCount[occKey] || 0;
    occCount[occKey] = occ + 1;

    var transTo = iTransTo >= 0 ? String(row[iTransTo] || '').trim() : '';
    var emp = empMap[eid] || { name: eid, dept: '', role: 'STAFF' };
    out.push({
      row_num: i + 1,
      occ: occ,
      task_uid: taskUid,       // ← KEY: used for reliable Checklist lookup
      task_name: taskName,
      emp_id: eid,
      emp_name: emp.name,
      dept: emp.dept,
      role: emp.role,
      planned: rowDate || date,
      status: iStatus >= 0 ? String(row[iStatus] || 'Pending') : 'Pending',
      actual: iActual >= 0 ? String(row[iActual] || '') : '',
      frequency: iFreq >= 0 ? String(row[iFreq] || '') : '',
      transferred_to: transTo,
      transfer_by: iTransBy >= 0 ? String(row[iTransBy] || '') : '',
      transferred_at: iTransAt >= 0 ? String(row[iTransAt] || '') : '',
      transfer_reason: iTransRea >= 0 ? String(row[iTransRea] || '') : '',
      is_transferred: !!transTo,
      remark: iRemark >= 0 ? String(row[iRemark] || '') : '',
      scheduled_time: teamTaskTimeMap[taskUid] || teamTaskTimeMap[(taskUid || '').split('_')[0]] || ''
    });
  }
  return out;
}

function transferChecklistTask(rowNum, occ, taskUid, taskName, taskPlanned, fromEmpId, toEmpId, reason, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isMarkAttendanceAllowed(user)) throw new Error('PERMISSION_DENIED');
  if (!fromEmpId || !toEmpId) throw new Error('fromEmpId aur toEmpId required hain');
  if (String(fromEmpId).trim() === String(toEmpId).trim()) throw new Error('Same employee ko transfer nahi');

  var feid = String(fromEmpId).trim();
  var toId = String(toEmpId).trim();
  var tname = String(taskName || '').trim().toLowerCase();
  var tuid = String(taskUid || '').trim();
  // Normalize Task ID forms: "TASK-xxx_20261003" / "xxx_20261003" / "xxx"
  if (tuid.indexOf('TASK-') === 0) tuid = tuid.substring(5);
  var baseUid = tuid.split('_')[0] || tuid;
  // taskPlanned = task's OWN planned date — normalize to yyyy-MM-dd
  var taskDate = _normDateSafe(taskPlanned) || String(taskPlanned || '').trim();
  if (taskDate && taskDate.length > 10) taskDate = taskDate.substring(0, 10);
  var dateDigits = taskDate ? taskDate.replace(/-/g, '') : '';
  var rea = String(reason || '').trim();
  var r = parseInt(rowNum, 10);
  var occi = parseInt(occ, 10) || 0;
  var managerName = String(user['Name'] || '') + ' (' + String(user['Role'] || '') + ')';
  var nowTs = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MM-yyyy HH:mm:ss');

  // Recipient details from Doer List
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var toEmpName = toId, toDept = '', toEmail = '';
  for (var xi = 0; xi < doers.length; xi++) {
    if (String(doers[xi]['Emp ID'] || '').trim() === toId) {
      toEmpName = String(doers[xi]['Name'] || toId);
      toDept = String(doers[xi]['Department'] || '');
      toEmail = String(doers[xi]['Office Email'] || '');
      break;
    }
  }

  var ss = _getSpreadsheet(CHECKLIST_MASTER_ID);

  function ensureCol(sh, hdrs, colName) {
    var idx = hdrs.indexOf(colName);
    if (idx >= 0) return idx;
    sh.getRange(1, hdrs.length + 1).setValue(colName);
    hdrs.push(colName);
    return hdrs.length - 1;
  }

  // Write all transfer data to one row in ONE batch write
  function applyTransfer(sh, rowN, hdrs) {
    var iNId = hdrs.indexOf('Name Id'), iName = hdrs.indexOf('Name');
    var iDept = hdrs.indexOf('Department'), iEmail = hdrs.indexOf('Email');
    var iStat = hdrs.indexOf('Status');
    var iTransTo = ensureCol(sh, hdrs, 'Transferred To');
    var iTransBy = ensureCol(sh, hdrs, 'Transfer By');
    var iTransAt = ensureCol(sh, hdrs, 'Transferred At');
    var iTransRea = ensureCol(sh, hdrs, 'Transfer Reason');
    var totalCols = sh.getLastColumn();
    var vals = sh.getRange(rowN, 1, 1, totalCols).getValues()[0];
    while (vals.length < totalCols) vals.push('');
    if (String(vals[iTransTo] || '').trim()) { Logger.log('[T] row ' + rowN + ' already transferred'); return false; }
    if (iNId >= 0) vals[iNId] = toId;
    if (iName >= 0) vals[iName] = toEmpName;
    if (iDept >= 0) vals[iDept] = toDept;
    if (iEmail >= 0) vals[iEmail] = toEmail;
    vals[iTransTo] = toId;
    vals[iTransBy] = managerName;
    vals[iTransAt] = nowTs;
    vals[iTransRea] = rea;
    if (iStat >= 0) vals[iStat] = 'Pending';
    sh.getRange(rowN, 1, 1, vals.length).setValues([vals]);
    return true;
  }

  // ─── Checklist_Today (~800 rows) ─────────────────────────────────────────
  var okToday = false;
  (function () {
    var sh = ss.getSheetByName('Checklist_Today');
    if (!sh || sh.getLastRow() < 2) return;
    var lc = sh.getLastColumn();
    var hdrs = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h || '').trim(); });
    var iNId = hdrs.indexOf('Name Id');
    if (iNId < 0) return;

    // Fast path: direct row by rowNum
    if (r >= 2 && r <= sh.getLastRow()) {
      var nv = String(sh.getRange(r, iNId + 1).getValue() || '').trim();
      if (nv === feid) { okToday = applyTransfer(sh, r, hdrs); if (okToday) return; }
    }
    // Fallback: bulk scan — also match Task ID / UID
    var data = sh.getRange(1, 1, sh.getLastRow(), lc).getValues();
    var iPlnd = hdrs.indexOf('Planned'), iTsk = hdrs.indexOf('Task');
    var iTaskIdT = hdrs.indexOf('Task ID');
    var iUidT = hdrs.indexOf('UID In TaskLIst');
    if (iUidT < 0) iUidT = hdrs.indexOf('UID In TaskList');
    var seen = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][iNId] || '').trim() !== feid) continue;
      if (iPlnd >= 0 && taskDate) {
        var pdT = _normDateSafe(data[i][iPlnd]);
        if (pdT && pdT !== taskDate) continue;
      }
      // Prefer UID / Task ID match when available
      var rowTid = iTaskIdT >= 0 ? String(data[i][iTaskIdT] || '') : '';
      var rowUid = iUidT >= 0 ? String(data[i][iUidT] || '') : '';
      var idOk = true;
      if (baseUid) {
        idOk = (rowUid && rowUid.indexOf(baseUid) >= 0) ||
               (rowTid && rowTid.indexOf(baseUid) >= 0) ||
               (!rowUid && !rowTid);
      }
      if (!idOk && tname && iTsk >= 0) {
        idOk = String(data[i][iTsk] || '').trim().toLowerCase() === tname;
      }
      if (!idOk) continue;
      if (seen !== occi) { seen++; continue; }
      okToday = applyTransfer(sh, i + 1, hdrs);
      return;
    }
  })();

  // ─── Checklist main (56K rows): Task ID TextFinder ───────────────────────
  // KEY FIX: use taskPlanned (the task's OWN date) not today's date
  // Task ID format = "925be848-110_YYYYMMDD" where YYYYMMDD is from taskPlanned
  var okMain = false;
  (function () {
    var sh = ss.getSheetByName('Checklist');
    if (!sh || sh.getLastRow() < 2) return;
    var lc = sh.getLastColumn();
    var hdrs = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h || '').trim(); });
    ensureCol(sh, hdrs, 'Transferred To');
    ensureCol(sh, hdrs, 'Transfer By');
    ensureCol(sh, hdrs, 'Transferred At');
    ensureCol(sh, hdrs, 'Transfer Reason');
    SpreadsheetApp.flush(); // commit new column headers

    var lastRow = sh.getLastRow();
    if (lastRow < 2) return;
    var iTaskId = hdrs.indexOf('Task ID');
    var iUID = hdrs.indexOf('UID In TaskLIst');
    if (iUID < 0) iUID = hdrs.indexOf('UID In TaskList');
    var iNId = hdrs.indexOf('Name Id');
    var iPlnd = hdrs.indexOf('Planned');
    var iTsk = hdrs.indexOf('Task');
    var pickRow = -1;
    var numRows = lastRow - 1; // data rows from row 2

    Logger.log('[T] tuid="' + tuid + '" baseUid="' + baseUid + '" taskDate="' + taskDate + '" dateDigits="' + dateDigits + '" emp=' + feid);

    function _findInCol(colIdx, needle, entire) {
      if (colIdx < 0 || !needle || numRows < 1) return [];
      try {
        var finder = sh.getRange(2, colIdx + 1, numRows, 1).createTextFinder(String(needle));
        if (entire) finder.matchEntireCell(true);
        return finder.findAll() || [];
      } catch (eF) { return []; }
    }

    function _rowMatches(rowVals) {
      if (iNId >= 0 && String(rowVals[iNId] || '').trim() !== feid) return false;
      if (taskDate && iPlnd >= 0) {
        var pd = _normDateSafe(rowVals[iPlnd]);
        if (pd && pd !== taskDate) return false;
      }
      if (tname && iTsk >= 0) {
        var tn = String(rowVals[iTsk] || '').trim().toLowerCase();
        if (tn && tn !== tname) return false;
      }
      return true;
    }

    // Try 1: exact / constructed Task ID
    if (iTaskId >= 0) {
      var idCandidates = [tuid];
      if (dateDigits) {
        idCandidates.push(baseUid + '_' + dateDigits);
        idCandidates.push('TASK-' + baseUid + '_' + dateDigits);
      }
      idCandidates.push(baseUid);
      for (var ci = 0; ci < idCandidates.length && pickRow < 0; ci++) {
        var hits = _findInCol(iTaskId, idCandidates[ci], true);
        if (!hits.length) hits = _findInCol(iTaskId, idCandidates[ci], false);
        for (var hi = 0; hi < hits.length; hi++) {
          var rr = hits[hi].getRow();
          var rv = sh.getRange(rr, 1, 1, sh.getLastColumn()).getValues()[0];
          if (_rowMatches(rv)) { pickRow = rr; break; }
        }
      }
    }

    // Try 2: UID column + emp + planned date
    if (pickRow < 0 && iUID >= 0) {
      var hitsU = _findInCol(iUID, baseUid, true);
      if (!hitsU.length) hitsU = _findInCol(iUID, baseUid, false);
      var seen2 = 0;
      for (var mu = 0; mu < hitsU.length; mu++) {
        var rnu = hitsU[mu].getRow();
        var rvu = sh.getRange(rnu, 1, 1, sh.getLastColumn()).getValues()[0];
        if (!_rowMatches(rvu)) continue;
        if (seen2 !== occi) { seen2++; continue; }
        pickRow = rnu;
        break;
      }
    }

    // Try 3: emp + task name + planned date scan (last resort, limited)
    if (pickRow < 0 && iNId >= 0 && iTsk >= 0 && tname) {
      var dataScan = sh.getRange(2, 1, Math.min(numRows, 5000), sh.getLastColumn()).getValues();
      var seen3 = 0;
      for (var si = 0; si < dataScan.length; si++) {
        if (!_rowMatches(dataScan[si])) continue;
        if (seen3 !== occi) { seen3++; continue; }
        pickRow = si + 2;
        break;
      }
    }

    if (pickRow < 0) { Logger.log('[T] No row found in Checklist'); return; }
    var fhd = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h || '').trim(); });
    okMain = applyTransfer(sh, pickRow, fhd);
  })();

  try { SpreadsheetApp.flush(); } catch (e) { }
  _clearSheetCache(CHECKLIST_MASTER_ID, 'Checklist_Today');

  if (!okToday && !okMain) throw new Error('Task nahi mili: emp=' + feid + ' taskDate=' + taskDate + ' uid="' + tuid + '"');

  return {
    success: true, task_name: taskName,
    from_emp: fromEmpId, to_emp: toId, to_emp_name: toEmpName,
    transferred_at: nowTs, transferred_by: managerName, reason: rea,
    updated_today: okToday, updated_main: okMain
  };
}

function markTeamTaskDone(rowNum, occ, taskName, empId, date, remarks, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isMarkAttendanceAllowed(user)) throw new Error('PERMISSION_DENIED');
  var today = date || getISTDate();
  var eid = String(empId || '').trim();
  var tname = String(taskName || '').trim().toLowerCase();
  var ss = _getSpreadsheet(CHECKLIST_MASTER_ID);
  var ts = getISTTimestamp();
  var r = parseInt(rowNum, 10);

  function markByRow(sh) {
    if (!sh || !r || r < 2 || r > sh.getLastRow()) return false;
    var lastCol = sh.getLastColumn();
    var hdrs = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
    var iNameId = hdrs.indexOf('Name Id'), iStatus = hdrs.indexOf('Status'), iActual = hdrs.indexOf('Actual');
    if (iStatus < 0 || iActual < 0) return false;
    var rowVals = sh.getRange(r, 1, 1, lastCol).getValues()[0];
    if (iNameId >= 0 && String(rowVals[iNameId] || '').trim() !== eid) return false;
    if (String(rowVals[iStatus] || '').trim() === 'Done') return true;
    rowVals[iActual] = ts;
    rowVals[iStatus] = 'Done';
    sh.getRange(r, 1, 1, rowVals.length).setValues([rowVals]);
    return true;
  }

  function markByOcc(sh) {
    if (!sh || sh.getLastRow() < 2) return false;
    var lastCol = sh.getLastColumn();
    var data = sh.getRange(1, 1, sh.getLastRow(), lastCol).getValues();
    var hdrs = data[0].map(function (h) { return String(h || '').trim(); });
    var iNameId = hdrs.indexOf('Name Id'), iPlanned = hdrs.indexOf('Planned');
    var iTask = hdrs.indexOf('Task'), iStatus = hdrs.indexOf('Status'), iActual = hdrs.indexOf('Actual');
    if (iStatus < 0 || iActual < 0) return false;
    var seen = 0;
    for (var i = 1; i < data.length; i++) {
      if (iNameId >= 0 && String(data[i][iNameId] || '').trim() !== eid) continue;
      if (iPlanned >= 0 && _normDateSafe(data[i][iPlanned]) !== today) continue;
      if (tname && iTask >= 0 && String(data[i][iTask] || '').trim().toLowerCase() !== tname) continue;
      if (seen !== (parseInt(occ, 10) || 0)) { seen++; continue; }
      if (String(data[i][iStatus] || '').trim() === 'Done') return true;
      data[i][iActual] = ts; data[i][iStatus] = 'Done';
      sh.getRange(i + 1, 1, 1, data[i].length).setValues([data[i]]);
      return true;
    }
    return false;
  }

  var shT = ss.getSheetByName('Checklist_Today'), shM = ss.getSheetByName('Checklist');
  var okT = markByRow(shT) || markByOcc(shT);
  var okM = markByRow(shM) || markByOcc(shM);
  try { SpreadsheetApp.flush(); } catch (e) { }
  _clearSheetCache(CHECKLIST_MASTER_ID, 'Checklist_Today');

  if (!okT && !okM) return { success: false, error: 'Task nahi mili' };
  return { success: true };
}

function managerShiftTask(taskId, empId, fromDate, toDate, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isMarkAttendanceAllowed(user)) throw new Error('PERMISSION_DENIED');

  var ss = _getSpreadsheet(CHECKLIST_MASTER_ID);
  var sh = ss.getSheetByName('Checklist');
  if (!sh) throw new Error('Checklist sheet not found');

  var data = sh.getDataRange().getValues();
  var hdrs = data[0].map(function (h) { return String(h || '').trim(); });
  var iUID = hdrs.indexOf('UID In TaskLIst');
  var iTaskId = hdrs.indexOf('Task ID');
  var iNameId = hdrs.indexOf('Name Id');
  var iPlanned = hdrs.indexOf('Planned');
  var iStatus = hdrs.indexOf('Status');

  for (var i = 1; i < data.length; i++) {
    var rowTaskId = String(data[i][iTaskId] || '').trim();
    var rowUID = String(data[i][iUID] || '').trim();
    var rowNameId = String(data[i][iNameId] || '').trim();
    var rowPlanned = _normDateSafe(data[i][iPlanned]);

    if ((rowTaskId === taskId || rowUID === taskId) && rowNameId === empId && rowPlanned === fromDate) {
      if (iPlanned >= 0) sh.getRange(i + 1, iPlanned + 1).setValue(toDate);
      if (iStatus >= 0) sh.getRange(i + 1, iStatus + 1).setValue('Shifted');
      return { success: true };
    }
  }
  return { success: false, error: 'Task not found' };
}

// ════════════════════════════════════════════════════════════════════════════
// MANAGER DELEGATION ACTIONS (Complete / Shift)
// ════════════════════════════════════════════════════════════════════════════

function managerCompleteDelegation(taskId, remarks, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isMarkAttendanceAllowed(user)) throw new Error('PERMISSION_DENIED');

  var today = getISTDate();
  var note = String(remarks || '').trim();
  // Write to Delegation sheet (NOT Task List) with real column headers
  var updates = {
    'Status': 'Completed',
    'Actual Close Date': today,
    'Timestamp': getISTTimestamp()
  };
  if (note) {
    updates['Completion Remarks'] = note;
    updates['Remark'] = note; // also keep generic Remark for older views
  }
  var ok = updateRowByField(MASTER_SHEET_ID, 'Delegation', 'Task ID', taskId, updates);
  if (!ok) throw new Error('Delegation task not found: ' + taskId);
  _clearSheetCache(MASTER_SHEET_ID, 'Delegation');
  return { success: true, stored_remark: note };
}

function managerShiftDelegation(taskId, newDueDate, reason, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isMarkAttendanceAllowed(user)) throw new Error('PERMISSION_DENIED');

  if (!newDueDate) throw new Error('New due date is required');
  var why = String(reason || '').trim();
  var updates = {
    'Status': 'Shifted',
    'Final Date': newDueDate,
    'Timestamp': getISTTimestamp()
  };
  if (why) {
    updates['Shift Reason'] = why;
    updates['Remark'] = why;
  }
  // Track revision slots if empty
  try {
    var dels = getSheetData(MASTER_SHEET_ID, 'Delegation');
    var del = null;
    for (var i = 0; i < dels.length; i++) {
      if (String(dels[i]['Task ID'] || '') === String(taskId)) { del = dels[i]; break; }
    }
    if (del) {
      var rev1 = String(del['Revision 1'] || '').trim();
      var rev2 = String(del['Revision 2'] || '').trim();
      if (!rev1) {
        updates['Revision 1'] = newDueDate;
        updates['R1 Timestamp'] = getISTTimestamp();
      } else if (!rev2) {
        updates['Revision 2'] = newDueDate;
        updates['R2 Timestamp'] = getISTTimestamp();
      }
    }
  } catch (e) { }

  var ok = updateRowByField(MASTER_SHEET_ID, 'Delegation', 'Task ID', taskId, updates);
  if (!ok) throw new Error('Delegation task not found: ' + taskId);
  _clearSheetCache(MASTER_SHEET_ID, 'Delegation');
  return { success: true, stored_reason: why, new_due_date: newDueDate };
}

function markTaskDone(rowNum, occ, taskUid, taskName, taskPlanned, date, remarks, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var empCode = _myCode(user);
  var tname = String(taskName || '').trim().toLowerCase();
  var tuid = String(taskUid || '').trim();
  var tplanned = String(taskPlanned || '').trim();
  var today = tplanned || date || getISTDate();
  var r = parseInt(rowNum, 10);
  var occi = parseInt(occ, 10) || 0;
  var ts = getISTTimestamp();
  var ss = _getSpreadsheet(CHECKLIST_MASTER_ID);
  var remarkStr = String(remarks || '').trim(); // optional completion remark

  Logger.log('[done] emp=' + empCode + ' tuid="' + tuid + '" tplanned=' + tplanned + ' today=' + today + ' remark="' + remarkStr + '"');

  // Ensure Remark column exists — adds it to end of sheet if missing
  function ensureRemarkCol(sh) {
    var lc = sh.getLastColumn();
    var hdrsR = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h || '').trim(); });
    if (hdrsR.indexOf('Remark') < 0) {
      sh.getRange(1, lc + 1).setValue('Remark');
      return lc + 1; // new column index (1-based)
    }
    return hdrsR.indexOf('Remark') + 1;
  }

  // Update Status+Actual+Remark for a specific row (read-modify-write)
  function markRow(sh, rowN) {
    var lc   = sh.getLastColumn();
    var hdrs = sh.getRange(1, 1, 1, lc).getValues()[0].map(function(h){ return String(h||'').trim(); });
    var iStat   = hdrs.indexOf('Status');
    var iAct    = hdrs.indexOf('Actual');
    var iNId    = hdrs.indexOf('Name Id');
    var iTransTo= hdrs.indexOf('Transferred To');
    var iRmk    = hdrs.indexOf('Remark');
    var iPlnd   = hdrs.indexOf('Planned');
    if (iStat < 0 || iAct < 0) {
      Logger.log('[done] markRow: missing Status/Actual cols');
      return false;
    }
    var vals = sh.getRange(rowN, 1, 1, lc).getValues()[0];
    var nameId  = iNId     >= 0 ? String(vals[iNId]     || '').trim() : '';
    var transTo = iTransTo >= 0 ? String(vals[iTransTo] || '').trim() : '';
    // Allow: original owner OR transfer recipient
    if (nameId !== empCode && transTo !== empCode) {
      Logger.log('[done] markRow: emp mismatch nameId='+nameId+' transTo='+transTo+' empCode='+empCode);
      return false;
    }

    var alreadyDone = String(vals[iStat] || '').trim() === 'Done';
    if (alreadyDone) {
      // Same-day remark edit only
      var todayIST   = getISTDate();
      var actualDay  = vals[iAct] ? _normDateSafe(vals[iAct]) : '';
      var plannedDay = (iPlnd >= 0 && vals[iPlnd] != null) ? _normDateSafe(vals[iPlnd]) : '';
      var canEdit = (actualDay && actualDay === todayIST) ||
                    (!actualDay && plannedDay === todayIST);
      if (!canEdit) {
        throw new Error('DONE_LOCKED: Sirf aaj complete kiye tasks ka remark edit ho sakta hai.');
      }
      if (remarkStr !== undefined && remarkStr !== null) {
        if (iRmk >= 0) {
          vals[iRmk] = String(remarkStr);
          sh.getRange(rowN, 1, 1, lc).setValues([vals]);
        } else if (remarkStr) {
          var rc = ensureRemarkCol(sh);
          sh.getRange(rowN, rc).setValue(String(remarkStr));
        }
        Logger.log('[done] Remark updated on already-Done row ' + rowN);
      }
      return true;
    }

    // First-time complete (aaj ya past pending — dono allow)
    vals[iStat] = 'Done';
    vals[iAct]  = ts;
    if (remarkStr) {
      if (iRmk >= 0) {
        vals[iRmk] = remarkStr;
        sh.getRange(rowN, 1, 1, lc).setValues([vals]);
      } else {
        var remarkCol = ensureRemarkCol(sh);
        sh.getRange(rowN, 1, 1, lc).setValues([vals]);
        sh.getRange(rowN, remarkCol).setValue(remarkStr);
      }
    } else {
      sh.getRange(rowN, 1, 1, lc).setValues([vals]);
    }
    Logger.log('[done] Row '+rowN+' marked Done, remark="'+remarkStr+'"');
    return true;
  }

  // Scan sheet for matching row (for Checklist_Today ~800 rows)
  function markByOcc(sh) {
    if (!sh || sh.getLastRow() < 2) return false;
    var lc = sh.getLastColumn();
    var data = sh.getRange(1, 1, sh.getLastRow(), lc).getValues();
    var hdrs = data[0].map(function (h) { return String(h || '').trim(); });
    var iNId = hdrs.indexOf('Name Id'), iTransTo = hdrs.indexOf('Transferred To');
    var iPlnd = hdrs.indexOf('Planned'), iTsk = hdrs.indexOf('Task');
    var iStat = hdrs.indexOf('Status'), iAct = hdrs.indexOf('Actual');
    var iRmk = hdrs.indexOf('Remark');
    if (iStat < 0 || iAct < 0) return false;
    var seen = 0;
    for (var i = 1; i < data.length; i++) {
      var nameId = iNId >= 0 ? String(data[i][iNId] || '').trim() : '';
      var transTo = iTransTo >= 0 ? String(data[i][iTransTo] || '').trim() : '';
      if (nameId !== empCode && transTo !== empCode) continue;
      if (iPlnd >= 0 && today) {
        var pd = _normDateSafe(data[i][iPlnd]);
        if (pd && pd !== today) continue;
      }
      if (tname && iTsk >= 0 && String(data[i][iTsk] || '').trim().toLowerCase() !== tname) continue;
      if (seen !== occi) { seen++; continue; }

      // Already Done → same-day remark edit only
      if (String(data[i][iStat] || '').trim() === 'Done') {
        var todayIST2 = getISTDate();
        var actualDay2 = data[i][iAct] ? _normDateSafe(data[i][iAct]) : '';
        var plannedDay2 = (iPlnd >= 0 && data[i][iPlnd] != null) ? _normDateSafe(data[i][iPlnd]) : '';
        var canEdit2 = (actualDay2 && actualDay2 === todayIST2) ||
                       (!actualDay2 && plannedDay2 === todayIST2);
        if (!canEdit2) {
          throw new Error('DONE_LOCKED: Sirf aaj complete kiye tasks ka remark edit ho sakta hai.');
        }
        if (remarkStr !== undefined && remarkStr !== null) {
          if (iRmk >= 0) {
            data[i][iRmk] = String(remarkStr);
            sh.getRange(i + 1, 1, 1, data[i].length).setValues([data[i]]);
          } else if (remarkStr) {
            var rmkColE = ensureRemarkCol(sh);
            sh.getRange(i + 1, rmkColE).setValue(String(remarkStr));
          }
        }
        return true;
      }

      // First-time complete (today or past pending)
      data[i][iStat] = 'Done';
      data[i][iAct] = ts;
      if (remarkStr && iRmk >= 0) data[i][iRmk] = remarkStr;
      sh.getRange(i + 1, 1, 1, data[i].length).setValues([data[i]]);
      if (remarkStr && iRmk < 0) {
        var rmkColNew = ensureRemarkCol(sh);
        sh.getRange(i + 1, rmkColNew).setValue(remarkStr);
      }
      return true;
    }
    return false;
  }

  // ── 1. Checklist_Today: direct by rowNum ──────────────────────────────────
  var shToday = ss.getSheetByName('Checklist_Today');
  var okToday = false;
  if (shToday) {
    if (r >= 2 && r <= shToday.getLastRow()) okToday = markRow(shToday, r);
    if (!okToday) okToday = markByOcc(shToday);
  }

  // ── 2. Checklist main: find by Task ID (rowNum is for Checklist_Today!) ───
  var okMain = false;
  (function () {
    var sh = ss.getSheetByName('Checklist');
    if (!sh || sh.getLastRow() < 2) return;
    var lastRow = sh.getLastRow();
    var lc = sh.getLastColumn();
    var hdrs = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h || '').trim(); });
    var iTaskId = hdrs.indexOf('Task ID');
    var iUID = hdrs.indexOf('UID In TaskLIst');
    var iNId = hdrs.indexOf('Name Id');
    var iPlnd = hdrs.indexOf('Planned');
    var iTsk = hdrs.indexOf('Task');
    var pickRow = -1;

    // Strategy A: exact Task ID match ("925be848-110_20260701")
    if (tuid && iTaskId >= 0) {
      var m1 = sh.getRange(2, iTaskId + 1, lastRow - 1, 1).createTextFinder(tuid).matchEntireCell(true).findAll();
      if (m1.length > 0) { pickRow = m1[0].getRow(); Logger.log('[done] Found by TaskID at row ' + pickRow); }

      // If not found, try constructing full ID: baseUID + task's own planned date
      if (pickRow < 0 && tplanned) {
        var baseUid = tuid.split('_')[0] || tuid;
        var fullId = baseUid + '_' + tplanned.replace(/-/g, '');
        Logger.log('[done] Trying "' + fullId + '"');
        var m2 = sh.getRange(2, iTaskId + 1, lastRow - 1, 1).createTextFinder(fullId).matchEntireCell(true).findAll();
        if (m2.length > 0) { pickRow = m2[0].getRow(); Logger.log('[done] Found constructed ID at row ' + pickRow); }
      }
    }

    // Strategy B: UID column exact match + date filter
    if (pickRow < 0 && tuid && iUID >= 0) {
      var baseUid2 = tuid.split('_')[0] || tuid;
      var mU = sh.getRange(2, iUID + 1, lastRow - 1, 1).createTextFinder(baseUid2).matchEntireCell(true).findAll();
      var seen2 = 0;
      for (var mu = 0; mu < mU.length; mu++) {
        var rnu = mU[mu].getRow();
        var rv = sh.getRange(rnu, 1, 1, lc).getValues()[0];
        if (iNId >= 0 && String(rv[iNId] || '').trim() !== empCode) continue;
        if (iPlnd >= 0 && tplanned && _normDateSafe(rv[iPlnd]) !== tplanned) continue;
        if (tname && iTsk >= 0 && String(rv[iTsk] || '').trim().toLowerCase() !== tname) continue;
        if (seen2 !== occi) { seen2++; continue; }
        pickRow = rnu; Logger.log('[done] UID fallback at row ' + rnu); break;
      }
    }

    if (pickRow < 0) { Logger.log('[done] Not found in Checklist (tuid=' + tuid + ')'); return; }
    okMain = markRow(sh, pickRow);
  })();

  try { SpreadsheetApp.flush(); } catch (e) { }
  _clearSheetCache(CHECKLIST_MASTER_ID, 'Checklist_Today');

  if (!okToday && !okMain) return { success: false, error: 'Task nahi mili: emp=' + empCode + ' date=' + today };
  return { success: true };
}

function saveNewTask(taskObj, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  // Validate
  if (!taskObj.task_name) throw new Error('Task name is required');
  if (!taskObj.emp_id) throw new Error('Doer is required');
  if (!taskObj.frequency) throw new Error('Frequency is required');
  if (!taskObj.start_date) throw new Error('Start date is required');

  var uid = 'TASK-' + _hex8();
  var freq = String(taskObj.frequency || 'D');

  // ── Date aur Time alag karo ───────────────────────────────
  var rawInput = String(taskObj.start_date || '');
  var startDateOnly = rawInput.substring(0, 10);             // yyyy-MM-dd
  // Time: from task_time field OR from datetime-local string — NO DEFAULT
  // User must provide time explicitly from the form
  var startTime = '';
  if (taskObj.task_time && taskObj.task_time.indexOf(':') > -1) {
    startTime = String(taskObj.task_time).substring(0, 5);
  } else if (rawInput.length >= 16) {
    startTime = rawInput.substring(11, 16);
  }
  if (!startTime) throw new Error('Task Time is required — form mein time field fill karo');
  // Format time for display: "10:30 AM" style
  function _fmtTime12(t) {
    if (!t || t.indexOf(':') < 0) return t;
    var parts = t.split(':');
    var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    return h12 + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;
  }
  var timeDisplay = _fmtTime12(startTime);

  // ── Day/Date = full IST timestamp "dd/MM/yyyy HH:mm:ss" ──────────────────
  // Week Day = "Monday" etc. (for W/E1st/E2nd/... freq)
  // Month Day = "8" etc. (for M/2M/Q/H/Y freq)
  var tz = _getTimezone();
  var startDtForSave = new Date(startDateOnly + 'T' + startTime + ':00');
  var dayDateVal = Utilities.formatDate(startDtForSave, tz, 'dd/MM/yyyy') + ' ' + startTime + ':00';
  // dayDateVal e.g. "08/08/2026 14:00:00" — plain text string, never parsed as Date

  var weekDayVal = '';  // e.g. "Friday" — only for W/E1st/E2nd/E3rd/E4th/ELast
  var monthDayVal = '';  // e.g. "8"       — only for M/2M/Q/4M/H/Y

  var dayNamesArr = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  if (freq === 'W' || ['E1st', 'E2nd', 'E3rd', 'E4th', 'ELast'].indexOf(freq) > -1) {
    var dowNum = taskObj.day_of_week !== undefined
      ? Number(taskObj.day_of_week)
      : new Date(startDateOnly + 'T12:00:00').getDay();
    weekDayVal = dayNamesArr[dowNum] || 'Monday';
    taskObj.day_of_week = dowNum;
  } else if (['M', '2M', 'Q', '4M', 'H', 'Y'].indexOf(freq) > -1) {
    var domNum = taskObj.day_of_month !== undefined
      ? Number(taskObj.day_of_month)
      : new Date(startDateOnly + 'T12:00:00').getDate();
    monthDayVal = String(domNum);
    taskObj.day_of_month = domNum;
  }

  // ── Task List mein save karo ──────────────────────────────
  var tlSS = SpreadsheetApp.openById(MASTER_SHEET_ID);
  var tlSh = tlSS.getSheetByName('Task List');
  if (!tlSh) throw new Error('Task List tab not found');

  // IDEMPOTENCY: agar same uid already exist karta hai toh double save rokein
  var tlLastRow = tlSh.getLastRow();
  var tlHdrs = tlSh.getRange(1, 1, 1, tlSh.getLastColumn()).getValues()[0];
  var uidColIdx = -1;
  var ddColIdx = -1;
  for (var ci4 = 0; ci4 < tlHdrs.length; ci4++) {
    var hx = String(tlHdrs[ci4] || '').trim();
    if (hx === 'Setup Task ID') uidColIdx = ci4 + 1;
    if (hx === 'Day/Date') ddColIdx = ci4 + 1;
  }
  if (uidColIdx > 0 && tlLastRow > 1) {
    var existingUids = tlSh.getRange(2, uidColIdx, tlLastRow - 1, 1).getValues();
    for (var ex = 0; ex < existingUids.length; ex++) {
      if (String(existingUids[ex][0] || '').trim() === uid) {
        console.warn('[saveNewTask] uid already exists, skipping duplicate write: ' + uid);
        // Jump straight to checklist generation (in case it failed last time)
        try {
          _generateChecklistForTask({
            uid: uid, task_name: String(taskObj.task_name || ''), emp_id: String(taskObj.emp_id || ''),
            emp_name: String(taskObj.emp_name || ''), dept: String(taskObj.dept || ''),
            email: String(taskObj.email || ''), frequency: freq,
            start_date: startDateOnly, start_time: startTime
          });
        } catch (ge2) { }
        return { success: true, task_uid: uid };
      }
    }
  }

  var tlRowMap = {
    'Task': String(taskObj.task_name || ''),
    'Task Name': String(taskObj.task_name || ''),
    'Doer Name': String(taskObj.emp_name || ''),
    'Name': String(taskObj.emp_name || ''),
    'Doer ID': String(taskObj.emp_id || ''),
    'Emp ID': String(taskObj.emp_id || ''),
    'Employee ID': String(taskObj.emp_id || ''),
    'Department': String(taskObj.dept || ''),
    'Dept': String(taskObj.dept || ''),
    'Frequency': freq,
    'Freq': freq,
    'Day/Date': dayDateVal,
    'Day Date': dayDateVal,
    'Week Day': weekDayVal,
    'Weekday': weekDayVal,
    'Month Day': monthDayVal,
    'Status': '',
    'Setup Task ID': uid,
    'Task ID': uid,
    'Delete Repeated Task': ''
  };
  // Case-insensitive header match
  var tlRowArr = tlHdrs.map(function (h) {
    var k = String(h || '').trim();
    if (tlRowMap[k] !== undefined) return tlRowMap[k];
    var kl = k.toLowerCase();
    for (var mk in tlRowMap) {
      if (mk.toLowerCase() === kl) return tlRowMap[mk];
    }
    return '';
  });
  // Ensure at least Task + Doer ID columns got values
  var nonEmpty = tlRowArr.filter(function (v) { return String(v).trim() !== ''; }).length;
  if (nonEmpty < 2) {
    throw new Error('Task List headers mismatch. Found: ' + tlHdrs.join(' | ') + '. Need columns like Task, Doer ID, Frequency, Setup Task ID');
  }

  var newTlRow = tlSh.getLastRow() + 1;

  // Set Plain Text on Day/Date BEFORE writing, then flush to guarantee order
  if (ddColIdx > 0) {
    tlSh.getRange(newTlRow, ddColIdx).setNumberFormat('@STRING@');
    SpreadsheetApp.flush(); // ensure format is applied before value write
  }
  tlSh.getRange(newTlRow, 1, 1, tlRowArr.length).setValues([tlRowArr]);
  SpreadsheetApp.flush(); // commit write before cache invalidation

  _clearSheetCache(MASTER_SHEET_ID, 'Task List');

  // ── Checklist rows generate karo ───────────────────
  var genCount = 0;
  try {
    genCount = _generateChecklistForTask({
      uid: uid,
      task_name: String(taskObj.task_name || ''),
      emp_id: String(taskObj.emp_id || ''),
      emp_name: String(taskObj.emp_name || ''),
      dept: String(taskObj.dept || ''),
      email: String(taskObj.email || ''),
      frequency: freq,
      start_date: startDateOnly,
      start_time: startTime
    }) || 0;
  } catch (ge) {
    console.warn('[saveNewTask] checklist gen failed: ' + ge.message);
    return { success: true, task_uid: uid, rows: 0, warn: 'Checklist generation failed: ' + ge.message };
  }

  return { success: true, task_uid: uid, rows: genCount };
}
/**
 * Generate checklist rows for a single task into Checklist.
 * Exact logic from reference createChecklist():
 * - Working Day Calendar check
 * - Skip Sundays (AppConfig B32 = "Yes")
 * - E1st/E2nd/E3rd/E4th/ELast frequency support
 * - Status='Sent' set in Task List after generation
 * - Duplicate Task IDs removed after append
 */
function _generateChecklistForTask(t) {
  // Parse start_date as local calendar date (avoid UTC shift)
  // Accepts: yyyy-MM-dd | dd/MM/yyyy | dd-MM-yyyy | Date | "dd/MM/yyyy HH:mm:ss"
  var startDt;
  try {
    var rawSd = t.start_date;
    if (Object.prototype.toString.call(rawSd) === '[object Date]' && !isNaN(rawSd.getTime())) {
      startDt = new Date(rawSd.getFullYear(), rawSd.getMonth(), rawSd.getDate(), 12, 0, 0);
    } else {
      var s0 = String(rawSd || '').trim();
      var mIso = s0.match(/^(\d{4})-(\d{2})-(\d{2})/);
      var mDmy = s0.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (mIso) {
        startDt = new Date(parseInt(mIso[1], 10), parseInt(mIso[2], 10) - 1, parseInt(mIso[3], 10), 12, 0, 0);
      } else if (mDmy) {
        startDt = new Date(parseInt(mDmy[3], 10), parseInt(mDmy[2], 10) - 1, parseInt(mDmy[1], 10), 12, 0, 0);
      } else {
        startDt = new Date(s0);
      }
    }
  } catch (e) { startDt = new Date(); }
  if (isNaN(startDt.getTime())) startDt = new Date();

  // Build working-day list. NEVER use Week List (only Mondays → collapses Daily to 1 row).
  var tz = _getTimezone();
  var skipSundays = getConfig('SKIP_SUNDAYS', 'Yes');
  var freq = String(t.frequency || 'D');
  var workDays = [];
  var workDaysSet = {};

  // Parse any date-ish value → yyyy-MM-dd (handles Date, ISO, dd/MM/yyyy display from getSheetData)
  function _toYmd(val) {
    if (val == null || val === '') return '';
    if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
      return Utilities.formatDate(val, tz, 'yyyy-MM-dd');
    }
    var s = String(val).trim();
    // yyyy-MM-dd or yyyy-MM-dd HH:mm:ss
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    // dd/MM/yyyy or dd-MM-yyyy (Sheets display in India)
    var dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) {
      var dd = ('0' + dmy[1]).slice(-2);
      var mm = ('0' + dmy[2]).slice(-2);
      return dmy[3] + '-' + mm + '-' + dd;
    }
    // last resort
    try {
      var d = new Date(s);
      if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    } catch (e) {}
    return '';
  }

  // Prefer real Working Day Calender if present and has enough dates
  try {
    var calRows = getSheetData(MASTER_SHEET_ID, 'Working Day Calender');
    if (!calRows || !calRows.length) {
      try { calRows = getSheetData(MASTER_SHEET_ID, 'Working Day Calendar'); } catch (e2) { calRows = []; }
    }
    (calRows || []).forEach(function (r) {
      var d = r['Working Dates'] || r['Working Date'] || r['Date'] || r['date'] || '';
      var ds = _toYmd(d);
      if (ds && !workDaysSet[ds]) { workDaysSet[ds] = true; workDays.push(ds); }
    });
  } catch (eCal) { }

  // If calendar missing / too thin (< 30 days), synthesize Mon–Sat from start date
  if (workDays.length < 30) {
    console.warn('[_generateChecklistForTask] calendar thin/empty (' + workDays.length + ') — synthesizing 200 work days');
    workDays = [];
    workDaysSet = {};
    var syn = new Date(startDt.getTime());
    for (var si = 0; si < 400 && workDays.length < 200; si++) {
      var dow = syn.getDay();
      if (dow !== 0) { // skip Sunday
        var ds2 = Utilities.formatDate(syn, tz, 'yyyy-MM-dd');
        if (!workDaysSet[ds2]) { workDaysSet[ds2] = true; workDays.push(ds2); }
      }
      syn.setDate(syn.getDate() + 1);
    }
  }

  function nthWeekdayOfMonth(year, month, weekday, n) {
    var d = new Date(year, month, 1);
    var count = 0;
    while (d.getMonth() === month) {
      if (d.getDay() === weekday) {
        count++;
        if (count === n) return new Date(d);
      }
      d.setDate(d.getDate() + 1);
    }
    return null;
  }
  function lastWeekdayOfMonth(year, month, weekday) {
    var d = new Date(year, month + 1, 0);
    while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
    return new Date(d);
  }
  function nextDate(d, f) {
    var n = new Date(d);
    var wd = n.getDay();
    switch (f) {
      case 'D': n.setDate(n.getDate() + 1); break;
      case 'W': n.setDate(n.getDate() + 7); break;
      case 'F': n.setDate(n.getDate() + 14); break;
      case 'M': n.setMonth(n.getMonth() + 1); break;
      case '2M': n.setMonth(n.getMonth() + 2); break;
      case 'Q': n.setMonth(n.getMonth() + 3); break;
      case '4M': n.setMonth(n.getMonth() + 4); break;
      case 'H': n.setMonth(n.getMonth() + 6); break;
      case 'Y': n.setFullYear(n.getFullYear() + 1); break;
      case 'E1st': n = nthWeekdayOfMonth(n.getFullYear(), n.getMonth() + 1, wd, 1) || n; break;
      case 'E2nd': n = nthWeekdayOfMonth(n.getFullYear(), n.getMonth() + 1, wd, 2) || n; break;
      case 'E3rd': n = nthWeekdayOfMonth(n.getFullYear(), n.getMonth() + 1, wd, 3) || n; break;
      case 'E4th': n = nthWeekdayOfMonth(n.getFullYear(), n.getMonth() + 1, wd, 4) || n; break;
      case 'ELast': n = lastWeekdayOfMonth(n.getFullYear(), n.getMonth() + 1, wd) || n; break;
      default: n.setDate(n.getDate() + 1);
    }
    return n;
  }
  // Snap to nearest listed working day (or keep date if synthesizer covers it)
  function nearestWorkDay(d) {
    var cand = new Date(d);
    for (var tries = 0; tries < 14; tries++) {
      var ds = Utilities.formatDate(cand, tz, 'yyyy-MM-dd');
      if (workDaysSet[ds]) {
        if (skipSundays === 'Yes' && cand.getDay() === 0) {
          cand.setDate(cand.getDate() - 1);
          continue;
        }
        return new Date(cand);
      }
      cand.setDate(cand.getDate() - 1);
    }
    return new Date(d);
  }

  // ── Time parts — store Planned as plain text (same as Task List Day/Date)
  // Writing JS Date objects causes timezone shift (17:00 → 04:30 etc.)
  var timeH = 9, timeM = 0;
  if (t.start_time && String(t.start_time).indexOf(':') > -1) {
    var tp = String(t.start_time).split(':');
    timeH = parseInt(tp[0], 10); if (isNaN(timeH)) timeH = 9;
    timeM = parseInt(tp[1], 10); if (isNaN(timeM)) timeM = 0;
  }
  function _makePlannedVal(dateObj) {
    // Always plain string "dd/MM/yyyy HH:mm:ss" — no Date object, no TZ shift
    var d = new Date(dateObj);
    var dd = ('0' + d.getDate()).slice(-2);
    var mm = ('0' + (d.getMonth() + 1)).slice(-2);
    var yyyy = d.getFullYear();
    var hh = ('0' + timeH).slice(-2);
    var mi = ('0' + timeM).slice(-2);
    return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + mi + ':00';
  }

  // ── Build rows — original style: until end of Working Day Calendar (full coverage) ──
  // Daily  → every working day from start → calendar last date
  // Weekly → every 7 days until calendar end
  // Monthly/etc → step by frequency until calendar end
  var rows = [];
  var seenDays = {};

  // Calendar end = last date in Working Day Calender; else 1 year from start
  var calEnd;
  if (workDays.length) {
    var maxYmd = workDays[0];
    for (var wi = 1; wi < workDays.length; wi++) {
      if (workDays[wi] > maxYmd) maxYmd = workDays[wi];
    }
    var mp = maxYmd.split('-');
    calEnd = new Date(parseInt(mp[0], 10), parseInt(mp[1], 10) - 1, parseInt(mp[2], 10), 23, 59, 59);
  } else {
    calEnd = new Date(startDt.getFullYear() + 1, startDt.getMonth(), startDt.getDate(), 23, 59, 59);
  }

  function _pushRow(dateObj) {
    if (dateObj > calEnd) return false;
    if (skipSundays === 'Yes' && dateObj.getDay() === 0) return false;
    // If real calendar loaded, only emit dates present in it
    if (workDays.length >= 30) {
      var ymd = Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd');
      if (!workDaysSet[ymd]) return false;
    }
    var ds = Utilities.formatDate(dateObj, tz, 'yyyyMMdd');
    if (seenDays[ds]) return false;
    seenDays[ds] = true;
    rows.push([
      String(t.emp_id || ''), String(t.emp_name || ''), String(t.email || ''), String(t.dept || ''),
      String(t.uid || '') + '_' + ds, freq, String(t.task_name || ''),
      _makePlannedVal(dateObj), '', '', String(t.email || ''), '', String(t.uid || '')
    ]);
    return true;
  }

  var cur = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate(), 12, 0, 0);
  var safety = 0;
  var maxSafety = 800;

  if (freq === 'D') {
    while (cur <= calEnd && safety < maxSafety) {
      safety++;
      _pushRow(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
  } else if (freq === 'W') {
    while (cur <= calEnd && safety < maxSafety) {
      safety++;
      _pushRow(new Date(cur));
      cur.setDate(cur.getDate() + 7);
    }
  } else if (freq === 'F') {
    while (cur <= calEnd && safety < maxSafety) {
      safety++;
      _pushRow(new Date(cur));
      cur.setDate(cur.getDate() + 14);
    }
  } else if (freq === 'M' || freq === '2M' || freq === 'Q' || freq === '4M' || freq === 'H') {
    var monthStep = ({ 'M': 1, '2M': 2, 'Q': 3, '4M': 4, 'H': 6 })[freq] || 1;
    while (cur <= calEnd && safety < maxSafety) {
      safety++;
      _pushRow(new Date(cur));
      cur.setMonth(cur.getMonth() + monthStep);
    }
  } else if (freq === 'Y') {
    while (cur <= calEnd && safety < maxSafety) {
      safety++;
      _pushRow(new Date(cur));
      cur.setFullYear(cur.getFullYear() + 1);
    }
  } else if (['E1st', 'E2nd', 'E3rd', 'E4th', 'ELast'].indexOf(freq) >= 0) {
    while (cur <= calEnd && safety < maxSafety) {
      safety++;
      var nxt = nextDate(new Date(cur), freq);
      _pushRow(nxt || new Date(cur));
      if (!nxt || nxt.getTime() <= cur.getTime()) {
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, cur.getDate(), 12, 0, 0);
      } else {
        cur = nxt;
      }
    }
  } else {
    _pushRow(new Date(cur));
  }

  if (!rows.length) {
    var fallback = new Date(startDt);
    if (fallback.getDay() === 0) fallback.setDate(fallback.getDate() + 1);
    var todayDs = Utilities.formatDate(fallback, tz, 'yyyyMMdd');
    rows.push([
      String(t.emp_id || ''), String(t.emp_name || ''), String(t.email || ''), String(t.dept || ''),
      String(t.uid || '') + '_' + todayDs, freq, String(t.task_name || ''),
      _makePlannedVal(fallback), '', '', String(t.email || ''), '', String(t.uid || '')
    ]);
  }

  console.log('[_generateChecklistForTask] uid=' + t.uid + ' freq=' + freq + ' rows=' + rows.length +
    ' start=' + Utilities.formatDate(startDt, tz, 'yyyy-MM-dd') +
    ' calEnd=' + Utilities.formatDate(calEnd, tz, 'yyyy-MM-dd') +
    ' workDays=' + workDays.length);

  var ss2 = _getSpreadsheet(CHECKLIST_MASTER_ID);
  var sh = ss2.getSheetByName('Checklist');
  if (!sh) throw new Error('Checklist tab not found');

  var hdrs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h || '').trim(); });
  var hIdx = {};
  hdrs.forEach(function (h, i) { hIdx[h] = i; });

  var colNames = ['Name Id', 'Name', 'Email', 'Department', 'Task ID', 'Freq', 'Task', 'Planned',
    'Status', 'Actual', 'Email For Buddy System', 'Buddy Email', 'UID In TaskLIst'];
  var numCols = hdrs.length;

  // Build 2D grid in RAM
  var grid = rows.map(function (r) {
    var row = new Array(numCols).fill('');
    colNames.forEach(function (name, i) {
      var ci = hIdx[name];
      if (ci !== undefined) row[ci] = r[i];
    });
    return row;
  });

  // ── Dedup in RAM before writing ────────────────────────────────────────────
  var iTaskId = hIdx['Task ID'];
  if (iTaskId !== undefined) {
    var existingLastRow = sh.getLastRow();
    var existingTaskIds = {};
    // FIX: previous code used (2, col, lastRow-1) which throws when lastRow===2
    if (existingLastRow >= 2) {
      sh.getRange(2, iTaskId + 1, existingLastRow, 1).getValues()
        .forEach(function (r) { if (r[0]) existingTaskIds[String(r[0]).trim()] = true; });
    }
    var seenNew = {};
    grid = grid.filter(function (row) {
      var tid = String(row[iTaskId] || '').trim();
      if (!tid) return false;
      if (existingTaskIds[tid] || seenNew[tid]) return false;
      seenNew[tid] = true;
      return true;
    });
  }

  if (!grid.length) {
    // All rows already exist — just mark Sent
    try { updateRowByField(MASTER_SHEET_ID, 'Task List', 'Setup Task ID', t.uid, { 'Status': 'Sent' }); } catch (e) { }
    return 0;
  }

  var iPlnd = hIdx['Planned'];
  var firstNewRow = sh.getLastRow() + 1;

  // Plain text format — prevents Sheets from re-interpreting as Date (TZ shift)
  if (iPlnd !== undefined) {
    sh.getRange(firstNewRow, iPlnd + 1, grid.length, 1).setNumberFormat('@STRING@');
  }
  SpreadsheetApp.flush();

  // Write ALL rows in ONE setValues call
  sh.getRange(firstNewRow, 1, grid.length, numCols).setValues(grid);
  SpreadsheetApp.flush(); // commit

  // ── Also append current-week rows to Checklist_Today so they appear immediately ──
  try {
    var shToday = ss2.getSheetByName('Checklist_Today');
    if (shToday && iPlnd !== undefined) {
      var nowIst = new Date(Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ss"));
      var dayOfWeek = nowIst.getDay(); // 0=Sun
      var daysFromMon = (dayOfWeek === 0) ? 6 : dayOfWeek - 1;
      var monday = new Date(nowIst);
      monday.setDate(nowIst.getDate() - daysFromMon);
      var weekDatesSet = {};
      for (var wi = 0; wi < 6; wi++) {
        var wd = new Date(monday);
        wd.setDate(monday.getDate() + wi);
        weekDatesSet[Utilities.formatDate(wd, tz, 'yyyy-MM-dd')] = true;
      }
      var todayGrid = [];
      for (var gi = 0; gi < grid.length; gi++) {
        var pVal = grid[gi][iPlnd];
        var pDateStr = '';
        if (pVal instanceof Date) {
          pDateStr = Utilities.formatDate(pVal, tz, 'yyyy-MM-dd');
        } else {
          // Plain text "dd/MM/yyyy HH:mm:ss" or already normalized
          pDateStr = _normDateSafe(pVal);
          if (!pDateStr && pVal) {
            var m = String(pVal).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
            if (m) pDateStr = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
          }
        }
        if (pDateStr && weekDatesSet[pDateStr]) {
          todayGrid.push(grid[gi].slice());
        }
      }
      if (todayGrid.length > 0) {
        var tLast = shToday.getLastRow();
        var tFirst = tLast + 1;
        // Ensure header exists
        if (tLast < 1) {
          shToday.getRange(1, 1, 1, numCols).setValues([hdrs]);
          tFirst = 2;
        }
        if (iPlnd !== undefined) {
          shToday.getRange(tFirst, iPlnd + 1, todayGrid.length, 1)
            .setNumberFormat('@STRING@');
        }
        shToday.getRange(tFirst, 1, todayGrid.length, numCols).setValues(todayGrid);
        SpreadsheetApp.flush();
        try { _clearSheetCache(CHECKLIST_MASTER_ID, 'Checklist_Today'); } catch (ce) {}
      }
    }
  } catch (todayErr) {
    console.warn('[_generateChecklistForTask] Checklist_Today append failed: ' + todayErr.message);
  }

  // Mark Sent
  try {
    updateRowByField(MASTER_SHEET_ID, 'Task List', 'Setup Task ID', t.uid, { 'Status': 'Sent' });
  } catch (se) {
    console.warn('[_generateChecklistForTask] status update failed: ' + se.message);
  }
  return grid.length;
}

/**
 * portalGenerateChecklist — regenerate checklist for ALL active tasks.
 * Called manually from Task Setup portal if needed.
 */
function portalGenerateChecklist(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var tasks = getSheetData(MASTER_SHEET_ID, 'Task List')
    .filter(function (t) {
      return String(t['Delete Repeated Task']) !== 'Yes' &&
        String(t['Status'] || '').toLowerCase() !== 'inactive';
    });

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  function getDoerEmail(empId) {
    var d = doers.filter(function (r) {
      return String(r['Emp ID'] || '').trim() === String(empId).trim();
    })[0];
    return d ? String(d['Office Email'] || '') : '';
  }
  function getDoerName(empId) {
    var d = doers.filter(function (r) {
      return String(r['Emp ID'] || '').trim() === String(empId).trim();
    })[0];
    return d ? String(d['Name'] || '') : '';
  }

  var generated = 0;
  tasks.forEach(function (t) {
    try {
      var empId = String(t['Doer ID'] || '');
      var dayDateRaw = String(t['Day/Date'] || '');
      var startTime = '';
      var tm = dayDateRaw.match(/(\d{1,2}):(\d{2})/);
      if (tm) startTime = ('0' + tm[1]).slice(-2) + ':' + tm[2];
      _generateChecklistForTask({
        uid: String(t['Setup Task ID'] || ''),
        task_name: String(t['Task'] || ''),
        emp_id: empId,
        emp_name: String(t['Doer Name'] || '') || getDoerName(empId),
        dept: String(t['Department'] || ''),
        email: getDoerEmail(empId),
        frequency: String(t['Frequency'] || 'D'),
        start_date: dayDateRaw,
        start_time: startTime
      });
      generated++;
    } catch (e) {
      console.warn('[portalGenerateChecklist] ' + t['Task'] + ': ' + e.message);
    }
  });

  return { success: true, generated: generated };
}

function deactivateTask(taskUid, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  // ── 1. Task List se row delete karo ──────────────────────
  var tss = _getSpreadsheet(MASTER_SHEET_ID);
  var tsh = tss.getSheetByName('Task List');
  if (!tsh) throw new Error('Task List not found');
  var tData = tsh.getDataRange().getValues();
  var tHdrs = tData[0].map(function (h) { return String(h || '').trim(); });
  var tUidCol = tHdrs.indexOf('Setup Task ID');
  var taskListDeleteRows = [];
  for (var i = tData.length - 1; i >= 1; i--) {
    if (String(tData[i][tUidCol] || '').trim() === taskUid) {
      taskListDeleteRows.push(i + 1);
    }
  }
  taskListDeleteRows.forEach(function (r) { tsh.deleteRow(r); });

  // ── 2. Checklist se ALL rows delete karo (pending + future) ─────────────
  var today = getISTDate();
  var css = _getSpreadsheet(CHECKLIST_MASTER_ID);
  var csh = css.getSheetByName('Checklist');
  var checklistDeleted = 0;
  if (csh && csh.getLastRow() > 1) {
    var cData = csh.getDataRange().getValues();
    var cHdrs = cData[0].map(function (h) { return String(h || '').trim(); });

    // Header-based column indices — works regardless of actual column order
    var cUidIdx = cHdrs.indexOf('UID In TaskLIst');
    var cStatusIdx = cHdrs.indexOf('Status');
    var cPlannedIdx = cHdrs.indexOf('Planned');

    if (cUidIdx < 0) throw new Error('Checklist: UID In TaskLIst column not found');

    // Collect rows to delete (bottom-up so row numbers stay valid during deletion)
    var toDelete = [];
    for (var j = cData.length - 1; j >= 1; j--) {
      var rowUid = String(cData[j][cUidIdx] || '').trim();
      if (rowUid !== taskUid) continue;

      // Delete ALL rows for this task (Pending + Done — task is being fully removed)
      toDelete.push(j + 1);
    }

    // ── Batch delete — group contiguous rows into ranges, ONE deleteRows() call each ──
    // deleteRow(n) = 1 API call per row. deleteRows(start, count) = 1 call per contiguous block.
    // This reduces N API calls to at most a handful, regardless of how many rows to delete.
    // toDelete is already in descending order (from bottom-up loop above).
    if (toDelete.length > 0) {
      // Group into contiguous blocks (descending)
      var blocks = [];
      var blockEnd = toDelete[0], blockStart = toDelete[0];
      for (var bi = 1; bi < toDelete.length; bi++) {
        if (toDelete[bi] === blockStart - 1) {
          // Extends current block upward
          blockStart = toDelete[bi];
        } else {
          blocks.push({ start: blockStart, end: blockEnd });
          blockEnd = toDelete[bi];
          blockStart = toDelete[bi];
        }
      }
      blocks.push({ start: blockStart, end: blockEnd });
      // Delete each block top→bottom within block, blocks in descending order
      blocks.forEach(function (b) {
        csh.deleteRows(b.start, b.end - b.start + 1);
      });
      checklistDeleted = toDelete.length;
    }
  }

  // ── 3. Checklist_Today se bhi same UID rows delete ─────────
  var todayDeleted = 0;
  try {
    var shToday = css.getSheetByName('Checklist_Today');
    if (shToday && shToday.getLastRow() > 1) {
      var tData2 = shToday.getDataRange().getValues();
      var tHdrs2 = tData2[0].map(function (h) { return String(h || '').trim(); });
      var tUidIdx = tHdrs2.indexOf('UID In TaskLIst');
      if (tUidIdx < 0) tUidIdx = tHdrs2.indexOf('UID In TaskList');
      if (tUidIdx >= 0) {
        var toDelToday = [];
        for (var tj = tData2.length - 1; tj >= 1; tj--) {
          if (String(tData2[tj][tUidIdx] || '').trim() === taskUid) {
            toDelToday.push(tj + 1);
          }
        }
        if (toDelToday.length > 0) {
          var blocksT = [];
          var bEnd = toDelToday[0], bStart = toDelToday[0];
          for (var tbi = 1; tbi < toDelToday.length; tbi++) {
            if (toDelToday[tbi] === bStart - 1) {
              bStart = toDelToday[tbi];
            } else {
              blocksT.push({ start: bStart, end: bEnd });
              bEnd = toDelToday[tbi];
              bStart = toDelToday[tbi];
            }
          }
          blocksT.push({ start: bStart, end: bEnd });
          blocksT.forEach(function (b) {
            shToday.deleteRows(b.start, b.end - b.start + 1);
          });
          todayDeleted = toDelToday.length;
        }
      }
    }
  } catch (todayDelErr) {
    console.warn('[deactivateTask] Checklist_Today delete failed: ' + todayDelErr.message);
  }

  // ── 4. Cache clear ────────────────────────────────────────
  _clearSheetCache(MASTER_SHEET_ID, 'Task List');
  _clearSheetCache(CHECKLIST_MASTER_ID, 'Checklist');
  _clearSheetCache(CHECKLIST_MASTER_ID, 'Checklist_Today');

  return {
    success: true,
    checklistRowsDeleted: checklistDeleted,
    checklistTodayDeleted: todayDeleted
  };
}

function getTaskSetup(empId, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var code = _myCode(user);
  var raw = getSheetData(MASTER_SHEET_ID, 'Task List')
    .filter(function (t) { return String(t['Delete Repeated Task']) !== 'Yes'; })
    .map(function (t) {
      return {
        task_uid: String(t['Setup Task ID'] || ''),
        task_name: String(t['Task'] || ''),
        emp_id: String(t['Doer ID'] || ''),
        emp_name: String(t['Doer Name'] || ''),
        dept: String(t['Department'] || ''),
        frequency: String(t['Frequency'] || 'D'),
        day_val: String(t['Day/Date'] || '')
      };
    });
  if (empId) return raw.filter(function (t) { return String(t.emp_id) === String(empId); });
  if (isManager(user)) return raw;
  return raw.filter(function (t) { return t.emp_id === code; });
}

function getWeekList(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var cache = CacheService.getScriptCache();
  var hit = cache.get('week_list_v2');
  if (hit) { try { return JSON.parse(hit); } catch (e) { } }
  var wl = getSheetData(MASTER_SHEET_ID, 'Week List').map(function (r) {
    return {
      week_num: Number(r['Week Number'] || 0),
      week_start: _normDateSafe(r['Week Start'])
    };
  });
  var str = JSON.stringify(wl);
  if (str.length < 90000) cache.put('week_list_v2', str, 600);
  return wl;
}

// ════════════════════════════════════════════════════════════════════════════
// DELEGATION MODULE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Enrich a raw delegation row into a clean object.
 * KEY FIX: _safeStr() is applied to Timestamp BEFORE .substring() is called.
 */
function _enrichDeleg(d, today) {
  var due = _normDateSafe(d['Final Date'] || d.final_date || d['First Date'] || d.first_date || '');
  var sts = String(d['Status'] || d.status || 'Pending');
  // ▼ BUG FIX: wrap Timestamp in _safeStr() to handle Date objects from GAS sheets
  var tsRaw = _safeStr(d['Timestamp'] || d.timestamp || '');
  // assigned_at = Timestamp column (when delegation was created/assigned)
  var assignedAt = tsRaw.substring(0, 19);
  // completed_at = actual_close_date if available, else Final Date when completed
  var completedAt = '';
  if (sts === 'Completed') {
    var acd = d['actual_close_date'] || d['Actual Close Date'] || d['Completed At'] || d['Completed On'] || '';
    completedAt = _normDateSafe(acd) || due;
  }
  return {
    task_id: String(d['Task ID'] || d.task_id || ''),
    delegated_by: String(d['Delegated By'] || d.delegated_by || ''),
    delegated_by_name: String(d['Delegated By Name'] || d.delegated_by_name || ''),
    delegated_to: String(d['Delegated To'] || d.delegated_to || ''),
    delegated_to_name: String(d['Delegated To Name'] || d.delegated_to_name || ''),
    task_desc: String(d['Task'] || d.task_desc || ''),
    first_date: _normDateSafe(d['First Date'] || d.first_date || ''),
    final_date: due,
    revision_1: _normDateSafe(d['Revision 1'] || d.revision_1 || ''),
    revision_2: _normDateSafe(d['Revision 2'] || d.revision_2 || ''),
    status: sts,
    photo_url: String(d['Photo'] || d.photo_url || ''),
    is_overdue: !!(due && sts !== 'Completed' && due < today),
    timestamp: assignedAt,
    assigned_at: assignedAt,          // same as timestamp — when it was assigned
    completed_at: completedAt,
    completion_remarks: String(d['Completion Remarks'] || d['Remark'] || d['Remarks'] || d.completion_remarks || d.remarks || ''),
    shift_reason: String(d['Shift Reason'] || d['Remark'] || d.shift_reason || ''),
    remarks: String(d['Remark'] || d['Remarks'] || d['Completion Remarks'] || d['Shift Reason'] || '')
  };
}

function getMyDelegations(status, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var empCode = _myCode(user);
  var today = getISTDate();
  return getSheetData(MASTER_SHEET_ID, 'Delegation')
    .filter(function (d) {
      var to = String(d['Delegated To'] || d.delegated_to || '');
      if (to !== empCode) return false;
      var s = String(d['Status'] || d.status || '');
      return !status || status === 'All' || s === status;
    })
    .map(function (d) { return _enrichDeleg(d, today); });
}

function getMyDelegatedOut(status, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var empCode = _myCode(user);
  var today = getISTDate();
  return getSheetData(MASTER_SHEET_ID, 'Delegation')
    .filter(function (d) {
      var by = String(d['Delegated By'] || d.delegated_by || '');
      if (by !== empCode) return false;
      var s = String(d['Status'] || d.status || '');
      return !status || status === 'All' || s === status;
    })
    .map(function (d) { return _enrichDeleg(d, today); });
}

function getAllDelegations(filters, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var today = getISTDate();
  var dels = getSheetData(MASTER_SHEET_ID, 'Delegation');

  if (filters) {
    if (filters.status && filters.status !== 'All')
      dels = dels.filter(function (d) { return String(d['Status'] || d.status || '') === filters.status; });
    if (filters.delegated_to)
      dels = dels.filter(function (d) { return String(d['Delegated To'] || d.delegated_to || '') === filters.delegated_to; });
    // Date filter uses Final Date (due date), NOT First Date (assigned date)
    // Kyunki manager ko sirf due/shifted dates dekhne hain, delegation create date nahi
    if (filters.from_date)
      dels = dels.filter(function (d) {
        var due = _normDateSafe(d['Final Date'] || d['First Date'] || '');
        return due >= filters.from_date;
      });
    if (filters.to_date)
      dels = dels.filter(function (d) {
        var due = _normDateSafe(d['Final Date'] || d['First Date'] || '');
        return due <= filters.to_date;
      });
    // Filter by specific employee (Delegated To emp_id)
    if (filters.delegated_to)
      dels = dels.filter(function (d) {
        return String(d['Delegated To'] || d.delegated_to || '') === filters.delegated_to;
      });
  }

  return dels.map(function (d) { return _enrichDeleg(d, today); });
}

function createDelegation(taskObj, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var empCode = _myCode(user);
  var taskId = 'Task-' + _hex8();
  var now = getISTTimestamp();

  appendRow(MASTER_SHEET_ID, 'Delegation', {
    'Task ID': taskId,
    'Delegated By': empCode,
    'Delegated By Name': String(user['Name'] || user.full_name || ''),
    'Delegated To': String(taskObj.delegated_to || ''),
    'Delegated To Name': String(taskObj.delegated_to_name || ''),
    'Task': String(taskObj.task_desc || ''),
    'First Date': String(taskObj.first_date || ''),
    'Revision 1': '', 'R1 Timestamp': '',
    'Revision 2': '', 'R2 Timestamp': '',
    'Final Date': String(taskObj.first_date || ''),
    'Status': 'Pending',
    'Photo': '',
    'Entry by': String(user['Office Email'] || user.email || ''),
    'Timestamp': now
  });
  // WA: notify assignee about new delegation
  try {
    var delMsg = '📌 *New Task Delegated to You*\n' +
      'Task: ' + String(taskObj.task_desc || '') + '\n' +
      'By: ' + String(user['Name'] || '') + '\n' +
      'Due Date: ' + String(taskObj.first_date || '—') + '\n' +
      '➡️ View & update on Joolry Daily.';
    _waSend(String(taskObj.delegated_to || ''), delMsg);
  } catch (e) { Logger.log('[WA] createDelegation error: ' + e.message); }
  return { success: true, task_id: taskId };
}

function updateDelegationStatus(taskId, status, remark, passedUser) {
  // remark optional — old clients may omit (passedUser shifts)
  if (arguments.length === 3) {
    // updateDelegationStatus(taskId, status, passedUser)
    passedUser = remark;
    remark = '';
  }

  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var empCode = _myCode(user);
  var today = getISTDate();
  var dels = getSheetData(MASTER_SHEET_ID, 'Delegation');
  var del = null;
  for (var i = 0; i < dels.length; i++) {
    if (String(dels[i]['Task ID'] || '') === String(taskId)) {
      del = dels[i];
      break;
    }
  }
  if (!del) throw new Error('Task not found');

  var to = String(del['Delegated To'] || '').trim();
  var by = String(del['Delegated By'] || '').trim();
  var curStatus = String(del['Status'] || '').trim();
  var isManagerUser = isManager(user);
  var isAssignee = (to === empCode);
  var isDelegator = (by === empCode);

  if (!isAssignee && !isDelegator && !isManagerUser) {
    throw new Error('PERMISSION_DENIED');
  }

  // Re-open Completed → only same calendar day as completion
  if (curStatus === 'Completed' && status !== 'Completed') {
    var completedOn = _normDateSafe(del['Final Date'] || del['Timestamp'] || '');
    if (!completedOn || completedOn !== today) {
      throw new Error('DONE_LOCKED: Sirf complete kiye hue din hi status wapas change ho sakta hai.');
    }
    if (!isAssignee && !isManagerUser) {
      throw new Error('PERMISSION_DENIED');
    }
  }

  var upd = {
    'Status': status,
    'Timestamp': getISTTimestamp()
  };

  if (status === 'Completed') {
    upd['Final Date'] = today;
    upd['Actual Close Date'] = today;
  }
  // Re-open: clear completion date
  if (curStatus === 'Completed' && status !== 'Completed') {
    upd['Final Date'] = '';
    upd['Actual Close Date'] = '';
  }

  if (remark !== undefined && remark !== null && String(remark).trim() !== '') {
    var rmk = String(remark).trim();
    upd['Remark'] = rmk;
    if (status === 'Completed') upd['Completion Remarks'] = rmk;
    if (status === 'Shifted') upd['Shift Reason'] = rmk;
  }

  updateRowByField(MASTER_SHEET_ID, 'Delegation', 'Task ID', taskId, upd);
  if (status === 'Completed' && curStatus !== 'Completed') {
    try {
      var doneMsg = '✅ *Task Completed*\n' +
        'Task: ' + String(del['Task'] || '') + '\n' +
        'Completed by: ' + String(user['Name'] || '') + '\n' +
        'On: ' + today + '\n' +
        'Check Joolry Daily for details.';
      _waSend(String(del['Delegated By'] || ''), doneMsg);
    } catch (e) {
      Logger.log('[WA] taskCompleted error: ' + e.message);
    }
  }

  return { success: true };
}

function requestDateRevision(taskId, newDate, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var dels = getSheetData(MASTER_SHEET_ID, 'Delegation');
  var del = null;
  for (var i = 0; i < dels.length; i++) {
    // ▼ BUG FIX: use _safeStr for Task ID field just in case
    if (_safeStr(dels[i]['Task ID'] || dels[i].task_id || '') === String(taskId)) {
      del = dels[i]; break;
    }
  }
  if (!del) throw new Error('Task not found: ' + taskId);

  var rev1 = _safeStr(del['Revision 1'] || del.revision_1 || '').trim();
  var rev2 = _safeStr(del['Revision 2'] || del.revision_2 || '').trim();
  var upd = { 'Status': 'Shifted', 'Final Date': newDate };

  if (!rev1) { upd['Revision 1'] = newDate; upd['R1 Timestamp'] = getISTTimestamp(); }
  else if (!rev2) { upd['Revision 2'] = newDate; upd['R2 Timestamp'] = getISTTimestamp(); }
  else { throw new Error('Maximum 2 date revisions already used for this task.'); }

  updateRowByField(MASTER_SHEET_ID, 'Delegation', 'Task ID', taskId, upd);
  // WA: notify delegator about date revision
  try {
    _waSend(String(del['Delegated By'] || ''),
      '📅 *Task Date Revised*\n' +
      'Task: ' + String(del['Task'] || '') + '\n' +
      'Revised by: ' + String(user['Name'] || '') + '\n' +
      'New Date: ' + newDate + '\n' +
      (rev1 && rev2 ? '⚠️ Max revisions used — no more shifts allowed.' : '') +
      '\nJoolry Daily'
    );
  } catch (eWA) { Logger.log('[WA] dateRevision error: ' + eWA.message); }
  return { success: true };
}

// ════════════════════════════════════════════════════════════════════════════
// ATTENDANCE MODULE
// ════════════════════════════════════════════════════════════════════════════
function getMyAttendance(empId, monthYear, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var empCode = empId || _myCode(user);
  if (empCode !== _myCode(user) && !isManager(user)) throw new Error('PERMISSION_DENIED');

  var hdThresh = _cfgNum('HALF_DAY_THRESHOLD_HRS', 6.0);
  var fullDayThreshHrs = hdThresh;
  var officeIn = getConfig('WORK_START_TIME', '10:00') || '10:00';
  var lateThresh = parseInt(getConfig('LATE_THRESHOLD_MINS', '15'), 10) || 15;
  var todayIST = getISTDate();

  try {
    var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
    for (var di = 0; di < doers.length; di++) {
      if (String(doers[di]['Emp ID'] || '').trim() === empCode) {
        var offIn = _extractTimeStr(doers[di]['Office IN']);
        var offOut = _extractTimeStr(doers[di]['Office OUT']);
        if (offIn) officeIn = offIn;
        if (offIn && offOut) {
          var expHrs = _hoursBetween(offIn, offOut);
          if (!isNaN(expHrs) && expHrs >= 3 && expHrs <= 14) {
            fullDayThreshHrs = expHrs * 0.75;
          }
        }
        break;
      }
    }
  } catch (eDl) {
    console.warn('[getMyAttendance] Doer List read: ' + eDl.message);
  }

  var daily = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance');
  var recs = daily.filter(function (a) {
    if (String(a['emp_id'] || '') !== String(empCode)) return false;
    var dt = _normDateSafe(a['date'] || '');
    return !monthYear || dt.substring(0, 7) === monthYear;
  });

  recs.sort(function (a, b) {
    return _normDateSafe(b['date'] || '').localeCompare(_normDateSafe(a['date'] || ''));
  });

  var sum = {
    full_days: 0,
    half_days: 0,
    absent: 0,
    holiday: 0,
    week_off: 0,
    late: 0
  };

  var records = recs.map(function (r) {
    var times = _attTimesFromRow(r);
    var ci = times.check_in;
    var co = times.check_out;

    var calculatedHours = '-';
    var calculatedHrsNum = 0;
    if (ci && ci !== '-' && co && co !== '-') {
      try {
        var ciP = ci.split(':'), coP = co.split(':');
        var diff = (parseInt(coP[0], 10) * 60 + parseInt(coP[1], 10)) -
                   (parseInt(ciP[0], 10) * 60 + parseInt(ciP[1], 10));
        if (diff > 0) {
          calculatedHrsNum = diff / 60;
          calculatedHours = Math.floor(diff / 60) + 'h ' +
            (diff % 60 < 10 ? '0' : '') + (diff % 60) + 'm';
        }
      } catch (e) { }
    }
    if (calculatedHours === '-') {
      var th = r['total_hours'];
      if (th && th !== '-') {
        if (Object.prototype.toString.call(th) === '[object Date]' && !isNaN(th.getTime())) {
          calculatedHours = Utilities.formatDate(th, 'Asia/Kolkata', 'HH:mm');
        } else {
          var s2 = String(th).trim();
          if (!isNaN(s2) && parseFloat(s2) > 0 && parseFloat(s2) < 1) {
            var hrsMins = Math.round(parseFloat(s2) * 24 * 60);
            calculatedHours = Math.floor(hrsMins / 60) + 'h ' + (hrsMins % 60) + 'm';
          } else {
            calculatedHours = s2 || '-';
          }
        }
      }
    }

    var rawStatus = String(r['status'] || '').trim();
    var st = _normAttStatus(rawStatus);
    if ((st === 'P' || st === 'HD') && calculatedHrsNum > 0) {
      st = calculatedHrsNum >= fullDayThreshHrs ? 'P' : 'HD';
    } else if (!rawStatus || st === 'A') {
      if (ci && ci !== '-') st = 'P';
    }

    // Past day: checked in, no punch-out → Half Day
    var recDate = _normDateSafe(r['date'] || '');
    if (recDate && recDate < todayIST && ci && ci !== '-' && (!co || co === '-')) {
      st = 'HD';
    }

    var statusLabel = st === 'P' ? 'Present'
      : st === 'HD' ? 'Half Day'
      : st === 'A' ? 'Absent'
      : st === 'H' ? 'Holiday'
      : st === 'WO' ? 'Week Off'
      : (rawStatus || '-');

    var halfDayReason = '';
    if (st === 'HD') {
      if (!co || co === '-') halfDayReason = 'No punch-out';
      else halfDayReason = 'Short hours';
    }

    var isLate = false;
    if ((st === 'P' || st === 'HD') && ci && ci !== '-') {
      isLate = _isLateCheckIn(ci, officeIn, lateThresh);
      if (isLate) sum.late++;
    }

    if (st === 'P') sum.full_days++;
    else if (st === 'HD') sum.half_days++;
    else if (st === 'A') sum.absent++;
    else if (st === 'H') sum.holiday++;
    else if (st === 'WO') sum.week_off++;

    return {
      emp_id: String(r['emp_id'] || ''),
      emp_name: String(r['emp_name'] || ''),
      dept: String(r['dept'] || ''),
      date: _normDateSafe(r['date'] || ''),
      day_name: String(r['day'] || ''),
      punch_in: ci,
      punch_out: co,
      total_hours: calculatedHours,
      check_in: ci,
      check_out: co,
      break_hours: '-',
      status: statusLabel,
      is_late: isLate,
      office_in: officeIn,
      half_day_reason: halfDayReason
    };
  });

  return { summary: sum, records: records };
}

function getMusterReport(dept, monthYear, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var att = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance').filter(function (a) {
    var ok = true;
    if (dept && dept !== 'All') ok = ok && String(a['dept'] || '') === dept;
    if (monthYear) ok = ok && _normDateSafe(a['date'] || '').substring(0, 7) === monthYear;
    return ok;
  });

  var map = {};
  att.forEach(function (a) {
    var eid = String(a['emp_id'] || '');
    if (!eid) return;
    if (!map[eid]) map[eid] = {
      emp_id: eid,
      emp_name: String(a['emp_name'] || ''),
      dept: String(a['dept'] || ''),
      month_year: monthYear || '',
      full_days: 0, half_days: 0, absent: 0, week_off: 0, holiday: 0
    };
    var s = String(a['status'] || '').trim();
    if (s === 'Present' || s === 'FD' || s === 'P') map[eid].full_days++;
    else if (s === 'HD') map[eid].half_days++;
    else if (s === 'Absent' || s === 'A') map[eid].absent++;
    else if (s === 'WO' || s === 'WE' || s === 'Week Off') map[eid].week_off++;
    else if (s === 'H') map[eid].holiday++;
    else if (a['check_in'] && String(a['check_in']).trim() !== '-') map[eid].full_days++;
  });

  return Object.keys(map).map(function (k) {
    var r = map[k];
    var wkg = r.full_days + r.half_days + r.absent;
    var pct = wkg > 0 ? Math.round((r.full_days + r.half_days * 0.5) / wkg * 100) : 0;
    return {
      emp_id: r.emp_id,
      emp_name: r.emp_name,
      dept: r.dept,
      month_year: r.month_year,
      full_days: r.full_days,
      half_days: r.half_days,
      absent: r.absent,
      week_off: r.week_off,
      holiday: r.holiday,
      present_pct: pct
    };
  }).sort(function (a, b) { return b.present_pct - a.present_pct; });
}

// ════════════════════════════════════════════════════════════════════════════
// MUSTER GRID — per-employee per-day attendance matrix
// Returns: [ { emp_id, emp_name, dept, days_present, days_absent, pct,
//              '2026-05-01':'Present', '2026-05-02':'-', ... } ]
// ════════════════════════════════════════════════════════════════════════════
function getMusterGrid(dept, monthYear, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var month = monthYear || Utilities.formatDate(new Date(), _getTimezone(), 'yyyy-MM');
  var yr = parseInt(month.split('-')[0], 10);
  var mo = parseInt(month.split('-')[1], 10) - 1;

  var daysInMonth = new Date(yr, mo + 1, 0).getDate();
  var allDates = [];
  for (var d = 1; d <= daysInMonth; d++) {
    var mm = (mo + 1) < 10 ? '0' + (mo + 1) : '' + (mo + 1);
    var dd = d < 10 ? '0' + d : '' + d;
    allDates.push(yr + '-' + mm + '-' + dd);
  }

  var holSet = {};
  try {
    getSheetData(MASTER_SHEET_ID, 'Holiday List').forEach(function (h) {
      var dt = _normDateSafe(h['Date'] || h['Holiday Date'] || '');
      if (dt && dt.substring(0, 7) === month) holSet[dt] = true;
    });
  } catch (e) { }

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var officeMap = _buildOfficeHoursMap(doers);
  var hdThresh = _cfgNum('HALF_DAY_THRESHOLD_HRS', 6.0);

  var needAttSet = {};
  var weekOffDayMapMuster = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '').trim();
    if (!id) return;
    var na = String(d['NeedAttendance'] || '').trim().toLowerCase();
    needAttSet[id] = (na !== 'no');
    weekOffDayMapMuster[id] = _parseWeekOffDay(d['Week Off Day']);
  });

  var att = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance').filter(function (a) {
    var eid = String(a['emp_id'] || '').trim();
    if (needAttSet.hasOwnProperty(eid) && !needAttSet[eid]) return false;
    var ok = _normDateSafe(a['date'] || '').substring(0, 7) === month;
    if (dept && dept !== 'All') ok = ok && String(a['dept'] || '') === dept;
    return ok;
  });

  var empMap = {};
  att.forEach(function (a) {
    var eid = String(a['emp_id'] || '').trim();
    if (!eid) return;
    var dt = _normDateSafe(a['date'] || '');
    if (!dt) return;

    if (!empMap[eid]) {
      empMap[eid] = {
        emp_id: eid,
        emp_name: String(a['emp_name'] || ''),
        dept: String(a['dept'] || '')
      };
      var empWOD0 = weekOffDayMapMuster.hasOwnProperty(eid) ? weekOffDayMapMuster[eid] : 0;
      allDates.forEach(function (date) {
        var dow = _dowFromYmd(date);
        empMap[eid][date] = (dow === empWOD0) ? 'WO' : (holSet[date] ? 'H' : '');
      });
    }

    var s = String(a['status'] || '').trim();
    var ci = String(a['check_in'] || '').trim();
    var th = String(a['total_hours'] || '').trim();
    var st = _normAttStatus(s);

    if ((st === 'P' || st === 'HD') && th && th !== '-') {
      var parsedHrs = _parseHoursStr(th);
      if (!isNaN(parsedHrs) && parsedHrs > 0) {
        var off = officeMap[eid];
        var fullDayThreshHrs = off ? off.expectedHrs * 0.75 : hdThresh;
        st = parsedHrs >= fullDayThreshHrs ? 'P' : 'HD';
      }
    }

    if (!st || st === 'A') {
      if (ci && ci !== '-' && !s) st = 'P';
    }

    // CRITICAL: Week Off / Holiday ko attendance row se overwrite mat karo
    var existing = empMap[eid][dt];
    if (existing === 'WO' || existing === 'H') {
      // keep WO / H
    } else if (st) {
      empMap[eid][dt] = st;
    }
  });

  // Employees with zero attendance rows still need a row (WO/H/Absent grid)
  doers.forEach(function (d) {
    var eid = String(d['Emp ID'] || '').trim();
    if (!eid) return;
    if (needAttSet.hasOwnProperty(eid) && !needAttSet[eid]) return;
    if (dept && dept !== 'All' && String(d['Department'] || '') !== dept) return;
    if (empMap[eid]) return;
    empMap[eid] = {
      emp_id: eid,
      emp_name: String(d['Name'] || ''),
      dept: String(d['Department'] || '')
    };
    var empWOD0 = weekOffDayMapMuster.hasOwnProperty(eid) ? weekOffDayMapMuster[eid] : 0;
    allDates.forEach(function (date) {
      var dow = _dowFromYmd(date);
      empMap[eid][date] = (dow === empWOD0) ? 'WO' : (holSet[date] ? 'H' : '');
    });
  });

  var result = Object.keys(empMap).map(function (eid) {
    var emp = empMap[eid];
    var empWOD = weekOffDayMapMuster.hasOwnProperty(eid) ? weekOffDayMapMuster[eid] : 0;
    var present = 0, absent = 0, hd = 0, wo = 0, hol = 0, working = 0;

    allDates.forEach(function (date) {
      var v = emp[date] || '';
      var dow = _dowFromYmd(date);
      var isHol = !!holSet[date];
      var isWO = (dow === empWOD);

      // Force correct status on WO / Holiday
      if (isWO) v = 'WO';
      else if (isHol && (v === '' || v === 'A')) v = 'H';

      if (!isWO && !isHol) working++;

      if (v === 'P') present++;
      else if (v === 'HD') hd++;
      else if (v === 'A') absent++;
      else if (v === 'WO') wo++;
      else if (v === 'H') hol++;
      else if (!isWO && !isHol && v === '') absent++;

      emp[date] = v || emp[date] || '';
    });

    var pct = working > 0 ? Math.round((present + hd * 0.5) / working * 100) : 0;
    emp.days_present = present;
    emp.days_hd = hd;
    emp.days_absent = absent;
    emp.days_wo = wo;
    emp.days_holiday = hol;
    emp.working_days = working;
    emp.pct = pct;
    return emp;
  });

  result.sort(function (a, b) { return a.emp_name.localeCompare(b.emp_name); });
  result = result.filter(function (r) {
    return !needAttSet.hasOwnProperty(r.emp_id) || needAttSet[r.emp_id] !== false;
  });
  return { rows: result, dates: allDates, holidays: Object.keys(holSet) };
}
// ════════════════════════════════════════════════════════════════════════════
// CHECKLIST ANALYTICS — per-employee task completion stats
// Returns workload distribution, freq breakdown, trend, top/bottom performers
// ════════════════════════════════════════════════════════════════════════════
function getChecklistAnalytics(monthYear, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var today = getISTDate();
  var month = monthYear || today.substring(0, 7);

  // ── Doer lookup ───────────────────────────────────────────────────────────
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var nameMap = {}, deptMap = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '');
    nameMap[id] = String(d['Name'] || '');
    deptMap[id] = String(d['Department'] || '');
  });

  // ── Read Checklist for the month ──────────────────────────────────────────
  // Use Checklist_Today if month = today's month (fast), else full scan
  var rows = [];
  var todayMonth = today.substring(0, 7);
  try {
    if (month === todayMonth) {
      // Staging sheet — only today's rows, very fast
      rows = getSheetData(CHECKLIST_MASTER_ID, 'Checklist_Today');
    } else {
      rows = getSheetData(CHECKLIST_MASTER_ID, 'Checklist').filter(function (l) {
        return _normDateSafe(l['Planned'] || '').substring(0, 7) === month;
      });
    }
  } catch (e) {
    // fallback: scan full Checklist
    try {
      rows = getSheetData(CHECKLIST_MASTER_ID, 'Checklist').filter(function (l) {
        return _normDateSafe(l['Planned'] || '').substring(0, 7) === month;
      });
    } catch (e2) { rows = []; }
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────
  var empMap = {}; // keyed by emp_id
  var freqMap = {}; // D, W, M, F, etc.
  var deptAgg = {}; // by department
  var dailyMap = {}; // by date

  rows.forEach(function (l) {
    var eid = String(l['Name Id'] || '').trim();
    var sts = String(l['Status'] || '').trim();
    var freq = String(l['Freq'] || 'D').trim();
    var date = _normDateSafe(l['Planned'] || '');
    var dept = String(l['Department'] || deptMap[eid] || 'Other').trim();
    var name = String(l['Name'] || nameMap[eid] || eid);
    var isDone = sts === 'Done';

    if (!eid) return;

    // Per employee
    if (!empMap[eid]) empMap[eid] = {
      emp_id: eid, name: name, dept: dept,
      planned: 0, done: 0, pending: 0,
      freqs: {}
    };
    empMap[eid].planned++;
    if (isDone) empMap[eid].done++;
    else empMap[eid].pending++;
    empMap[eid].freqs[freq] = (empMap[eid].freqs[freq] || 0) + 1;

    // Frequency
    freqMap[freq] = (freqMap[freq] || 0) + 1;

    // Department
    if (!deptAgg[dept]) deptAgg[dept] = { dept: dept, planned: 0, done: 0 };
    deptAgg[dept].planned++;
    if (isDone) deptAgg[dept].done++;

    // Daily trend
    if (date) {
      if (!dailyMap[date]) dailyMap[date] = { date: date, planned: 0, done: 0 };
      dailyMap[date].planned++;
      if (isDone) dailyMap[date].done++;
    }
  });

  // ── Build employee list ───────────────────────────────────────────────────
  var empList = Object.keys(empMap).map(function (k) {
    var e = empMap[k];
    e.completion_rate = e.planned > 0 ? Math.round(e.done / e.planned * 100) : 0;
    return e;
  }).sort(function (a, b) { return b.planned - a.planned; });

  var totalPlanned = rows.length;
  var totalDone = rows.filter(function (l) { return String(l['Status'] || '') === 'Done'; }).length;
  var totalPending = totalPlanned - totalDone;
  var avgRate = empList.length > 0
    ? Math.round(empList.reduce(function (s, e) { return s + e.completion_rate; }, 0) / empList.length) : 0;

  // ── Daily trend sorted ────────────────────────────────────────────────────
  var trend = Object.keys(dailyMap).sort().map(function (k) { return dailyMap[k]; });

  // ── Dept list ─────────────────────────────────────────────────────────────
  var deptList = Object.keys(deptAgg).sort().map(function (k) {
    var d = deptAgg[k];
    d.completion_rate = d.planned > 0 ? Math.round(d.done / d.planned * 100) : 0;
    return d;
  });

  // ── Frequency label map ───────────────────────────────────────────────────
  var freqLabels = {
    D: 'Daily', W: 'Weekly', F: 'Fortnightly', M: 'Monthly',
    '2M': 'Bi-Monthly', Q: 'Quarterly', H: 'Half-Yearly', Y: 'Yearly'
  };
  var freqList = Object.keys(freqMap).sort().map(function (f) {
    return { freq: f, label: freqLabels[f] || f, count: freqMap[f] };
  });

  return {
    month: month,
    total_planned: totalPlanned,
    total_done: totalDone,
    total_pending: totalPending,
    avg_completion: avgRate,
    employees: empList.length,
    by_employee: empList,
    by_dept: deptList,
    by_frequency: freqList,
    daily_trend: trend
  };
}

// ── Convert a Sheets serial date/datetime number to "yyyy-MM-dd HH:mm:ss" ────
// Sheets/Excel epoch is 1899-12-30. We format using UTC getters because the
// serial itself carries no timezone — it IS the calendar date/time as shown
// in the sheet, so UTC getters give back exactly that, with no extra shift.
function _serialToIso(serial) {
  var ms = Math.round((serial - 25569) * 86400 * 1000);
  var d = new Date(ms);
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
    p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}
function _cellToIso(v) {
  // Returns "yyyy-MM-dd HH:mm:ss", uniformly, whether the cell came back as a
  // Date object (SpreadsheetApp fallback), a Sheets serial number (Sheets API
  // path), or already-text. Mirrors the existing _safeStr() convention used
  // everywhere else in this file so downstream parsing stays consistent.
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, _getTimezone(), 'yyyy-MM-dd HH:mm:ss');
  if (typeof v === 'number') return _serialToIso(v);
  return String(v);
}

// ── Lean filtered reader for the large Checklist tab (~41k rows) ─────────────
// ── Generic fast bulk reader — Sheets API v4 first, SpreadsheetApp fallback ──
// This is THE reusable building block: any analytics function that needs to
// scan a whole tab can call this instead of getSheetData() when the tab is
// large enough that SpreadsheetApp's range/object-model overhead matters.
// Returns raw 2D values (row 0 = headers) — same shape as Range.getValues().
function _sheetsApiBulkRead(spreadsheetId, sheetName) {
  var t0 = Date.now();
  var raw = null;
  var label = '[_sheetsApiBulkRead:' + sheetName + ']';

  try {
    // FORMATTED_VALUE = exactly what user sees in Sheets ("10:49", not serial)
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId +
      '/values/' + encodeURIComponent(sheetName) +
      '?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS';
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() === 200) {
      raw = JSON.parse(resp.getContentText()).values || [];
    } else {
      console.warn(label + ' HTTP ' + resp.getResponseCode() + ' — falling back to SpreadsheetApp');
    }
  } catch (apiErr) {
    console.warn(label + ' failed (' + apiErr.message + ') — falling back to SpreadsheetApp');
  }
  console.log(label + ' Sheets API fetch: ' + (Date.now() - t0) + 'ms, rows=' + (raw ? raw.length : 'n/a'));

  if (!raw) {
    var t1 = Date.now();
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sh = ss.getSheetByName(sheetName);
    if (!sh) return [];
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    if (lr < 1) return [];
    // Display values on fallback too (same as UI)
    raw = sh.getRange(1, 1, lr, lc).getDisplayValues();
    console.log(label + ' SpreadsheetApp fallback fetch: ' + (Date.now() - t1) + 'ms');
  }
  return raw || [];
}

// ── Parallel multi-sheet bulk reader ──────────────────────────────────────────
// Takes [{spreadsheetId, sheetName}, ...] and fetches ALL of them in a single
// UrlFetchApp.fetchAll() batch instead of one-by-one — this is what lets
// getAnalyticsSummaryV2 / getEmployeeDetailV2 read Checklist + Delegation +
// Daily-Attendance in roughly the time of the SLOWEST single sheet, instead
// of the sum of all three. Falls back to SpreadsheetApp per-item if a
// particular fetch fails (same safety net as _sheetsApiBulkRead).
// Returns an array of raw 2D value-arrays, same order as the input requests.
function _sheetsApiBulkReadMulti(requests) {
  var t0 = Date.now();
  var token = ScriptApp.getOAuthToken();
  var fetchOpts = requests.map(function (r) {
    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + r.spreadsheetId +
      '/values/' + encodeURIComponent(r.sheetName) +
      '?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS';
    return { url: url, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
  });

  var responses = null;
  try {
    responses = UrlFetchApp.fetchAll(fetchOpts);
  } catch (e) {
    console.warn('[_sheetsApiBulkReadMulti] fetchAll failed (' + e.message + ') — falling back per-sheet');
  }
  console.log('[_sheetsApiBulkReadMulti] parallel fetch: ' + (Date.now() - t0) + 'ms for ' + requests.length + ' sheet(s)');

  return requests.map(function (r, i) {
    var resp = responses ? responses[i] : null;
    if (resp) {
      try {
        if (resp.getResponseCode() === 200) return JSON.parse(resp.getContentText()).values || [];
      } catch (parseErr) { /* fall through to SpreadsheetApp fallback below */ }
    }
    // Per-item fallback — same safety net as the single-sheet reader.
    try {
      var ss = SpreadsheetApp.openById(r.spreadsheetId);
      var sh = ss.getSheetByName(r.sheetName);
      if (!sh) return [];
      var lr = sh.getLastRow(), lc = sh.getLastColumn();
      if (lr < 1) return [];
      return sh.getRange(1, 1, lr, lc).getValues();
    } catch (e2) {
      console.warn('[_sheetsApiBulkReadMulti] fallback failed for ' + r.sheetName + ': ' + e2.message);
      return [];
    }
  });
}

// ── Lean filtered reader for the large Checklist tab (~41k rows) ─────────────
// Reads via _sheetsApiBulkRead, then filters by column INDEX and only builds
// a row object for rows that pass every filter. This is what keeps
// getChecklistAnalyticsV2 fast enough for multi-day / multi-month ranges.
// preloadedRaw (optional): if provided (e.g. from _sheetsApiBulkReadMulti),
// skips the network fetch entirely and filters this data instead.
function _readChecklistFiltered(from, to, deptFlt, freqFlt, empFlt, deptMap, preloadedRaw) {
  var raw = preloadedRaw || _sheetsApiBulkRead(CHECKLIST_MASTER_ID, 'Checklist');
  if (!raw.length) return [];
  var t2 = Date.now();
  var hdrs = raw[0].map(function (h) { return String(h || '').trim(); });
  var iName = hdrs.indexOf('Name');
  var iNameId = hdrs.indexOf('Name Id');
  var iDept = hdrs.indexOf('Department');
  var iFreq = hdrs.indexOf('Freq');
  var iTask = hdrs.indexOf('Task');
  var iPlanned = hdrs.indexOf('Planned');
  var iActual = hdrs.indexOf('Actual');
  var iStatus = hdrs.indexOf('Status');
  var iBuddy = hdrs.indexOf('Buddy Email');
  var out = [];
  for (var i = 1; i < raw.length; i++) {
    var r = raw[i];
    var eid = String(r[iNameId] || '').trim();
    if (!eid) continue;
    var plannedIso = _cellToIso(r[iPlanned]);
    var d = plannedIso ? plannedIso.substring(0, 10) : '';
    if (!d || d < from || d > to) continue;
    var dept = String(r[iDept] || deptMap[eid] || 'Other').trim();
    if (deptFlt !== 'all' && dept !== deptFlt) continue;
    var freq = String(r[iFreq] || 'D').trim();
    if (freqFlt !== 'all' && freq !== freqFlt) continue;
    if (empFlt !== 'all' && eid !== empFlt) continue;
    out.push({
      'Name Id': eid,
      'Name': r[iName],
      'Department': dept,
      'Freq': freq,
      'Task': r[iTask],
      'Planned': d,
      'Actual': _cellToIso(r[iActual]),
      'Status': r[iStatus],
      'Buddy Email': r[iBuddy]
    });
  }
  console.log('[_readChecklistFiltered] ' + (Date.now() - t2) + 'ms, rows=' + out.length);
  return out;
}

function getChecklistAnalyticsV2(filters, passedUser, preloadedRaw) {
  var _tStart = Date.now();
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  filters = filters || {};
  var today = getISTDate();

  // ── Resolve date range (default: 1st of this month → today) ──────────────
  var from = _normDate(filters.from) || (today.substring(0, 7) + '-01');
  var to = _normDate(filters.to) || today;
  if (to < from) { var _tmp = from; from = to; to = _tmp; } // swap if reversed

  var deptFlt = String(filters.dept || 'all');
  var freqFlt = String(filters.freq || 'all');
  var empFlt = String(filters.empId || 'all');

  // ── Doer lookup (name/dept fallback for rows missing those columns) ──────
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var nameMap = {}, deptMap = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '');
    nameMap[id] = String(d['Name'] || '');
    deptMap[id] = String(d['Department'] || '');
  });

  // ── Read Checklist rows for the range ─────────────────────────────────────
  // Fast path only when the range is exactly "today" (Checklist_Today is a
  // tiny staging tab with ~50-200 rows). Any other range reads the full
  // Checklist tab (~41k rows) via a lean index-based scan — see
  // _readChecklistFiltered() — which only builds a JS object for rows that
  // actually match the date range + filters, instead of materialising all
  // 41k rows like getSheetData() would. That's what keeps this fast enough
  // to stay under the frontend's request timeout.
  var isSingleToday = (from === today && to === today);
  var rows = [];
  if (isSingleToday) {
    try { rows = getSheetData(CHECKLIST_MASTER_ID, 'Checklist_Today'); }
    catch (e) { rows = []; }
  }
  if (!isSingleToday || !rows.length) {
    rows = _readChecklistFiltered(from, to, deptFlt, freqFlt, empFlt, deptMap, preloadedRaw);
  } else {
    // Checklist_Today path still needs the same filters applied
    rows = rows.filter(function (l) {
      var eid = String(l['Name Id'] || '').trim();
      if (!eid) return false;
      var d = _normDateSafe(l['Planned'] || '');
      if (!d || d < from || d > to) return false;
      var dept = String(l['Department'] || deptMap[eid] || 'Other').trim();
      var freq = String(l['Freq'] || 'D').trim();
      if (deptFlt !== 'all' && dept !== deptFlt) return false;
      if (freqFlt !== 'all' && freq !== freqFlt) return false;
      if (empFlt !== 'all' && eid !== empFlt) return false;
      return true;
    });
  }

  // ── Aggregation containers ────────────────────────────────────────────────
  var empMap = {}, freqMap = {}, deptAgg = {}, dailyMap = {}, taskMap = {};
  var weekdayMap = {}, hourMap = {}, monthMap = {}, deptFreqMatrix = {};
  var lagBuckets = { same_day: 0, day1: 0, day2_3: 0, day4plus: 0 };
  var agingBuckets = { d0_1: 0, d2_3: 0, d4_7: 0, d8plus: 0 };
  var onTime = 0, late = 0, buddyUsed = 0;
  var lagDaysSum = 0, lagDaysCount = 0;
  var overdueList = [];
  var empDetailLog = []; // only meaningful when empFlt !== 'all'

  // Build scheduled_time map from Task List — used for empDetailLog Plan Time column
  var _claTimeMap = {};
  if (empFlt !== 'all') {
    try {
      getSheetData(MASTER_SHEET_ID, 'Task List').forEach(function (tl) {
        var uid2 = String(tl['Setup Task ID'] || '').trim();
        var rawDD2 = tl['Day/Date'];
        if (!uid2) return;
        var tp2 = '';
        function _t(h, m) { return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h >= 12 ? ' PM' : ' AM'); }
        if (rawDD2 instanceof Date) { tp2 = _t(rawDD2.getHours(), rawDD2.getMinutes()); }
        else {
          var s2 = String(rawDD2 || '').trim();
          var dm = s2.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
          if (dm) tp2 = _t(parseInt(dm[4], 10), parseInt(dm[5], 10));
          else if (s2.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)) { var iso2 = new Date(s2); if (!isNaN(iso2)) tp2 = _t(iso2.getHours(), iso2.getMinutes()); }
          else if (s2.indexOf(' · ') > -1) tp2 = s2.substring(s2.indexOf(' · ') + 3).trim();
          else if (s2.match(/^\d{1,2}:\d{2}/)) tp2 = s2;
        }
        if (tp2) _claTimeMap[uid2] = tp2;
      });
    } catch (e3) { }
  }

  var WD_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  rows.forEach(function (l) {
    var eid = String(l['Name Id'] || '').trim();
    var sts = String(l['Status'] || '').trim();
    var freq = String(l['Freq'] || 'D').trim();
    var date = _normDateSafe(l['Planned'] || '');
    var dept = String(l['Department'] || deptMap[eid] || 'Other').trim();
    var name = String(l['Name'] || nameMap[eid] || eid);
    var task = String(l['Task'] || 'Untitled');
    var buddy = String(l['Buddy Email'] || '').trim();
    var isDone = sts === 'Done';
    if (buddy) buddyUsed++;

    // Per employee
    if (!empMap[eid]) empMap[eid] = {
      emp_id: eid, name: name, dept: dept,
      planned: 0, done: 0, pending: 0, on_time: 0, late: 0,
      freqs: {}, lag_days_sum: 0, lag_days_n: 0
    };
    var E = empMap[eid];
    E.planned++;
    E.freqs[freq] = (E.freqs[freq] || 0) + 1;

    freqMap[freq] = (freqMap[freq] || 0) + 1;

    if (!deptAgg[dept]) deptAgg[dept] = { dept: dept, planned: 0, done: 0, employees: {} };
    deptAgg[dept].planned++;
    deptAgg[dept].employees[eid] = true;

    if (!deptFreqMatrix[dept]) deptFreqMatrix[dept] = {};
    if (!deptFreqMatrix[dept][freq]) deptFreqMatrix[dept][freq] = { planned: 0, done: 0 };
    deptFreqMatrix[dept][freq].planned++;

    var tkey = task + '||' + dept;
    if (!taskMap[tkey]) taskMap[tkey] = { task: task, dept: dept, freq: freq, planned: 0, done: 0 };
    taskMap[tkey].planned++;

    var dow = date ? new Date(date + 'T00:00:00').getDay() : null;
    if (date) {
      if (!dailyMap[date]) dailyMap[date] = { date: date, planned: 0, done: 0 };
      dailyMap[date].planned++;

      var mKey = date.substring(0, 7);
      if (!monthMap[mKey]) monthMap[mKey] = { month: mKey, planned: 0, done: 0 };
      monthMap[mKey].planned++;

      if (!weekdayMap[dow]) weekdayMap[dow] = { day: WD_NAMES[dow], dow: dow, planned: 0, done: 0 };
      weekdayMap[dow].planned++;
    }

    var actualStr = _safeStr(l['Actual']);
    var actualDate = actualStr ? actualStr.substring(0, 10) : '';
    var actualHour = (actualStr && actualStr.length >= 13) ? parseInt(actualStr.substring(11, 13), 10) : null;

    if (isDone) {
      E.done++;
      deptAgg[dept].done++;
      deptFreqMatrix[dept][freq].done++;
      taskMap[tkey].done++;
      if (date && dailyMap[date]) dailyMap[date].done++;
      if (date && monthMap[date.substring(0, 7)]) monthMap[date.substring(0, 7)].done++;
      if (date && weekdayMap[dow]) weekdayMap[dow].done++;

      if (actualHour !== null && !isNaN(actualHour)) {
        var slot = actualHour < 6 ? 'Late Night (12-6am)'
          : actualHour < 12 ? 'Morning (6am-12pm)'
            : actualHour < 17 ? 'Afternoon (12-5pm)'
              : actualHour < 21 ? 'Evening (5-9pm)'
                : 'Night (9pm-12)';
        hourMap[slot] = (hourMap[slot] || 0) + 1;
      }

      if (date && actualDate) {
        var lagDays = Math.round((new Date(actualDate) - new Date(date)) / 86400000);
        if (lagDays <= 0) { onTime++; E.on_time++; lagBuckets.same_day++; }
        else {
          late++; E.late++;
          lagDaysSum += lagDays; lagDaysCount++;
          E.lag_days_sum += lagDays; E.lag_days_n++;
          if (lagDays === 1) lagBuckets.day1++;
          else if (lagDays <= 3) lagBuckets.day2_3++;
          else lagBuckets.day4plus++;
        }
      }
    } else {
      E.pending++;
      if (date && date < today) {
        var overdueDays = Math.round((new Date(today) - new Date(date)) / 86400000);
        if (overdueDays <= 1) agingBuckets.d0_1++;
        else if (overdueDays <= 3) agingBuckets.d2_3++;
        else if (overdueDays <= 7) agingBuckets.d4_7++;
        else agingBuckets.d8plus++;
        overdueList.push({
          emp_id: eid, name: name, dept: dept, task: task, freq: freq,
          planned: date, days_overdue: overdueDays
        });
      }
    }

    if (empFlt !== 'all') {
      var taskUidForLog = String(l['UID In TaskLIst'] || '').trim();
      var schedTimeLog = taskUidForLog ? (_claTimeMap[taskUidForLog] || '') : '';
      empDetailLog.push({
        date: date, task: task, freq: freq, status: sts || 'Pending',
        actual: actualStr ? actualStr : '', buddy_remark: buddy,
        remark: String(l['Remark'] || ''),
        scheduled_time: schedTimeLog
      });
    }
  });

  // ── Build employee list ───────────────────────────────────────────────────
  var empList = Object.keys(empMap).map(function (k) {
    var e = empMap[k];
    e.completion_rate = e.planned > 0 ? Math.round(e.done / e.planned * 100) : 0;
    e.on_time_rate = e.done > 0 ? Math.round(e.on_time / e.done * 100) : 0;
    e.avg_lag_days = e.lag_days_n > 0 ? Math.round(e.lag_days_sum / e.lag_days_n * 10) / 10 : 0;
    delete e.lag_days_sum; delete e.lag_days_n;
    return e;
  }).sort(function (a, b) { return b.planned - a.planned; });

  var totalPlanned = rows.length;
  var totalDone = rows.filter(function (l) { return String(l['Status'] || '') === 'Done'; }).length;
  var totalPending = totalPlanned - totalDone;
  // Overall completion rate, weighted by actual task volume — NOT an
  // unweighted average of each employee's own rate, which would let an
  // employee with 1 task done (100%) skew the "team average" just as much
  // as one with 90 done out of 100 (90%), badly misrepresenting the team's
  // real completion picture whenever task volume varies between employees.
  var avgRate = totalPlanned > 0 ? Math.round(totalDone / totalPlanned * 100) : 0;

  var trend = Object.keys(dailyMap).sort().map(function (k) { return dailyMap[k]; });

  var deptList = Object.keys(deptAgg).sort().map(function (k) {
    var d = deptAgg[k];
    return {
      dept: d.dept, planned: d.planned, done: d.done,
      pending: d.planned - d.done,
      employees: Object.keys(d.employees).length,
      completion_rate: d.planned > 0 ? Math.round(d.done / d.planned * 100) : 0
    };
  }).sort(function (a, b) { return b.planned - a.planned; });

  var freqLabels = {
    D: 'Daily', W: 'Weekly', F: 'Fortnightly', M: 'Monthly',
    '2M': 'Bi-Monthly', Q: 'Quarterly', H: 'Half-Yearly', Y: 'Yearly'
  };
  var freqList = Object.keys(freqMap).sort().map(function (f) {
    var planned = freqMap[f];
    var done = rows.filter(function (l) { return String(l['Freq'] || 'D').trim() === f && String(l['Status'] || '') === 'Done'; }).length;
    return {
      freq: f, label: freqLabels[f] || f, count: planned, done: done,
      completion_rate: planned > 0 ? Math.round(done / planned * 100) : 0
    };
  });

  var taskList = Object.keys(taskMap).map(function (k) {
    var t = taskMap[k];
    t.completion_rate = t.planned > 0 ? Math.round(t.done / t.planned * 100) : 0;
    t.pending = t.planned - t.done;
    return t;
  }).sort(function (a, b) { return b.planned - a.planned; });
  var mostMissedTasks = taskList.slice().sort(function (a, b) { return b.pending - a.pending; }).slice(0, 15);

  var weekdayList = [0, 1, 2, 3, 4, 5, 6].map(function (d) {
    var w = weekdayMap[d] || { day: WD_NAMES[d], dow: d, planned: 0, done: 0 };
    w.completion_rate = w.planned > 0 ? Math.round(w.done / w.planned * 100) : 0;
    return w;
  });

  var hourOrder = ['Morning (6am-12pm)', 'Afternoon (12-5pm)', 'Evening (5-9pm)', 'Night (9pm-12)', 'Late Night (12-6am)'];
  var hourList = hourOrder.filter(function (h) { return hourMap[h]; }).map(function (h) {
    return { slot: h, count: hourMap[h] };
  });

  var monthList = Object.keys(monthMap).sort().map(function (k) {
    var m = monthMap[k];
    m.completion_rate = m.planned > 0 ? Math.round(m.done / m.planned * 100) : 0;
    return m;
  });

  var deptFreqList = Object.keys(deptFreqMatrix).sort().map(function (d) {
    var freqs = Object.keys(deptFreqMatrix[d]).sort().map(function (f) {
      var v = deptFreqMatrix[d][f];
      return {
        freq: f, label: freqLabels[f] || f, planned: v.planned, done: v.done,
        completion_rate: v.planned > 0 ? Math.round(v.done / v.planned * 100) : 0
      };
    });
    return { dept: d, freqs: freqs };
  });

  overdueList.sort(function (a, b) { return b.days_overdue - a.days_overdue; });
  empDetailLog.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

  var employeeDetail = null;
  if (empFlt !== 'all' && empMap[empFlt]) {
    employeeDetail = {
      emp_id: empFlt, name: empMap[empFlt].name, dept: empMap[empFlt].dept,
      log: empDetailLog.slice(0, 300)
    };
  }

  console.log('[getChecklistAnalyticsV2] TOTAL: ' + (Date.now() - _tStart) + 'ms, rows=' + rows.length);

  return {
    from: from, to: to,
    filters: { dept: deptFlt, freq: freqFlt, empId: empFlt },

    total_planned: totalPlanned,
    total_done: totalDone,
    total_pending: totalPending,
    avg_completion: avgRate,
    employees: empList.length,

    on_time_done: onTime,
    late_done: late,
    on_time_rate: totalDone > 0 ? Math.round(onTime / totalDone * 100) : 0,
    late_rate: totalDone > 0 ? Math.round(late / totalDone * 100) : 0,
    avg_lag_days: lagDaysCount > 0 ? Math.round(lagDaysSum / lagDaysCount * 10) / 10 : 0,
    lag_distribution: lagBuckets,

    pending_aging: agingBuckets,
    overdue_tasks: overdueList.slice(0, 30),
    overdue_count: overdueList.length,

    distinct_tasks: taskList.length,
    buddy_usage_count: buddyUsed,
    buddy_usage_rate: totalPlanned > 0 ? Math.round(buddyUsed / totalPlanned * 100) : 0,
    working_days: Object.keys(dailyMap).length,

    by_employee: empList,
    by_dept: deptList,
    by_frequency: freqList,
    by_task: taskList.slice(0, 100),
    most_missed_tasks: mostMissedTasks,
    daily_trend: trend,
    monthly_trend: monthList,
    weekday_pattern: weekdayList,
    hour_pattern: hourList,
    dept_freq_matrix: deptFreqList,
    employee_detail: employeeDetail,

    // Raw filtered rows for click-to-drill-down on any card/number in the UI.
    // Capped to keep payload sane; cards with more underlying rows than this
    // will show a "showing first N of total" note in the drill-down popup.
    raw_log: rows.slice(0, 3000).map(function (l) {
      return {
        emp_id: l['Name Id'], name: l['Name'], dept: l['Department'],
        task: l['Task'], freq: l['Freq'], planned: l['Planned'],
        actual: l['Actual'], status: l['Status'] || 'Pending'
      };
    }),
    raw_log_total: rows.length
  };
}

// ════════════════════════════════════════════════════════════════════════════
// WHATSAPP NOTIFICATIONS — messageautosender.com API
// Credentials from AppConfig: WA_API_KEY, WA_BASIC_AUTH (optional overrides)
// Phone numbers from Doer List: 'Phone' column (10 digits, no country code)
// ════════════════════════════════════════════════════════════════════════════

// (WA credentials moved to global scope at top)

// Core send function — exactly as provided, no changes
function sendWhatsAppMessage(phone, message) {
  // Prefer hardcoded Joolry creds; AppConfig can override ONLY if non-empty Joolry values
  var API_KEY = WA_API_KEY;
  var BASIC_AUTH = WA_BASIC_AUTH;
  try {
    var k = getConfig('WA_API_KEY', '');
    var b = getConfig('WA_BASIC_AUTH', '');
    // Ignore sheet values that still point to old Fresko account
    if (k && k.indexOf('01de01ec') < 0 && String(k).toLowerCase().indexOf('fresko') < 0) API_KEY = k;
    if (b && b.indexOf('ZnJlc2tv') < 0 && String(b).toLowerCase().indexOf('fresko') < 0) BASIC_AUTH = b;
  } catch (eCfg) {}

  // Extract last 10 digits (Indian mobile number)
  var clean = String(phone).replace(/\D/g, '');
  var number = clean.length > 10 ? clean.slice(-10) : clean;

  if (!number || number.length !== 10) {
    Logger.log('⚠️ WA skip — invalid phone: ' + phone + ' → ' + number);
    return { success: false, error: 'Invalid phone: ' + phone };
  }

  // Force Joolry brand — strip any leftover Fresko and ensure footer
  var fullMsg = String(message || '')
    .replace(/Fresko\s*Staff\s*Portal/gi, 'Joolry Daily')
    .replace(/Fresko\s*Daily/gi, 'Joolry Daily')
    .replace(/Team\s*Fresko/gi, 'Team Joolry')
    .replace(/Fresko/gi, 'Joolry');
  if (!/Joolry\s*Daily/i.test(fullMsg)) {
    fullMsg = fullMsg.replace(/\s+$/, '') + '\n— *Joolry Daily*';
  }

  var payload = JSON.stringify({
    receiverMobileNo: number,
    message: [fullMsg]
  });

  Logger.log('📤 WA sending to: ' + number);
  Logger.log('📝 Message: ' + fullMsg.substring(0, 80));

  try {
    var response = UrlFetchApp.fetch(
      'https://app.messageautosender.com/api/v1/message/create?api_key=' + API_KEY,
      {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'accept': 'application/json',
          'Authorization': 'Basic ' + BASIC_AUTH,
          'x-api-key': API_KEY
        },
        payload: payload,
        muteHttpExceptions: true
      }
    );
    var statusCode = response.getResponseCode();
    var resText = response.getContentText();
    Logger.log('📨 WA response [' + statusCode + ']: ' + resText.substring(0, 200));

    if (statusCode === 200) {
      return { success: true };
    } else {
      Logger.log('❌ WA failed: ' + resText);
      return { success: false, status: statusCode, error: resText };
    }
  } catch (e) {
    Logger.log('🚨 WA exception: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WA TEST FUNCTIONS — Run these from GAS Editor > Run button
// After running, check Execution Log (View > Logs or Ctrl+Enter)
// ════════════════════════════════════════════════════════════════════════════

// STEP 1: Run this first — checks credentials and sends to YOUR number
function waTest_Step1_SendToMyNumber() {
  var MY_NUMBER = '9953333492'; // ← apna number daalo

  Logger.log('=== WA Test Step 1 ===');
  Logger.log('API_KEY: ' + WA_API_KEY.substring(0, 10) + '...');
  Logger.log('BASIC_AUTH: ' + WA_BASIC_AUTH.substring(0, 10) + '...');
  Logger.log('Sending to: ' + MY_NUMBER);

  var result = sendWhatsAppMessage(MY_NUMBER, 'Test from Joolry Daily ✅ ' + new Date().toLocaleTimeString());
  Logger.log('Result: ' + JSON.stringify(result));
}

// STEP 2: Run this — checks phone lookup from Doer List
function waTest_Step2_PhoneLookup() {
  Logger.log('=== WA Test Step 2: Phone Lookup ===');
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  Logger.log('Total doers: ' + doers.length);

  doers.slice(0, 5).forEach(function (d) {
    var empId = String(d['Emp ID'] || '');
    var name = String(d['Name'] || '');
    var phone = String(d['Phone'] || d['Mobile'] || d['Contact'] || '');
    Logger.log('EmpID: ' + empId + ' | Name: ' + name + ' | Phone: ' + phone);
  });

  // Test _waPhone lookup
  var testEmpId = doers[0] ? String(doers[0]['Emp ID'] || '') : '';
  var found = _waPhone(testEmpId);
  Logger.log('_waPhone("' + testEmpId + '") = "' + found + '"');
}

// STEP 3: Run this — sends to all managers
function waTest_Step3_SendToManagers() {
  Logger.log('=== WA Test Step 3: Send to Managers ===');
  var phones = _waManagerPhones();
  Logger.log('Manager phones: ' + JSON.stringify(phones));

  if (!phones.length) {
    Logger.log('❌ No manager phones found! Check Role column in Doer List (must be OWNER or MANAGER)');
    return;
  }

  phones.forEach(function (phone) {
    Logger.log('Sending to manager: ' + phone);
    var r = sendWhatsAppMessage(phone, '👋 Manager test from Joolry Daily');
    Logger.log('Result: ' + JSON.stringify(r));
  });
}

// STEP 4: Full API test with detailed response
function waTest_Step4_DetailedAPI() {
  var NUMBER = '9953333492'; // ← apna number daalo
  Logger.log('=== WA Test Step 4: Detailed API Call ===');

  var payload = JSON.stringify({
    receiverMobileNo: NUMBER,
    message: ['Joolry Daily API Test 🔥 Time: ' + new Date().toISOString()]
  });

  Logger.log('Payload: ' + payload);
  Logger.log('URL: https://app.messageautosender.com/api/v1/message/create?api_key=' + WA_API_KEY);

  try {
    var response = UrlFetchApp.fetch(
      'https://app.messageautosender.com/api/v1/message/create?api_key=' + WA_API_KEY,
      {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'accept': 'application/json',
          'Authorization': 'Basic ' + WA_BASIC_AUTH,
          'x-api-key': WA_API_KEY
        },
        payload: payload,
        muteHttpExceptions: true
      }
    );
    Logger.log('Status Code: ' + response.getResponseCode());
    Logger.log('Response Headers: ' + JSON.stringify(response.getHeaders()));
    Logger.log('Response Body: ' + response.getContentText());
  } catch (e) {
    Logger.log('❌ Exception: ' + e.message);
    Logger.log('This usually means GAS cannot reach external URL.');
    Logger.log('Fix: In GAS > Project Settings > check no firewall blocks UrlFetchApp');
  }
}

// Get phone number for an emp_id from Doer List
function _waPhone(empId) {
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  for (var i = 0; i < doers.length; i++) {
    if (String(doers[i]['Emp ID'] || '') === String(empId)) {
      return String(doers[i]['Phone'] || doers[i]['Mobile'] || doers[i]['Contact'] || '');
    }
  }
  return '';
}

// Get manager phones (OWNER + MANAGER roles)
function _waManagerPhones() {
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  return doers.filter(function (d) {
    var r = String(d['Role'] || '').toUpperCase();
    return r === 'OWNER' || r === 'MANAGER';
  }).map(function (d) { return String(d['Phone'] || d['Mobile'] || d['Contact'] || ''); })
    .filter(function (p) { return p.length >= 10; });
}

// Silent WA send — won't break if phone missing or API fails
function _waSend(empId, message) {
  try {
    if (!empId) { Logger.log('[WA] _waSend: empty empId'); return; }
    var phone = _waPhone(empId);
    if (!phone) {
      Logger.log('[WA] No phone for empId: ' + empId + ' (check Phone column in Doer List)');
      return;
    }
    Logger.log('[WA] Sending to empId=' + empId + ' phone=' + phone);
    var result = sendWhatsAppMessage(phone, message);
    Logger.log('[WA] Result: ' + JSON.stringify(result));
  } catch (e) {
    Logger.log('[WA] _waSend error: ' + e.message);
  }
}

function _waSendToManagers(message) {
  try {
    var phones = _waManagerPhones();
    phones.forEach(function (p) { sendWhatsAppMessage(p, message); });
  } catch (e) { Logger.log('WA manager send fail: ' + e.message); }
}

// ════════════════════════════════════════════════════════════════════════════
// BIRTHDAY & ANNIVERSARY — reads from Doer List
// Columns: 'Birth Date', 'Anniversary Date', 'Joining Date'
// ════════════════════════════════════════════════════════════════════════════
function getTodayCelebrations(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var today = getISTDate();          // 'YYYY-MM-DD'
  var todayMD = today.substring(5);    // 'MM-DD'
  Logger.log('[Celebrations] Today: ' + today + ' | Looking for MD: ' + todayMD);

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  Logger.log('[Celebrations] Doer count: ' + doers.length);
  var results = [];

  // Robustly parse any date format to 'YYYY-MM-DD'
  function parseAnyDate(rawVal) {
    if (!rawVal && rawVal !== 0) return '';
    // GAS Date object
    if (rawVal instanceof Date) {
      return Utilities.formatDate(rawVal, _getTimezone(), 'yyyy-MM-dd');
    }
    var s = String(rawVal).trim();
    if (!s || s === '' || s === 'null' || s === 'undefined') return '';
    // Pure number = Excel serial date
    if (/^\d+(\.\d+)?$/.test(s)) {
      var serial = parseFloat(s);
      if (serial > 1000) {
        var d = new Date(Math.round((serial - 25569) * 86400 * 1000));
        return Utilities.formatDate(d, _getTimezone(), 'yyyy-MM-dd');
      }
      return '';
    }
    // DD/MM/YYYY
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
      var p = s.split('/');
      return p[2] + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0');
    }
    // DD-MM-YYYY
    if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(s)) {
      var p2 = s.split('-');
      return p2[2] + '-' + p2[1].padStart(2, '0') + '-' + p2[0].padStart(2, '0');
    }
    // YYYY-MM-DD already
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Try GAS parse
    try {
      var d2 = new Date(s);
      if (!isNaN(d2.getTime())) return Utilities.formatDate(d2, _getTimezone(), 'yyyy-MM-dd');
    } catch (e) { }
    return '';
  }

  doers.forEach(function (d) {
    var empId = String(d['Emp ID'] || '').trim();
    var name = String(d['Name'] || '').trim();
    var dept = String(d['Department'] || '').trim();
    if (!empId || !name) return;

    function check(rawVal, type, icon, label) {
      var norm = parseAnyDate(rawVal);
      Logger.log('[Celebrations] ' + name + ' | ' + label + ' raw=' + String(rawVal).substring(0, 20) + ' → norm=' + norm);
      if (!norm || norm.length < 10) return;
      var md = norm.substring(5); // MM-DD
      if (md !== todayMD) return;
      var yr = parseInt(norm.substring(0, 4));
      var curYr = parseInt(today.substring(0, 4));
      results.push({
        emp_id: empId, name: name, dept: dept,
        type: type, icon: icon, label: label,
        years: curYr - yr > 0 ? curYr - yr : 0,
        phone: String(d['Phone'] || d['Mobile'] || d['Contact'] || '')
      });
      Logger.log('[Celebrations] ✅ MATCH: ' + name + ' - ' + label);
    }

    // Client policy: birthdays only — no anniversaries / work anniversaries
    check(d['Birth Date'], 'birthday', '🎂', 'Birthday');
  });

  Logger.log('[Celebrations] Total found: ' + results.length);
  return results;
}


function sendCelebrationWishes() {
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  // Use a dummy passedUser for system call
  var adminDoer = doers.filter(function (d) { return String(d['Role'] || '').toUpperCase() === 'OWNER'; })[0];
  if (!adminDoer) return;
  var fakeUser = { 'Emp ID': String(adminDoer['Emp ID'] || ''), 'Name': String(adminDoer['Name'] || ''), 'Role': 'OWNER', 'Office Email': String(adminDoer['Office Email'] || ''), 'Department': String(adminDoer['Department'] || '') };
  try {
    var celebrations = getTodayCelebrations(fakeUser);
    celebrations.forEach(function (cel) {
      if (!cel.phone) return;
      var yrsText = cel.years > 0 ? ' ' + cel.years + ' year' + (cel.years > 1 ? 's' : '') + '!' : '!';
      var msg;
      if (cel.type === 'birthday') {
        msg = cel.icon + ' *Happy Birthday ' + cel.name + '!*\n' +
          'Wishing you a wonderful day ahead. 🎉\n' +
          'Team Joolry';
      } else {
        msg = cel.icon + ' *Happy Work Anniversary ' + cel.name + '!*\n' +
          cel.years + ' amazing year' + (cel.years > 1 ? 's' : '') + ' with Joolry. Thank you! 🙏\n' +
          'Team Joolry';
      }
      sendWhatsAppMessage(cel.phone, msg);
      Logger.log('🎉 Wish sent to ' + cel.name + ' (' + cel.type + ')');
    });
  } catch (e) {
    Logger.log('sendCelebrationWishes error: ' + e.message);
  }
}

// ── Leave / WO / PTO Policy helpers (Joolry client policy) ─────────────────
// Weekly Off entitlement = number of Sundays in the month (can be taken any day).
// Salary fixed on 30-day month: daily = monthly / 30.
// Extra pay = (WO entitlement − WO taken) × daily rate when positive.
// Excess WO beyond entitlement → covered by PTO first, else Unpaid.
// Named staff get 11 PTO/year (or Doer List "PTO Annual" column).

var _PTO_DEFAULT_NAMES = {
  'shehnaz': 11, 'anand': 11, 'puja': 11, 'prakruti': 11, 'shailesh': 11, 'atul': 11
};

function _sundaysInMonth(year, month1to12) {
  var count = 0;
  var days = new Date(year, month1to12, 0).getDate();
  for (var d = 1; d <= days; d++) {
    if (new Date(year, month1to12 - 1, d).getDay() === 0) count++;
  }
  return count;
}

function _normLeaveType(t) {
  var s = String(t || '').trim().toLowerCase();
  if (s === 'weekly off' || s === 'week off' || s === 'wo' || s === 'w/o' || s === 'weeklyoff') return 'Weekly Off';
  if (s === 'pto' || s === 'paid time off' || s === 'paid leave' || s === 'pl') return 'PTO';
  if (s === 'unpaid' || s === 'lwp' || s === 'leave without pay' || s === 'unpaid leave') return 'Unpaid';
  if (s === 'sick leave' || s === 'sick') return 'Sick Leave';
  if (s === 'casual leave' || s === 'cl') return 'Casual Leave';
  return String(t || '').trim() || 'Other';
}

function _monthlySalaryFromDoer(d) {
  return Number(d['Basic Salary'] || d['Basic'] || d['basic_salary'] || d['Salary'] || d['basic'] || d['BASIC'] || 0);
}

function _ptoAnnualFromDoer(d) {
  var col = Number(d['PTO Annual'] || d['Annual PTO'] || d['PTO'] || d['pto_annual'] || 0);
  if (col > 0) return col;
  var name = String(d['Name'] || '').trim().toLowerCase();
  // Match first name token
  var first = name.split(/\s+/)[0] || '';
  if (_PTO_DEFAULT_NAMES[first] !== undefined) return _PTO_DEFAULT_NAMES[first];
  // Full name contains
  for (var k in _PTO_DEFAULT_NAMES) {
    if (name.indexOf(k) >= 0) return _PTO_DEFAULT_NAMES[k];
  }
  return 0;
}

function _countApprovedLeaveDaysByType(empId, monthYear /* yyyy-MM or '' for year */) {
  var counts = { 'Weekly Off': 0, 'PTO': 0, 'Unpaid': 0, 'Sick Leave': 0, 'Casual Leave': 0, 'Other': 0 };
  try {
    getSheetData(NEW_ATTENDANCE_SHEET_ID, 'leave_requests').forEach(function (l) {
      if (String(l['status'] || '').trim() !== 'Approved') return;
      if (String(l['emp_id'] || '').trim() !== String(empId)) return;
      var fd = _normDateSafe(l['from_date'] || '');
      var td = _normDateSafe(l['to_date'] || '');
      if (!fd || !td) return;
      var lt = _normLeaveType(l['leave_type']);
      var cur = new Date(parseInt(fd.substring(0, 4), 10), parseInt(fd.substring(5, 7), 10) - 1, parseInt(fd.substring(8, 10), 10));
      var end = new Date(parseInt(td.substring(0, 4), 10), parseInt(td.substring(5, 7), 10) - 1, parseInt(td.substring(8, 10), 10));
      while (cur <= end) {
        var ds = Utilities.formatDate(cur, 'Asia/Kolkata', 'yyyy-MM-dd');
        var include = true;
        if (monthYear && monthYear.length === 7) include = (ds.substring(0, 7) === monthYear);
        else if (monthYear && monthYear.length === 4) include = (ds.substring(0, 4) === monthYear);
        if (include) {
          if (counts[lt] === undefined) counts['Other'] += 1;
          else counts[lt] += 1;
        }
        cur.setDate(cur.getDate() + 1);
      }
    });
  } catch (e) { }
  return counts;
}

function _calcWoPayroll(monthlySalary, woEntitlement, woTaken, ptoTakenMonth, ptoRemainingBefore) {
  var daily = monthlySalary / 30;
  var woWorked = Math.max(0, woEntitlement - woTaken);
  var extraPay = Math.round(woWorked * daily);
  var excessWo = Math.max(0, woTaken - woEntitlement);
  var ptoCover = Math.min(excessWo, Math.max(0, ptoRemainingBefore));
  var unpaidFromExcess = excessWo - ptoCover;
  var unpaidDeduct = Math.round(unpaidFromExcess * daily);
  var net = Math.round(monthlySalary + extraPay - unpaidDeduct);
  return {
    daily_rate: Math.round(daily),
    wo_entitlement: woEntitlement,
    wo_taken: woTaken,
    wo_worked: woWorked,
    extra_pay: extraPay,
    excess_wo: excessWo,
    pto_cover: ptoCover,
    unpaid_from_excess: unpaidFromExcess,
    unpaid_deduction: unpaidDeduct,
    net_salary: Math.max(0, net)
  };
}

// ── Leave Management ──────────────────────────────────────────────────────
function requestLeave(leaveObj, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var empCode = _myCode(user);
  var requestId = 'LVR-' + _hex8();
  // Pure string arithmetic — avoids UTC timezone offset bug
  var fromParts = String(leaveObj.from_date || '').split('-');
  var toParts = String(leaveObj.to_date || '').split('-');
  var fromD = new Date(parseInt(fromParts[0]), parseInt(fromParts[1]) - 1, parseInt(fromParts[2]));
  var toD = new Date(parseInt(toParts[0]), parseInt(toParts[1]) - 1, parseInt(toParts[2]));
  var numDays = Math.ceil(Math.abs(toD - fromD) / 86400000) + 1;

  appendRow(NEW_ATTENDANCE_SHEET_ID, 'leave_requests', {
    'request_id': requestId,
    'emp_id': empCode,
    'emp_name': String(user['Name'] || user.full_name || ''),
    'dept': String(user['Department'] || user.department || ''),
    'leave_type': String(leaveObj.leave_type || ''),
    'from_date': String(leaveObj.from_date || ''),
    'to_date': String(leaveObj.to_date || ''),
    'num_days': numDays,
    'reason': String(leaveObj.reason || ''),
    'status': 'Pending',
    'approved_by': '',
    'approved_at': '',
    'requested_at': getISTTimestamp()
  });
  // WA: notify managers about new leave request
  try {
    var leaveMsg = '🗓️ *Leave Request — ' + String(leaveObj.leave_type || '') + '*\n' +
      'Employee: ' + String(user['Name'] || '') + ' (' + String(user['Department'] || '') + ')\n' +
      'Dates: ' + String(leaveObj.from_date || '') + ' to ' + String(leaveObj.to_date || '') +
      ' (' + numDays + ' day' + (numDays > 1 ? 's' : '') + ')\n' +
      'Reason: ' + String(leaveObj.reason || '—') + '\n' +
      'Status: ⏳ Pending approval\n' +
      '➡️ Please approve/reject on Joolry Daily.';
    _waSendToManagers(leaveMsg);
  } catch (e) { }
  return { success: true, request_id: requestId };
}

function getLeaveSummary(empId, monthYear, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var empCode = empId || _myCode(user);
  if (empCode !== _myCode(user) && !isManager(user)) throw new Error('PERMISSION_DENIED');

  var today = getISTDate();
  var month = monthYear || today.substring(0, 7);
  var yr = parseInt(month.split('-')[0], 10);
  var mo = parseInt(month.split('-')[1], 10);

  var counts = _countApprovedLeaveDaysByType(empCode, month);
  var woEnt = _sundaysInMonth(yr, mo);

  // Pending / rejected counts from requests
  var pending = 0, rejected = 0;
  try {
    getSheetData(NEW_ATTENDANCE_SHEET_ID, 'leave_requests').forEach(function (r) {
      if (String(r.emp_id) !== String(empCode)) return;
      var fd = _normDateSafe(r.from_date || '');
      if (month && fd && fd.substring(0, 7) !== month) return;
      var st = String(r.status || '');
      if (st === 'Pending') pending++;
      if (st === 'Rejected') rejected++;
    });
  } catch (e) { }

  var woTaken = counts['Weekly Off'] || 0;
  var ptoTaken = counts['PTO'] || 0;
  var unpaid = counts['Unpaid'] || 0;

  var summary = {
    emp_id: empCode,
    month_year: month,
    // Legacy fields (UI still reads some)
    sick_leave: counts['Sick Leave'] || 0,
    paid_leave: ptoTaken,
    casual_leave: counts['Casual Leave'] || 0,
    comp_off: 0,
    wfh: 0,
    lwp: unpaid,
    // Policy fields
    week_off_entitlement: woEnt,
    week_off_taken: woTaken,
    week_off_remaining: Math.max(0, woEnt - woTaken),
    week_off_worked: Math.max(0, woEnt - woTaken),
    pto_taken: ptoTaken,
    unpaid_taken: unpaid,
    total_approved: woTaken + ptoTaken + unpaid + (counts['Sick Leave'] || 0) + (counts['Casual Leave'] || 0),
    total_pending: pending,
    total_rejected: rejected
  };

  return [summary];
}

function getLeaveRequests(filters, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var empCode = _myCode(user);

  var allReqs = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'leave_requests');
  var myReqs = allReqs.filter(function (r) {
    if (isManager(user) && filters && filters.for === 'approvals') {
      // Manager sees all dept requests or all if no dept filter
      return true;
    }
    return String(r.emp_id) === empCode;
  });

  myReqs.sort(function (a, b) {
    return String(b.requested_at || '').localeCompare(String(a.requested_at || ''));
  });

  // Return clean objects with remark field included
  return myReqs.map(function (r) {
    return {
      request_id: String(r['request_id'] || ''),
      emp_id: String(r['emp_id'] || ''),
      emp_name: String(r['emp_name'] || ''),
      dept: String(r['dept'] || ''),
      leave_type: String(r['leave_type'] || ''),
      from_date: _normDate(String(r['from_date'] || '')),
      to_date: _normDate(String(r['to_date'] || '')),
      num_days: Number(r['num_days'] || 1),
      reason: String(r['reason'] || ''),
      status: String(r['status'] || 'Pending'),
      approved_by: String(r['approved_by'] || ''),
      remark: String(r['remark'] || ''),
      requested_at: String(r['requested_at'] || '')
    };
  });
}

function approveLeaveRequest(requestId, newStatus, remark, passedUser) {
  // remark is optional — if only 3 args, passedUser slides into remark position
  if (remark && typeof remark === 'object' && !passedUser) {
    passedUser = remark; remark = '';
  }
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');
  updateRowByField(NEW_ATTENDANCE_SHEET_ID, 'leave_requests', 'request_id', requestId, {
    'status': newStatus,
    'approved_by': String(user['Name'] || user.full_name || ''),
    'approved_at': getISTTimestamp(),
    'remark': String(remark || '')
  });
  // WA: notify employee
  try {
    var allReqs = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'leave_requests');
    var req = null;
    for (var ri = 0; ri < allReqs.length; ri++) {
      if (String(allReqs[ri]['request_id'] || '') === String(requestId)) { req = allReqs[ri]; break; }
    }
    if (req) {
      var ico = newStatus === 'Approved' ? '✅' : newStatus === 'Rejected' ? '❌' : '🔄';
      var lvMsg = ico + ' *Leave Request ' + newStatus + '*\n' +
        'Type: ' + String(req['leave_type'] || '') + '\n' +
        'Dates: ' + String(req['from_date'] || '') + ' to ' + String(req['to_date'] || '') + '\n' +
        'Reviewed by: ' + String(user['Name'] || '') +
        (remark ? 'Remark: ' + remark : '') + '\n' +
        'Check Joolry Daily for details.';
      _waSend(String(req['emp_id'] || ''), lvMsg);
    }
  } catch (e) { }
  return { success: true };
}

// Alias for backward compatibility (some HTML versions use this name)
function updateLeaveStatus(requestId, newStatus, passedUser) {
  return approveLeaveRequest(requestId, newStatus, passedUser);
}

// ── Cancel Leave Request (by employee) ──────────────────────────────────────
function cancelLeaveRequest(requestId, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var empCode = _myCode(user);
  // Only employee themselves or manager can cancel
  var reqs = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'leave_requests');
  var req = reqs.filter(function (r) { return String(r.request_id) === String(requestId); })[0];
  if (!req) return { success: false, error: 'Request not found' };
  if (String(req.emp_id) !== empCode && !isManager(user)) throw new Error('PERMISSION_DENIED');
  updateRowByField(NEW_ATTENDANCE_SHEET_ID, 'leave_requests', 'request_id', requestId, { 'status': 'Cancelled' });
  // WA: notify manager
  try {
    _waSendToManagers(
      '🚫 *Leave Request Cancelled*\n' +
      'By: ' + String(user['Name'] || '') + '\n' +
      'Request ID: ' + requestId + '\n' +
      'Joolry Daily'
    );
  } catch (eWA) { }
  return { success: true };
}

// ── Get Leave Balance ─────────────────────────────────────────────────────────
function getLeaveBalance(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var empCode = _myCode(user);
  var today = getISTDate();
  var currMonth = today.substring(0, 7);
  var year = today.substring(0, 4);
  var yr = parseInt(year, 10);
  var mo = parseInt(currMonth.split('-')[1], 10);

  var monthSum = getLeaveSummary(empCode, currMonth, passedUser);
  var base = monthSum && monthSum[0] ? monthSum[0] : {};

  // Year-to-date PTO taken
  var ytd = _countApprovedLeaveDaysByType(empCode, year);
  var ptoTakenYtd = ytd['PTO'] || 0;

  var monthlySalary = 0;
  var ptoAnnual = 0;
  try {
    var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
    for (var i = 0; i < doers.length; i++) {
      if (String(doers[i]['Emp ID'] || '').trim() === String(empCode)) {
        monthlySalary = _monthlySalaryFromDoer(doers[i]);
        ptoAnnual = _ptoAnnualFromDoer(doers[i]);
        break;
      }
    }
  } catch (e) { }

  var ptoRemaining = Math.max(0, ptoAnnual - ptoTakenYtd);
  var woEnt = _sundaysInMonth(yr, mo);
  var woTaken = base.week_off_taken || 0;
  var pay = _calcWoPayroll(monthlySalary, woEnt, woTaken, base.pto_taken || 0, ptoRemaining);

  base.pto_entitled = ptoAnnual;
  base.pto_taken_ytd = ptoTakenYtd;
  base.pto_remaining = ptoRemaining;
  base.monthly_salary = monthlySalary;
  base.daily_rate = pay.daily_rate;
  base.extra_pay_estimate = pay.extra_pay;
  base.unpaid_deduction_estimate = pay.unpaid_deduction;
  base.net_estimate = pay.net_salary;
  base.policy_note = 'WO entitlement = Sundays in month. Salary on 30-day basis. Extra pay for unused WO.';
  return base;
}

// ── Regularization Requests ───────────────────────────────────────────────────
// Sheet: regularization_requests
// Columns: reg_id, emp_id, emp_name, dept, reg_date, expected_in, expected_out,
//          reason, status, reviewed_by, reviewed_at, remarkbymanagement, requested_at

function requestRegularization(regObj, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var empCode = _myCode(user);
  var regId = 'REG-' + _hex8();

  appendRow(NEW_ATTENDANCE_SHEET_ID, 'regularization_requests', {
    'reg_id': regId,
    'emp_id': empCode,
    'emp_name': String(user['Name'] || user.full_name || ''),
    'dept': String(user['Department'] || user.department || ''),
    'reg_date': String(regObj.date || ''),
    'expected_in': String(regObj.req_in || ''),
    'expected_out': String(regObj.req_out || ''),
    'reason': String(regObj.reason || ''),
    'status': 'Pending',
    'reviewed_by': '',
    'reviewed_at': '',
    'remarkbymanagement': '',
    'requested_at': getISTTimestamp()
  });
  // WA: notify managers
  try {
    var regMsg = '📋 *Regularization Request*\n' +
      'Employee: ' + String(user['Name'] || '') + ' (' + String(user['Department'] || '') + ')\n' +
      'Date: ' + String(regObj.date || '') + '\n' +
      'Requested IN: ' + String(regObj.req_in || '—') + ' | OUT: ' + String(regObj.req_out || '—') + '\n' +
      'Reason: ' + String(regObj.reason || '—') + '\n' +
      '➡️ Approve/reject on Joolry Daily.';
    _waSendToManagers(regMsg);
  } catch (e) { }
  return { success: true, reg_id: regId };
}

function getRegularizationRequests(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var empCode = _myCode(user);
  var rows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'regularization_requests');

  // Manager sees dept requests, staff sees own
  var filtered = rows.filter(function (r) {
    if (isManager(user)) {
      // Show all or filter by dept
      return true;
    }
    return String(r['emp_id'] || '') === empCode;
  });

  filtered.sort(function (a, b) {
    return String(b['requested_at'] || '').localeCompare(String(a['requested_at'] || ''));
  });

  return filtered.map(function (r) {
    // _normDateSafe + _safeStr handle GAS Date objects from sheet
    var regDt = r['reg_date'];
    var expIn = r['expected_in'];
    var expOut = r['expected_out'];
    return {
      reg_id: String(r['reg_id'] || ''),
      emp_id: String(r['emp_id'] || ''),
      emp_name: String(r['emp_name'] || ''),
      dept: String(r['dept'] || ''),
      date: regDt instanceof Date
        ? Utilities.formatDate(regDt, _getTimezone(), 'yyyy-MM-dd')
        : _normDate(String(regDt || '')),
      req_in: expIn instanceof Date
        ? Utilities.formatDate(expIn, 'Asia/Kolkata', 'HH:mm')
        : String(expIn || '-'),
      req_out: expOut instanceof Date
        ? Utilities.formatDate(expOut, 'Asia/Kolkata', 'HH:mm')
        : String(expOut || '-'),
      reason: String(r['reason'] || ''),
      status: String(r['status'] || 'Pending'),
      remark: String(r['remarkbymanagement'] || '')
    };
  });
}

function approveRegularization(regId, newStatus, remark, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  updateRowByField(NEW_ATTENDANCE_SHEET_ID, 'regularization_requests', 'reg_id', regId, {
    'status': newStatus,
    'reviewed_by': String(user['Name'] || user.full_name || ''),
    'reviewed_at': getISTTimestamp(),
    'remarkbymanagement': String(remark || '')
  });

  // If approved — update the Daily-Attendance row for that date
  if (newStatus === 'Approved') {
    try {
      var regs = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'regularization_requests');
      var reg = regs.filter(function (r) { return String(r['reg_id']) === String(regId); })[0];
      if (reg && reg['reg_date'] && reg['emp_id']) {
        var attRows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance');
        var attRow = attRows.filter(function (a) {
          return String(a['emp_id']) === String(reg['emp_id']) &&
            _normDateSafe(a['date']) === _normDateSafe(reg['reg_date']);
        })[0];
        if (attRow && attRow['att_id']) {
          var updates = {};
          if (reg['expected_in']) updates['check_in'] = String(reg['expected_in']);
          if (reg['expected_out']) updates['check_out'] = String(reg['expected_out']);
          if (updates['check_in'] && updates['check_out']) {
            // Calculate total hours
            try {
              var inParts = String(reg['expected_in']).split(':');
              var outParts = String(reg['expected_out']).split(':');
              var inMins = parseInt(inParts[0]) * 60 + parseInt(inParts[1]);
              var outMins = parseInt(outParts[0]) * 60 + parseInt(outParts[1]);
              var diff = outMins - inMins;
              if (diff > 0) {
                var hrs = Math.floor(diff / 60);
                var min = diff % 60;
                updates['total_hours'] = hrs + 'h ' + (min < 10 ? '0' : '') + min + 'm';
              }
            } catch (te) { }
          }
          updates['status'] = 'Present';
          updateRowByField(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance', 'att_id', String(attRow['att_id']), updates);
        }
      }
    } catch (ae) {
      console.warn('[approveRegularization] att update: ' + ae.message);
    }
  }
  return { success: true };
}

// ── Attendance Analytics ───────────────────────────────────────────────────────
function getAttendanceAnalytics(dept, monthYear, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var month = monthYear || Utilities.formatDate(new Date(), _getTimezone(), 'yyyy-MM');
  var rows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance').filter(function (r) {
    var dateOk = _normDateSafe(r['date']).substring(0, 7) === month;
    var deptOk = !dept || dept === 'All' || String(r['dept']) === dept;
    return dateOk && deptOk;
  });

  var empMap = {};
  rows.forEach(function (r) {
    var id = String(r['emp_id'] || '');
    if (!id) return;
    if (!empMap[id]) empMap[id] = { name: String(r['emp_name'] || ''), present: 0, absent: 0, half: 0, total: 0 };
    var st = String(r['status'] || '');
    empMap[id].total++;
    if (st === 'Present' || st === 'P') empMap[id].present++;
    else if (st === 'Absent' || st === 'A') empMap[id].absent++;
    else if (st === 'HD' || st === 'Half Day') empMap[id].half++;
  });

  var emps = Object.keys(empMap).map(function (id) { return empMap[id]; });
  var totalPresent = 0, totalAbsent = 0;
  emps.forEach(function (e) { totalPresent += e.present; totalAbsent += e.absent; });
  var avgAtt = emps.length
    ? Math.round(emps.reduce(function (s, e) { return s + (e.total ? e.present / e.total * 100 : 0); }, 0) / emps.length)
    : 0;

  return {
    totalEmployees: emps.length,
    avgAttendance: avgAtt,
    totalPresent: totalPresent,
    totalAbsent: totalAbsent,
    month: month,
    dept: dept || 'All'
  };
}

// ── Portal Delete Task ─────────────────────────────────────────────────────────
function portalDeleteTask(taskUid, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');
  // Mark as Delete in Task List
  updateRowByField(MASTER_SHEET_ID, 'Task List', 'Setup Task ID', taskUid, {
    'Delete Repeated Task': 'Yes',
    'Status': 'Inactive'
  });
  // Invalidate cache
  var cs = CacheService.getScriptCache();
  cs.remove('sd_' + MASTER_SHEET_ID.slice(-6) + '_Task_List');
  return { success: true };
}

// ════════════════════════════════════════════════════════════════════════════
// ANALYTICS MODULE
// ════════════════════════════════════════════════════════════════════════════

/**
 * getAnalyticsSummary — called by the Analytics view in the HTML.
 * Returns dept_breakdown, status_breakdown, active_emps, pending_dels,
 * total_done, total_scheduled, completion_pct for a given month.
 */
function getAnalyticsSummary(monthYear, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var today = getISTDate();
  var month = monthYear || today.substring(0, 7);

  // ── Only fast cached reads — NO Checklist (too large) ────────────────────
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');  // TTL 10min
  var dels = getSheetData(MASTER_SHEET_ID, 'Delegation'); // TTL 1min

  // ── Dept map from Doer List ───────────────────────────────────────────────
  var deptMap = {};
  doers.forEach(function (d) {
    var dept = String(d['Department'] || 'Other').trim();
    if (!dept) return;
    if (!deptMap[dept]) deptMap[dept] = { dept: dept, employees: 0, planned: 0, done: 0 };
    deptMap[dept].employees++;
  });

  // ── Delegation counts (fast — small sheet, cached) ────────────────────────
  var pendingDels = 0, completedD = 0, overdueD = 0;
  dels.forEach(function (d) {
    var sts = String(d['Status'] || '');
    if (sts === 'Pending') pendingDels++;
    if (sts === 'Completed') completedD++;
    if (sts !== 'Completed' && sts !== 'Cancelled') {
      var due = _normDateSafe(d['Final Date'] || d['First Date'] || '');
      if (due && due < today) overdueD++;
    }
  });

  // ── Checklist_Today staging sheet — tiny, fast ───────────────────────────
  // Checklist_Today only has today's rows (~50-200 rows max)
  var totalDone = 0, totalPlanned = 0;
  try {
    var todayStr = today;
    var cts = getSheetData(CHECKLIST_MASTER_ID, 'Checklist_Today');
    cts.forEach(function (l) {
      // Checklist_Today may have all employees
      var dept = String(l['Department'] || 'Other').trim();
      if (!deptMap[dept]) deptMap[dept] = { dept: dept, employees: 0, planned: 0, done: 0 };
      totalPlanned++;
      deptMap[dept].planned++;
      if (String(l['Status']) === 'Done') {
        totalDone++;
        deptMap[dept].done++;
      }
    });
  } catch (e) {
    // Checklist_Today not available — use Checklist with strict limit
    try {
      var rows = getSheetData(CHECKLIST_MASTER_ID, 'Checklist');
      // Only scan last 500 rows (recent data)
      var slice = rows.length > 500 ? rows.slice(rows.length - 500) : rows;
      slice.forEach(function (l) {
        var pl = _normDateSafe(l['Planned']);
        if (!pl || pl.substring(0, 7) !== month) return;
        var dept2 = String(l['Department'] || 'Other').trim();
        if (!deptMap[dept2]) deptMap[dept2] = { dept: dept2, employees: 0, planned: 0, done: 0 };
        totalPlanned++;
        deptMap[dept2].planned++;
        if (String(l['Status']) === 'Done') { totalDone++; deptMap[dept2].done++; }
      });
    } catch (e2) { console.warn('[getAnalyticsSummary] checklist fallback: ' + e2.message); }
  }

  var depts = Object.keys(deptMap)
    .map(function (k) { return deptMap[k]; })
    .filter(function (d) { return d.employees > 0 || d.planned > 0; })
    .sort(function (a, b) { return b.done - a.done; });

  return {
    month: month,
    date: today,
    total_employees: doers.length,
    total_scheduled: totalPlanned,
    total_done: totalDone,
    completion_pct: totalPlanned > 0 ? Math.round(totalDone / totalPlanned * 100) : 0,
    pending_dels: pendingDels,
    completed_dels: completedD,
    overdue_dels: overdueD,
    dept_breakdown: depts,
    status_breakdown: { done: totalDone, pending: Math.max(0, totalPlanned - totalDone), overdue: overdueD }
  };
}

// ════════════════════════════════════════════════════════════════════════════
// ANALYTICS SUMMARY V2 — composite cross-module dashboard for management
// NEW function — getAnalyticsSummary() above is left completely untouched.
// Does NOT read any sheets directly: it composes getChecklistAnalyticsV2,
// getDelegationAnalyticsV2 and getAttendanceAnalyticsV2 (calling them as
// plain JS functions, not via the dispatch map) so the numbers shown here
// are GUARANTEED to match the three dedicated analytics pages exactly —
// no separate aggregation logic to drift out of sync, and no extra sheet
// reads beyond what those three functions already do.
// ════════════════════════════════════════════════════════════════════════════
function getAnalyticsSummaryV2(filters, passedUser) {
  var _tStart = Date.now();
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  filters = filters || {};
  var today = getISTDate();
  var from = _normDate(filters.from) || (today.substring(0, 7) + '-01');
  var to = _normDate(filters.to) || today;
  if (to < from) { var _tmp = from; from = to; to = _tmp; }
  var deptFlt = String(filters.dept || 'all');

  // ── Fetch all 3 sheets in ONE parallel batch instead of 3 sequential
  // round-trips — this is the main speed win for this composite endpoint.
  var rawData = _sheetsApiBulkReadMulti([
    { spreadsheetId: CHECKLIST_MASTER_ID, sheetName: 'Checklist' },
    { spreadsheetId: MASTER_SHEET_ID, sheetName: 'Delegation' },
    { spreadsheetId: NEW_ATTENDANCE_SHEET_ID, sheetName: 'Daily-Attendance' }
  ]);

  var cl = getChecklistAnalyticsV2({ from: from, to: to, dept: deptFlt, freq: 'all', empId: 'all' }, passedUser, rawData[0]);
  var dl = getDelegationAnalyticsV2({ from: from, to: to, dept: deptFlt, empId: 'all', giverId: 'all', status: 'all' }, passedUser, rawData[1]);
  var at = getAttendanceAnalyticsV2({ from: from, to: to, dept: deptFlt, empId: 'all', status: 'all' }, passedUser, rawData[2]);

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var totalEmployees = 0;
  doers.forEach(function (d) {
    var dept = String(d['Department'] || 'Other').trim();
    if (deptFlt === 'all' || dept === deptFlt) totalEmployees++;
  });

  // ── Merge dept breakdowns across all three modules (rates + raw counts) ──
  var deptMerge = {};
  function ensureDept(name) {
    if (!deptMerge[name]) deptMerge[name] = {
      dept: name, employees: 0,
      checklist_rate: null, checklist_planned: 0, checklist_done: 0,
      delegation_rate: null, delegation_assigned: 0, delegation_completed: 0, delegation_overdue: 0,
      attendance_rate: null, attendance_present: 0, attendance_half_day: 0, attendance_absent: 0, attendance_late: 0
    };
    return deptMerge[name];
  }
  (cl.by_dept || []).forEach(function (d) {
    var m = ensureDept(d.dept); m.employees = Math.max(m.employees, d.employees || 0);
    m.checklist_rate = d.completion_rate; m.checklist_planned = d.planned; m.checklist_done = d.done;
  });
  (dl.by_dept || []).forEach(function (d) {
    var m = ensureDept(d.dept); m.employees = Math.max(m.employees, d.employees || 0);
    m.delegation_rate = d.completion_rate; m.delegation_assigned = d.assigned; m.delegation_completed = d.completed; m.delegation_overdue = d.overdue;
  });
  (at.by_dept || []).forEach(function (d) {
    var m = ensureDept(d.dept); m.employees = Math.max(m.employees, d.employees || 0);
    m.attendance_rate = d.presence_pct; m.attendance_present = d.present; m.attendance_half_day = d.half_day; m.attendance_absent = d.absent;
  });
  // Late-arrival counts per dept (not in by_dept; derive from by_employee)
  (at.by_employee || []).forEach(function (e) {
    if (e.late > 0) { var m = ensureDept(e.dept); m.attendance_late += e.late; }
  });

  var deptBreakdown = Object.keys(deptMerge).sort().map(function (k) { return deptMerge[k]; });

  // ── Composite daily trend — checklist completion % & attendance presence %
  // on the same timeline, so the Overview can show one combined trend chart
  // instead of sending the user to two separate pages just to see the shape.
  var trendMap = {};
  (cl.daily_trend || []).forEach(function (t) {
    if (!trendMap[t.date]) trendMap[t.date] = { date: t.date };
    trendMap[t.date].checklist_pct = t.planned > 0 ? Math.round(t.done / t.planned * 100) : 0;
  });
  (at.daily_trend || []).forEach(function (t) {
    if (!trendMap[t.date]) trendMap[t.date] = { date: t.date };
    trendMap[t.date].attendance_pct = t.presence_pct;
  });
  var trend = Object.keys(trendMap).sort().map(function (k) { return trendMap[k]; });

  // ── Cross-module "Needs Attention" list — synthesizes weak signals from
  // all three modules into one prioritized list management can act on.
  var attnMap = {};
  function flag(empId, name, dept, reason) {
    if (!attnMap[empId]) attnMap[empId] = { emp_id: empId, name: name, dept: dept, reasons: [] };
    attnMap[empId].reasons.push(reason);
  }
  (cl.by_employee || []).forEach(function (e) { if ((e.completion_rate || 0) < 50 && e.planned > 0) flag(e.emp_id, e.name, e.dept, 'Low checklist completion (' + e.completion_rate + '%)'); });
  (dl.by_employee || []).forEach(function (e) { if ((e.overdue || 0) > 0) flag(e.emp_id, e.name, e.dept, e.overdue + ' overdue delegation' + (e.overdue > 1 ? 's' : '')); });
  (at.by_employee || []).forEach(function (e) {
    if ((e.late || 0) > 2) flag(e.emp_id, e.name, e.dept, e.late + ' late arrivals');
    if (e.working_days > 0 && (e.presence_pct || 0) < 75) flag(e.emp_id, e.name, e.dept, 'Low presence (' + e.presence_pct + '%)');
  });
  var needsAttention = Object.keys(attnMap).map(function (k) { return attnMap[k]; })
    .sort(function (a, b) { return b.reasons.length - a.reasons.length; }).slice(0, 10);

  console.log('[getAnalyticsSummaryV2] TOTAL: ' + (Date.now() - _tStart) + 'ms');

  return {
    from: from, to: to,
    filters: { dept: deptFlt },
    total_employees: totalEmployees,

    checklist: {
      planned: cl.total_planned, done: cl.total_done, pending: cl.total_pending,
      rate: cl.avg_completion, on_time_rate: cl.on_time_rate,
      overdue_count: cl.overdue_count
    },
    delegation: {
      assigned: dl.total_assigned, completed: dl.total_completed, pending: dl.total_pending,
      overdue: dl.total_overdue, rate: dl.completion_rate
    },
    attendance: {
      present: at.total_present, half_day: at.total_half_day, absent: at.total_absent, late: at.total_late,
      week_off: at.total_week_off, holiday: at.total_holiday,
      presence_pct: at.presence_pct, avg_hours: at.avg_hours
    },

    dept_breakdown: deptBreakdown,
    trend: trend,
    needs_attention: needsAttention,

    checklist_top5: (cl.by_employee || []).slice().sort(function (a, b) { return (b.completion_rate || 0) - (a.completion_rate || 0); }).slice(0, 5),
    delegation_overdue_top5: (dl.overdue_tasks || []).slice(0, 5),
    attendance_late_top5: (at.by_employee || []).filter(function (e) { return e.late > 0; }).sort(function (a, b) { return b.late - a.late; }).slice(0, 5)
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EMPLOYEE DETAIL V2 — single-call composite for Employee Directory's profile
// popup. Previously the frontend made 3 separate getXAnalyticsV2 calls (3
// full google.script.run round-trips); this does the same work server-side
// in ONE round-trip, fetching all 3 sheets in parallel via
// _sheetsApiBulkReadMulti. Existing getEmployeeStats() is untouched.
// ════════════════════════════════════════════════════════════════════════════
function getEmployeeDetailV2(empId, filters, passedUser) {
  var _tStart = Date.now();
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  filters = filters || {};
  var today = getISTDate();
  var from = _normDate(filters.from) || (today.substring(0, 7) + '-01');
  var to = _normDate(filters.to) || today;
  if (to < from) { var _tmp = from; from = to; to = _tmp; }

  var rawData = _sheetsApiBulkReadMulti([
    { spreadsheetId: CHECKLIST_MASTER_ID, sheetName: 'Checklist' },
    { spreadsheetId: MASTER_SHEET_ID, sheetName: 'Delegation' },
    { spreadsheetId: NEW_ATTENDANCE_SHEET_ID, sheetName: 'Daily-Attendance' }
  ]);

  var cl = getChecklistAnalyticsV2({ from: from, to: to, dept: 'all', freq: 'all', empId: empId }, passedUser, rawData[0]);
  var dl = getDelegationAnalyticsV2({ from: from, to: to, dept: 'all', empId: empId, giverId: 'all', status: 'all' }, passedUser, rawData[1]);
  var at = getAttendanceAnalyticsV2({ from: from, to: to, dept: 'all', empId: empId, status: 'all' }, passedUser, rawData[2]);

  // Include NeedAttendance flag so frontend can hide attendance card regardless of empDir cache
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var needAtt = true;
  for (var xi = 0; xi < doers.length; xi++) {
    if (String(doers[xi]['Emp ID'] || '').trim() === String(empId)) {
      var na = String(doers[xi]['NeedAttendance'] || '').trim().toLowerCase();
      needAtt = (na !== 'no');
      break;
    }
  }

  console.log('[getEmployeeDetailV2] TOTAL: ' + (Date.now() - _tStart) + 'ms');
  return { from: from, to: to, checklist: cl, delegation: dl, attendance: at, need_attendance: needAtt };
}


/**
 * getTeamAnalytics — original function kept for backward compatibility.
 * Returns today-focused analytics (not month-filtered).
 */
function getTeamAnalytics(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var today = getISTDate();
  var month = today.substring(0, 7);
  return getAnalyticsSummary(month, passedUser);
}

/**
 * getPerformanceReport — called by the Performance Reports view in the HTML.
 * Wraps getMyPerformance with the expected parameter signature.
 */
function getPerformanceReport(empId, fromDate, toDate, passedUser) {
  return getMyPerformance(empId, fromDate, toDate, passedUser);
}

function getMyPerformance(empId, fromDate, toDate, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var empCode = empId || _myCode(user);
  if (empCode !== _myCode(user) && !isManager(user)) throw new Error('PERMISSION_DENIED');

  var from = fromDate || _daysAgo(30);
  var to = toDate || getISTDate();

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var dRow = null;
  var deptMap = {};
  for (var x = 0; x < doers.length; x++) {
    deptMap[String(doers[x]['Emp ID'] || '')] = String(doers[x]['Department'] || '');
    if (String(doers[x]['Emp ID']) === String(empCode)) { dRow = doers[x]; break; }
  }

  // Read from Checklist — Checklist_Today (a small ~150-row staging tab) is
  // only safe to use when the ENTIRE requested range is exactly today; for
  // any other range (this month, last 30 days, a historical custom range,
  // etc.) this scans the full ~41k-row Checklist sheet via the same lean,
  // properly date+employee-filtered reader Checklist Analytics uses, so
  // older data is never silently missing.
  var today = getISTDate();
  var logs;
  if (from === today && to === today) {
    var tRows = [];
    try { tRows = getSheetData(CHECKLIST_MASTER_ID, 'Checklist_Today'); } catch (e) { tRows = []; }
    logs = tRows.filter(function (l) { return String(l['Name Id']) === String(empCode); });
  } else {
    logs = _readChecklistFiltered(from, to, 'all', 'all', empCode, deptMap);
  }

  // Build daily map from→to
  var dailyMap = {};
  var cur = new Date(from);
  var end = new Date(to);
  while (cur <= end) {
    var key = Utilities.formatDate(cur, _getTimezone(), 'yyyy-MM-dd');
    dailyMap[key] = 0;
    cur.setDate(cur.getDate() + 1);
  }
  logs.forEach(function (l) {
    var p = _normDateSafe(l['Planned']);
    if (String(l['Status']) === 'Done' && dailyMap[p] !== undefined) dailyMap[p]++;
  });

  var daily = Object.keys(dailyMap).sort().map(function (k) {
    return { date: k, done: dailyMap[k] };
  }).slice(-30);

  var totalDone = logs.filter(function (l) { return String(l['Status']) === 'Done'; }).length;
  var totalPlanned = logs.length;
  var setup = getSheetData(MASTER_SHEET_ID, 'Task List').filter(function (t) {
    return String(t['Doer ID']) === String(empCode) && String(t['Delete Repeated Task']) !== 'Yes';
  });

  return {
    emp_id: empCode,
    from: from,
    to: to,
    total_done: totalDone,
    total_planned: totalPlanned,
    total_tasks_setup: setup.length,
    completion_pct: totalPlanned > 0 ? Math.round(totalDone / totalPlanned * 100) : 0,
    daily_trend: daily
  };
}

function getTopPerformers(fromDate, toDate, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var from = fromDate || _daysAgo(30);
  var to = toDate || getISTDate();

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var empMap = {};
  doers.forEach(function (d) {
    var eid = String(d['Emp ID'] || '');
    if (eid) empMap[eid] = { name: String(d['Name'] || ''), dept: String(d['Department'] || ''), done: 0 };
  });

  try {
    var todayM2 = getISTDate().substring(0, 7);
    var rows2 = (from.substring(0, 7) === todayM2 && to.substring(0, 7) === todayM2)
      ? getSheetData(CHECKLIST_MASTER_ID, 'Checklist_Today')
      : (function () { var r = getSheetData(CHECKLIST_MASTER_ID, 'Checklist'); return r.length > 2000 ? r.slice(r.length - 2000) : r; })();
    rows2.forEach(function (l) {
      var planned = _normDateSafe(l['Planned']);
      if (planned < from || planned > to || String(l['Status']) !== 'Done') return;
      var eid = String(l['Name Id'] || '');
      if (empMap[eid]) empMap[eid].done++;
    });
  } catch (e) { }

  return Object.keys(empMap)
    .map(function (k) { return { emp_id: k, name: empMap[k].name, dept: empMap[k].dept, done: empMap[k].done }; })
    .sort(function (a, b) { return b.done - a.done; })
    .slice(0, 20);
}

function getDelegationAnalytics(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var today = getISTDate();
  var dels = getSheetData(MASTER_SHEET_ID, 'Delegation');
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');

  // Build lookup maps
  var nameMap = {}, deptMap = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '');
    nameMap[id] = String(d['Name'] || '');
    deptMap[id] = String(d['Department'] || '');
  });

  var byStatus = { Pending: 0, Completed: 0, Shifted: 0, Cancelled: 0, Overdue: 0 };
  var byEmp = {};  // keyed by emp_id (Delegated To)
  var byGiver = {};  // keyed by emp_id (Entry by / delegated from)
  var compTimes = [];
  var delayCounts = { '0d': 0, '1-3d': 0, '4-7d': 0, '1-2w': 0, '>2w': 0 };
  var byDept = {};

  dels.forEach(function (d) {
    var sts = String(d['Status'] || 'Pending');
    var toId = String(d['Delegated To'] || '').trim();
    var byId = String(d['Entry by'] || d['Created By'] || '').trim();
    var due = _normDateSafe(d['Final Date'] || d['First Date'] || '');
    var fd = _normDateSafe(d['First Date'] || '');
    var ts = _normDate(_safeStr(d['Timestamp'] || '').substring(0, 10));
    var task = String(d['Task'] || d['Delegation Task'] || d['Title'] || '');
    var isOvr = sts !== 'Completed' && sts !== 'Cancelled' && due && due < today;
    var delay = 0;

    // ── Status counts ──────────────────────────────────────────────────────
    byStatus[sts] = (byStatus[sts] || 0) + 1;
    if (isOvr) byStatus['Overdue']++;

    // ── Completion time ────────────────────────────────────────────────────
    if (sts === 'Completed' && fd && ts) {
      delay = Math.round((new Date(ts) - new Date(fd)) / 864e5);
      if (delay >= 0 && delay < 365) {
        compTimes.push(delay);
        if (delay === 0) delayCounts['0d']++;
        else if (delay <= 3) delayCounts['1-3d']++;
        else if (delay <= 7) delayCounts['4-7d']++;
        else if (delay <= 14) delayCounts['1-2w']++;
        else delayCounts['>2w']++;
      }
    }

    // ── Overdue delay days (for pending/overdue) ───────────────────────────
    var overdueBy = 0;
    if (isOvr && due) overdueBy = Math.round((new Date(today) - new Date(due)) / 864e5);

    // ── By employee (assignee) ─────────────────────────────────────────────
    if (toId) {
      if (!byEmp[toId]) byEmp[toId] = {
        name: nameMap[toId] || toId, dept: deptMap[toId] || '',
        assigned: 0, completed: 0, overdue: 0, pending: 0, cancelled: 0,
        compTimes: [], totalOverdueBy: 0
      };
      byEmp[toId].assigned++;
      if (sts === 'Completed') byEmp[toId].completed++;
      if (sts === 'Pending') byEmp[toId].pending++;
      if (sts === 'Cancelled') byEmp[toId].cancelled++;
      if (isOvr) { byEmp[toId].overdue++; byEmp[toId].totalOverdueBy += overdueBy; }
      if (delay > 0) byEmp[toId].compTimes.push(delay);

      // ── By dept ─────────────────────────────────────────────────────────
      var empDept = deptMap[toId] || 'Other';
      if (!byDept[empDept]) byDept[empDept] = { dept: empDept, assigned: 0, completed: 0, overdue: 0 };
      byDept[empDept].assigned++;
      if (sts === 'Completed') byDept[empDept].completed++;
      if (isOvr) byDept[empDept].overdue++;
    }

    // ── By giver ──────────────────────────────────────────────────────────
    if (byId) {
      if (!byGiver[byId]) byGiver[byId] = { name: nameMap[byId] || byId, given: 0, pending: 0, completed: 0 };
      byGiver[byId].given++;
      if (sts === 'Pending' || isOvr) byGiver[byId].pending++;
      if (sts === 'Completed') byGiver[byId].completed++;
    }
  });

  var avgDays = compTimes.length > 0
    ? Math.round(compTimes.reduce(function (s, v) { return s + v; }, 0) / compTimes.length) : 0;

  // ── Monthly trend (last 6 months) ────────────────────────────────────────
  var monthMap = {}, complMap = {};
  for (var i = 5; i >= 0; i--) {
    var dm = new Date(); dm.setMonth(dm.getMonth() - i);
    var mk = Utilities.formatDate(dm, _getTimezone(), 'yyyy-MM');
    monthMap[mk] = 0; complMap[mk] = 0;
  }
  dels.forEach(function (d) {
    var ts3 = _safeStr(d['Timestamp'] || '').substring(0, 7);
    if (monthMap[ts3] !== undefined) monthMap[ts3]++;
    var sts2 = String(d['Status'] || '');
    var ts4 = _safeStr(d['Timestamp'] || '').substring(0, 7);
    if (sts2 === 'Completed' && complMap[ts4] !== undefined) complMap[ts4]++;
  });

  return {
    total: dels.length,
    by_status: byStatus,
    avg_completion_days: avgDays,
    delay_distribution: delayCounts,
    monthly_trend: Object.keys(monthMap).sort().map(function (k) {
      return { month: k, count: monthMap[k], completed: complMap[k] };
    }),
    by_employee: Object.keys(byEmp).map(function (k) {
      var e = byEmp[k];
      var avgEmpDays = e.compTimes.length > 0
        ? Math.round(e.compTimes.reduce(function (a, b) { return a + b; }, 0) / e.compTimes.length) : 0;
      return {
        emp_id: k,
        name: e.name,
        dept: e.dept,
        assigned: e.assigned,
        completed: e.completed,
        overdue: e.overdue,
        pending: e.pending,
        cancelled: e.cancelled,
        avg_days: avgEmpDays,
        avg_overdue_by: e.overdue > 0 ? Math.round(e.totalOverdueBy / e.overdue) : 0,
        completion_rate: e.assigned > 0 ? Math.round(e.completed / e.assigned * 100) : 0
      };
    }).sort(function (a, b) { return b.assigned - a.assigned; }),
    by_dept: Object.keys(byDept).map(function (k) {
      var d = byDept[k];
      return Object.assign(d, {
        completion_rate: d.assigned > 0 ? Math.round(d.completed / d.assigned * 100) : 0
      });
    }).sort(function (a, b) { return b.assigned - a.assigned; }),
    by_giver: Object.keys(byGiver).map(function (k) {
      return Object.assign({ emp_id: k }, byGiver[k]);
    }).sort(function (a, b) { return b.given - a.given; }).slice(0, 10)
  };
}


// ── Lean filtered reader for the Delegation tab ───────────────────────────────
// Same fast-read pattern as _readChecklistFiltered. Delegation rows already
// store assignee/giver NAMES directly (no Doer List lookup needed for those),
// only Department comes from deptMap (Delegation doesn't store dept itself).
// Date filter is on the due date (Final Date, falling back to First Date) —
// i.e. "delegations due in this range", matching how Checklist filters by
// Planned date. statusFlt accepts a literal status OR the virtual 'overdue'.
// preloadedRaw (optional): skips the network fetch when data is already in hand.
function _readDelegationFiltered(from, to, deptFlt, empFlt, giverFlt, statusFlt, deptMap, today, preloadedRaw) {
  var raw = preloadedRaw || _sheetsApiBulkRead(MASTER_SHEET_ID, 'Delegation');
  if (!raw.length) return [];

  var t2 = Date.now();
  var hdrs = raw[0].map(function (h) { return String(h || '').trim(); });
  var iTaskId = hdrs.indexOf('Task ID');
  var iByCode = hdrs.indexOf('Delegated By');
  var iByName = hdrs.indexOf('Delegated By Name');
  var iToCode = hdrs.indexOf('Delegated To');
  var iToName = hdrs.indexOf('Delegated To Name');
  var iTask = hdrs.indexOf('Task');
  var iFirst = hdrs.indexOf('First Date');
  var iFinal = hdrs.indexOf('Final Date');
  var iStatus = hdrs.indexOf('Status');
  var iTs = hdrs.indexOf('Timestamp');

  var out = [];
  for (var i = 1; i < raw.length; i++) {
    var r = raw[i];
    var toCode = String(r[iToCode] || '').trim();
    if (!toCode) continue;

    var firstIso = _cellToIso(r[iFirst]);
    var finalIso = _cellToIso(r[iFinal]);
    var firstD = firstIso ? firstIso.substring(0, 10) : '';
    var due = (finalIso ? finalIso.substring(0, 10) : '') || firstD;
    if (!due || due < from || due > to) continue;

    var dept = String(deptMap[toCode] || 'Other').trim();
    if (deptFlt !== 'all' && dept !== deptFlt) continue;
    if (empFlt !== 'all' && toCode !== empFlt) continue;

    var byCode = String(r[iByCode] || '').trim();
    if (giverFlt !== 'all' && byCode !== giverFlt) continue;

    var status = String(r[iStatus] || 'Pending').trim();
    var isOvr = status !== 'Completed' && status !== 'Cancelled' && due < today;
    if (statusFlt === 'overdue') { if (!isOvr) continue; }
    else if (statusFlt !== 'all' && status !== statusFlt) continue;

    out.push({
      'Task ID': r[iTaskId],
      'Delegated By': byCode,
      'Delegated By Name': r[iByName],
      'Delegated To': toCode,
      'Delegated To Name': r[iToName],
      'Department': dept,
      'Task': r[iTask],
      'First Date': firstD,
      'Final Date': due,
      'Status': status,
      'Timestamp': _cellToIso(r[iTs])
    });
  }
  console.log('[_readDelegationFiltered] filter+map: ' + (Date.now() - t2) + 'ms, matched=' + out.length);
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// DELEGATION ANALYTICS V2 — extended insights for management reporting
// NEW function — getDelegationAnalytics() above is left completely untouched.
// Adds: real date-range (from→to, filtered by due date), department/assignee/
// delegator/status filters, on-time vs late completion, aging buckets,
// weekday pattern, dept breakdown, employee drill-down log.
// ════════════════════════════════════════════════════════════════════════════
function getDelegationAnalyticsV2(filters, passedUser, preloadedRaw) {
  var _tStart = Date.now();
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  filters = filters || {};
  var today = getISTDate();
  // Default: "All Time" — delegations can sit pending for a long while, so
  // (unlike Checklist's default-to-this-month) we default to a wide net.
  var from = _normDate(filters.from) || '2020-01-01';
  var to = _normDate(filters.to) || today;
  if (to < from) { var _tmp = from; from = to; to = _tmp; }

  var deptFlt = String(filters.dept || 'all');
  var empFlt = String(filters.empId || 'all');   // assignee (Delegated To)
  var giverFlt = String(filters.giverId || 'all');   // delegator (Delegated By)
  var statusFlt = String(filters.status || 'all');   // Pending/Completed/Cancelled/Shifted/overdue

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var nameMap = {}, deptMap = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '');
    nameMap[id] = String(d['Name'] || '');
    deptMap[id] = String(d['Department'] || '');
  });

  var rows = _readDelegationFiltered(from, to, deptFlt, empFlt, giverFlt, statusFlt, deptMap, today, preloadedRaw);

  var byEmp = {}, byDept = {}, byGiver = {}, monthMap = {}, weekdayMap = {}, statusCount = {};
  var lagBuckets = { same_day: 0, day1_3: 0, day4_7: 0, day8_14: 0, day15plus: 0 };
  var agingBuckets = { d0_3: 0, d4_7: 0, d8_14: 0, d15plus: 0 };
  var onTime = 0, late = 0, totalCompleted = 0, totalOverdueNow = 0;
  var lagDaysSum = 0, lagDaysCount = 0;
  var overdueList = [];
  var empDetailLog = [];
  var WD_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  rows.forEach(function (d) {
    var toId = d['Delegated To'];
    var toName = d['Delegated To Name'] || nameMap[toId] || toId;
    var dept = d['Department'];
    var byId = d['Delegated By'];
    var byName = d['Delegated By Name'] || nameMap[byId] || byId || '(unassigned)';
    var status = d['Status'];
    var due = d['Final Date'];
    var firstD = d['First Date'];
    var task = d['Task'] || 'Untitled';
    var ts = d['Timestamp'];
    var ts10 = ts ? String(ts).substring(0, 10) : '';

    statusCount[status] = (statusCount[status] || 0) + 1;
    var isOvr = status !== 'Completed' && status !== 'Cancelled' && due && due < today;
    if (isOvr) totalOverdueNow++;

    if (!byEmp[toId]) byEmp[toId] = {
      emp_id: toId, name: toName, dept: dept,
      assigned: 0, completed: 0, pending: 0, overdue: 0, cancelled: 0,
      lagSum: 0, lagN: 0, overdueBySum: 0
    };
    var E = byEmp[toId];
    E.assigned++;
    if (status === 'Completed') E.completed++;
    if (status === 'Pending') E.pending++;
    if (status === 'Cancelled') E.cancelled++;
    if (isOvr) E.overdue++;

    if (!byDept[dept]) byDept[dept] = { dept: dept, assigned: 0, completed: 0, overdue: 0, employees: {} };
    byDept[dept].assigned++;
    byDept[dept].employees[toId] = true;
    if (status === 'Completed') byDept[dept].completed++;
    if (isOvr) byDept[dept].overdue++;

    if (byId) {
      if (!byGiver[byId]) byGiver[byId] = { emp_id: byId, name: byName, given: 0, completed: 0, pending: 0, overdue: 0 };
      byGiver[byId].given++;
      if (status === 'Completed') byGiver[byId].completed++;
      if (status === 'Pending') byGiver[byId].pending++;
      if (isOvr) byGiver[byId].overdue++;
    }

    if (ts10) {
      var mk = ts10.substring(0, 7);
      if (!monthMap[mk]) monthMap[mk] = { month: mk, assigned: 0, completed: 0 };
      monthMap[mk].assigned++;
      if (status === 'Completed') monthMap[mk].completed++;

      var dow = new Date(ts10 + 'T00:00:00').getDay();
      if (!weekdayMap[dow]) weekdayMap[dow] = { day: WD_NAMES[dow], dow: dow, assigned: 0, completed: 0 };
      weekdayMap[dow].assigned++;
      if (status === 'Completed') weekdayMap[dow].completed++;
    }

    if (status === 'Completed') {
      totalCompleted++;
      if (firstD && ts10) {
        var lag = Math.round((new Date(ts10) - new Date(firstD)) / 86400000);
        if (lag <= 0) { onTime++; lagBuckets.same_day++; }
        else {
          late++; lagDaysSum += lag; lagDaysCount++;
          E.lagSum += lag; E.lagN++;
          if (lag <= 3) lagBuckets.day1_3++;
          else if (lag <= 7) lagBuckets.day4_7++;
          else if (lag <= 14) lagBuckets.day8_14++;
          else lagBuckets.day15plus++;
        }
      }
    }

    if (isOvr) {
      var overdueBy = Math.round((new Date(today) - new Date(due)) / 86400000);
      E.overdueBySum += overdueBy;
      if (overdueBy <= 3) agingBuckets.d0_3++;
      else if (overdueBy <= 7) agingBuckets.d4_7++;
      else if (overdueBy <= 14) agingBuckets.d8_14++;
      else agingBuckets.d15plus++;
      overdueList.push({ emp_id: toId, name: toName, dept: dept, task: task, giver: byName, due: due, days_overdue: overdueBy });
    }

    if (empFlt !== 'all') {
      empDetailLog.push({ task: task, status: status, first_date: firstD, due: due, giver: byName, timestamp: ts });
    }
  });

  var empList = Object.keys(byEmp).map(function (k) {
    var e = byEmp[k];
    return {
      emp_id: e.emp_id, name: e.name, dept: e.dept,
      assigned: e.assigned, completed: e.completed, pending: e.pending,
      overdue: e.overdue, cancelled: e.cancelled,
      completion_rate: e.assigned > 0 ? Math.round(e.completed / e.assigned * 100) : 0,
      avg_lag_days: e.lagN > 0 ? Math.round(e.lagSum / e.lagN * 10) / 10 : 0,
      avg_overdue_by: e.overdue > 0 ? Math.round(e.overdueBySum / e.overdue) : 0
    };
  }).sort(function (a, b) { return b.assigned - a.assigned; });

  var deptList = Object.keys(byDept).sort().map(function (k) {
    var d = byDept[k];
    return {
      dept: d.dept, assigned: d.assigned, completed: d.completed,
      overdue: d.overdue, pending: d.assigned - d.completed,
      employees: Object.keys(d.employees).length,
      completion_rate: d.assigned > 0 ? Math.round(d.completed / d.assigned * 100) : 0
    };
  }).sort(function (a, b) { return b.assigned - a.assigned; });

  var giverList = Object.keys(byGiver).map(function (k) {
    var g = byGiver[k];
    return {
      emp_id: g.emp_id, name: g.name, given: g.given, completed: g.completed,
      pending: g.pending, overdue: g.overdue,
      completion_rate: g.given > 0 ? Math.round(g.completed / g.given * 100) : 0
    };
  }).sort(function (a, b) { return b.given - a.given; });

  var monthList = Object.keys(monthMap).sort().map(function (k) {
    var m = monthMap[k];
    m.completion_rate = m.assigned > 0 ? Math.round(m.completed / m.assigned * 100) : 0;
    return m;
  });

  var weekdayList = [0, 1, 2, 3, 4, 5, 6].map(function (d) {
    var w = weekdayMap[d] || { day: WD_NAMES[d], dow: d, assigned: 0, completed: 0 };
    w.completion_rate = w.assigned > 0 ? Math.round(w.completed / w.assigned * 100) : 0;
    return w;
  });

  overdueList.sort(function (a, b) { return b.days_overdue - a.days_overdue; });
  empDetailLog.sort(function (a, b) { return (b.due || '').localeCompare(a.due || ''); });

  var totalAssigned = rows.length;
  var employeeDetail = null;
  if (empFlt !== 'all' && byEmp[empFlt]) {
    employeeDetail = {
      emp_id: empFlt, name: byEmp[empFlt].name, dept: byEmp[empFlt].dept,
      log: empDetailLog.slice(0, 300)
    };
  }

  console.log('[getDelegationAnalyticsV2] TOTAL: ' + (Date.now() - _tStart) + 'ms, rows=' + rows.length);

  return {
    from: from, to: to,
    filters: { dept: deptFlt, empId: empFlt, giverId: giverFlt, status: statusFlt },

    total_assigned: totalAssigned,
    total_completed: statusCount['Completed'] || 0,
    total_pending: statusCount['Pending'] || 0,
    total_cancelled: statusCount['Cancelled'] || 0,
    total_shifted: statusCount['Shifted'] || 0,
    total_overdue: totalOverdueNow,
    completion_rate: totalAssigned > 0 ? Math.round((statusCount['Completed'] || 0) / totalAssigned * 100) : 0,

    on_time_done: onTime,
    late_done: late,
    on_time_rate: totalCompleted > 0 ? Math.round(onTime / totalCompleted * 100) : 0,
    late_rate: totalCompleted > 0 ? Math.round(late / totalCompleted * 100) : 0,
    avg_lag_days: lagDaysCount > 0 ? Math.round(lagDaysSum / lagDaysCount * 10) / 10 : 0,
    lag_distribution: lagBuckets,

    pending_aging: agingBuckets,
    overdue_tasks: overdueList.slice(0, 30),
    overdue_count: overdueList.length,

    employees: empList.length,
    by_employee: empList,
    by_dept: deptList,
    by_giver: giverList,
    monthly_trend: monthList,
    weekday_pattern: weekdayList,
    status_breakdown: statusCount,
    employee_detail: employeeDetail,

    raw_log: rows.slice(0, 3000).map(function (d) {
      return {
        emp_id: d['Delegated To'], name: d['Delegated To Name'], dept: d['Department'],
        task: d['Task'], giver_id: d['Delegated By'], giver: d['Delegated By Name'],
        first_date: d['First Date'], due: d['Final Date'],
        status: d['Status'], timestamp: d['Timestamp']
      };
    }),
    raw_log_total: rows.length
  };
}

function getAttendanceStats(dept, monthYear, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var att = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance').filter(function (a) {
    var ok = true;
    if (dept && dept !== 'All') ok = ok && String(a['dept'] || '') === dept;
    if (monthYear) ok = ok && _normDateSafe(a['date'] || '').substring(0, 7) === monthYear;
    return ok;
  });

  var deptMap = {};
  att.forEach(function (a) {
    var d = String(a['dept'] || 'Other');
    var s = String(a['status'] || '').trim();
    var ci = String(a['check_in'] || '').trim();
    if (!deptMap[d]) deptMap[d] = { dept: d, fd: 0, hd: 0, absent: 0, holiday: 0, wo: 0 };
    if (s === 'Present' || s === 'FD' || s === 'P') deptMap[d].fd++;
    else if (s === 'HD') deptMap[d].hd++;
    else if (s === 'Absent' || s === 'A') deptMap[d].absent++;
    else if (s === 'H') deptMap[d].holiday++;
    else if (s === 'WO' || s === 'WE' || s === 'Week Off') deptMap[d].wo++;
    else if (ci && ci !== '-') deptMap[d].fd++; // fallback: has check_in = present
  });

  var depts = Object.keys(deptMap).map(function (k) {
    var d = deptMap[k];
    var wkg = d.fd + d.hd + d.absent;
    return {
      dept: d.dept, fd: d.fd, hd: d.hd, absent: d.absent,
      present_pct: wkg > 0 ? Math.round((d.fd + d.hd * 0.5) / wkg * 100) : 0
    };
  }).sort(function (a, b) { return b.present_pct - a.present_pct; });

  var dailyMap = {};
  att.forEach(function (a) {
    var dt = _normDateSafe(a['date'] || '');
    var s = String(a['status'] || '').trim();
    var ci = String(a['check_in'] || '').trim();
    if (!dt) return;
    if (!dailyMap[dt]) dailyMap[dt] = { date: dt, present: 0, total: 0 };
    dailyMap[dt].total++;
    if (s === 'Present' || s === 'FD' || s === 'P' || s === 'HD' || (ci && ci !== '-')) dailyMap[dt].present++;
  });

  var daily = Object.keys(dailyMap).sort().map(function (k) {
    var d = dailyMap[k];
    return { date: k, pct: d.total > 0 ? Math.round(d.present / d.total * 100) : 0 };
  }).slice(-30);

  return {
    dept_breakdown: depts,
    daily_trend: daily,
    total_records: att.length,
    month: monthYear || ''
  };
}

// ── Lean filtered reader for the Daily-Attendance tab ─────────────────────────
// All columns in Daily-Attendance are stored as plain text (see
// _ensureDailyAttTab), so no serial-number date conversion is needed here —
// unlike Checklist, values come back as plain strings already.
// preloadedRaw (optional): skips the network fetch when data is already in hand.
// Total hours is stored as "Xh Ym" text (e.g. "8h 30m") by the check-in/out
// flow — NOT a plain decimal. parseFloat() alone silently drops the minutes
// portion ("8h 30m" → 8), which was throwing off any hours-based comparison.
// This parses it into a proper decimal-hours number.
function _parseHoursStr(s) {
  s = String(s || '').trim();
  if (!s || s === '-') return NaN;
  // "7h 2m" or "7h2m" format (written by recordCheckOut)
  var m = s.match(/^(\d+)\s*h(?:\s*(\d+)\s*m)?/i);
  if (m) {
    var h = parseInt(m[1], 10) || 0;
    var mins = parseInt(m[2], 10) || 0;
    return h + mins / 60;
  }
  // "HH:MM:SS" or "HH:MM" time format from older records or from Sheets time cells
  var tc = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (tc) {
    return parseInt(tc[1], 10) + parseInt(tc[2], 10) / 60 + (parseInt(tc[3], 10) || 0) / 3600;
  }
  var f = parseFloat(s);
  // If the float looks like a fraction of a day (value < 1.0), it's a Sheets
  // serial time: multiply by 24 to get hours.
  if (!isNaN(f) && f > 0 && f < 1) return f * 24;
  return isNaN(f) ? NaN : f;
}

function _readAttendanceFiltered(from, to, deptFlt, empFlt, statusFlt, deptMap, nameMap, preloadedRaw, hdThresh, officeMap, holSet, todayStr) {
  var raw = preloadedRaw || _sheetsApiBulkRead(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance');

  // Build NeedAttendance set & WeekOff day set from Doer List
  var needAttSet = {};
  var weekOffDayMap = {};
  try {
    getSheetData(MASTER_SHEET_ID, 'Doer List').forEach(function (d) {
      var id = String(d['Emp ID'] || '').trim();
      if (!id) return;
      var na = String(d['NeedAttendance'] || '').trim().toLowerCase();
      needAttSet[id] = (na !== 'no');
      var wod = d['Week Off Day'];
      var weekOffDay = 0;
      if (wod !== undefined && wod !== null && wod !== '') {
        var wodStr = String(wod).trim().toLowerCase();
        var dmap = {
          sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2,
          wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6
        };
        if (dmap[wodStr] !== undefined) weekOffDay = dmap[wodStr];
        else {
          var wn = parseInt(wodStr, 10);
          if (!isNaN(wn) && wn >= 0 && wn <= 6) weekOffDay = wn;
        }
      }
      weekOffDayMap[id] = weekOffDay;
    });
  } catch (e) {
    console.warn('[_readAttendanceFiltered] needAtt load: ' + e.message);
  }

  function _needsAtt(eid) {
    return needAttSet.hasOwnProperty(eid) ? needAttSet[eid] : true;
  }
  function _empWeekOffDay(eid) {
    return weekOffDayMap.hasOwnProperty(eid) ? weekOffDayMap[eid] : 0;
  }

  var t2 = Date.now();
  var hdrs = raw.length ? raw[0].map(function (h) { return String(h || '').trim(); }) : [];
  var iEmpId = hdrs.indexOf('emp_id');
  var iEmpName = hdrs.indexOf('emp_name');
  var iDept = hdrs.indexOf('dept');
  var iDate = hdrs.indexOf('date');
  var iCheckIn = hdrs.indexOf('check_in');
  var iCheckOut = hdrs.indexOf('check_out');
  var iHours = hdrs.indexOf('total_hours');
  var iStatus = hdrs.indexOf('status');
  // device timestamps — more reliable than time-only cells
  var iCiDev = hdrs.indexOf('check_in_device_ts');
  var iCoDev = hdrs.indexOf('check_out_device_ts');
  var iDevTs = hdrs.indexOf('device_ts');

  officeMap = officeMap || {};

  var out = [];
  var seen = {};

  for (var i = 1; i < raw.length; i++) {
    var r = raw[i];
    var eid = String(r[iEmpId] || '').trim();
    if (!eid) continue;
    if (!_needsAtt(eid)) continue;

    var date = _normDateSafe(r[iDate]);
    if (!date) continue;
    seen[eid + '|' + date] = true;
    if (date < from || date > to) continue;

    var dept = String(r[iDept] || deptMap[eid] || 'Other').trim();
    if (deptFlt !== 'all' && dept !== deptFlt) continue;
    if (empFlt !== 'all' && eid !== empFlt) continue;

    // ── Correct punch times via helper (device_ts preferred) ───────────────
    var rowObj = {
      check_in: iCheckIn >= 0 ? r[iCheckIn] : '',
      check_out: iCheckOut >= 0 ? r[iCheckOut] : '',
      check_in_device_ts: iCiDev >= 0 ? r[iCiDev] : '',
      check_out_device_ts: iCoDev >= 0 ? r[iCoDev] : '',
      device_ts: iDevTs >= 0 ? r[iDevTs] : ''
    };
    var times = _attTimesFromRow(rowObj);
    var ci = times.check_in;
    var co = times.check_out;

    // Hours: prefer recalculated from corrected IN/OUT
    var hoursVal = r[iHours];
    if (ci && ci !== '-' && co && co !== '-') {
      try {
        var ciP = ci.split(':');
        var coP = co.split(':');
        var diffM = (parseInt(coP[0], 10) * 60 + parseInt(coP[1], 10)) -
                    (parseInt(ciP[0], 10) * 60 + parseInt(ciP[1], 10));
        if (diffM > 0) {
          hoursVal = Math.floor(diffM / 60) + 'h ' +
            (diffM % 60 < 10 ? '0' : '') + (diffM % 60) + 'm';
        }
      } catch (eH) { }
    }

    var raw_st = String(r[iStatus] || '').trim();
    var st = _normAttStatus(raw_st);

    // Re-derive P vs HD from worked hours
    var parsedHrsOut = null, fullDayThreshOut = null, halfDayThreshOut = null, hoursShortOut = null;
    if (hdThresh && (st === 'P' || st === 'HD')) {
      var parsedHrs = _parseHoursStr(hoursVal);
      if (!isNaN(parsedHrs) && parsedHrs > 0) {
        var off = officeMap[eid];
        var expHrs = off ? off.expectedHrs : (hdThresh / 0.75);
        var fullDayThreshHrs = expHrs * 0.75;
        var halfDayThreshHrs = expHrs * 0.40;
        if (parsedHrs >= fullDayThreshHrs) { st = 'P'; }
        else { st = 'HD'; }
        var shortfall = (parsedHrs < expHrs) ? Math.max(0, expHrs - parsedHrs) : 0;
        parsedHrsOut = Math.round(parsedHrs * 100) / 100;
        fullDayThreshOut = Math.round(fullDayThreshHrs * 100) / 100;
        halfDayThreshOut = Math.round(halfDayThreshHrs * 100) / 100;
        hoursShortOut = shortfall > 0 ? Math.round(shortfall * 100) / 100 : null;
      }
    }

    if (statusFlt !== 'all' && st !== statusFlt) continue;

    out.push({
      emp_id: eid,
      name: r[iEmpName] || nameMap[eid] || eid,
      dept: dept,
      date: date,
      check_in: ci,
      check_out: co,
      total_hours: hoursVal,
      status: st,
      parsed_hours: parsedHrsOut,
      full_day_thresh_hrs: fullDayThreshOut,
      half_day_thresh_hrs: halfDayThreshOut,
      hours_short: hoursShortOut
    });
  }

  // Synthesize Absent for working days with no check-in
  if (holSet && (statusFlt === 'all' || statusFlt === 'A')) {
    var capTo = (todayStr && todayStr < to) ? todayStr : to;
    if (capTo >= from) {
      Object.keys(nameMap).forEach(function (eid) {
        if (!_needsAtt(eid)) return;
        var dept = String(deptMap[eid] || 'Other').trim();
        if (deptFlt !== 'all' && dept !== deptFlt) return;
        if (empFlt !== 'all' && eid !== empFlt) return;
        var d = new Date(from + 'T00:00:00');
        var endD = new Date(capTo + 'T00:00:00');
        var empWOD = _empWeekOffDay(eid);
        while (d <= endD) {
          var dateStr = Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
          var dow = d.getDay();
          if (dow !== empWOD && !holSet[dateStr] && !seen[eid + '|' + dateStr]) {
            out.push({
              emp_id: eid,
              name: nameMap[eid] || eid,
              dept: dept,
              date: dateStr,
              check_in: '-',
              check_out: '-',
              total_hours: '-',
              status: 'A'
            });
          }
          d.setDate(d.getDate() + 1);
        }
      });
    }
  }

  console.log('[_readAttendanceFiltered] filter+map: ' + (Date.now() - t2) + 'ms, matched=' + out.length);
  return out;
}

function _normAttStatus(s) {
  s = String(s || '').trim();
  // NOTE: the check-in/check-out flow (recordCheckOut) writes the FULL words
  // 'Present' and 'Half Day' to the sheet — not abbreviations. The original
  // version of this function only matched 'HD', never the literal 'Half Day'
  // string that's actually stored, so every half-day record fell through to
  // the catch-all and was silently dropped from all Half Day / Late tallies.
  if (s === 'Present' || s === 'P' || s === 'FD') return 'P';
  if (s === 'Half Day' || s === 'HD') return 'HD';
  if (s === 'Late') return 'P'; // Late is a present-day variant, not its own bucket (matches existing convention elsewhere in this file)
  if (s === 'Absent' || s === 'A') return 'A';
  if (s === 'Week Off' || s === 'WO' || s === 'WE') return 'WO';
  if (s === 'Holiday' || s === 'H') return 'H';
  return s || 'A';
}

function _isLateCheckIn(checkIn, workStart, lateThreshMins) {
  if (!checkIn || checkIn.indexOf(':') < 0) return false;
  var cp = checkIn.split(':'), wp = workStart.split(':');
  var ciMins = parseInt(cp[0], 10) * 60 + parseInt(cp[1], 10);
  var wsMins = parseInt(wp[0], 10) * 60 + parseInt(wp[1], 10);
  if (isNaN(ciMins) || isNaN(wsMins)) return false;
  return ciMins > (wsMins + lateThreshMins);
}

// Computes the duration in hours between two "HH:mm" strings. Handles an
// overnight shift (e.g. Office OUT earlier in the clock than Office IN) by
// assuming it wraps past midnight.
function _hoursBetween(t1, t2) {
  if (!t1 || !t2 || t1.indexOf(':') < 0 || t2.indexOf(':') < 0) return NaN;
  var p1 = t1.split(':'), p2 = t2.split(':');
  var m1 = parseInt(p1[0], 10) * 60 + parseInt(p1[1], 10);
  var m2 = parseInt(p2[0], 10) * 60 + parseInt(p2[1], 10);
  if (isNaN(m1) || isNaN(m2)) return NaN;
  var diff = m2 - m1;
  if (diff <= 0) diff += 24 * 60; // overnight wrap
  return diff / 60;
}

// Builds { empId: { in, out, expectedHrs } } from the Doer List's "Office IN"
// / "Office OUT" columns. Employees without both columns filled are simply
// left out of the map — callers fall back to the flat company-wide
// WORK_START_TIME / HALF_DAY_THRESHOLD_HRS config for those employees, so
// this is fully backward-compatible for anyone who hasn't set a personal
// shift time yet.
function _buildOfficeHoursMap(doers) {
  var map = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '').trim();
    if (!id) return;
    var inT = _extractTimeStr(d['Office IN']);
    var outT = _extractTimeStr(d['Office OUT']);
    if (!inT || !outT || inT.indexOf(':') < 0 || outT.indexOf(':') < 0) return;
    var hrs = _hoursBetween(inT, outT);
    // Sanity bound: a real shift is somewhere between 3 and 14 hours. If
    // Office IN and Office OUT are identical or nearly identical (a common
    // data-entry slip, e.g. both left as a placeholder time), the overnight
    // wrap logic in _hoursBetween would otherwise compute a bogus ~24h
    // "shift" — pushing the 80% threshold above what any real workday could
    // ever clear, so full-day attendance would always show as Half Day.
    if (isNaN(hrs) || hrs < 3 || hrs > 14) return;
    map[id] = { in: inT, out: outT, expectedHrs: hrs };
  });
  return map;
}

// ════════════════════════════════════════════════════════════════════════════
// ATTENDANCE ANALYTICS V2 — extended insights for management reporting
// NEW function — existing getMusterGrid()/getAttendanceStats() are untouched
// and still power the Muster page and other callers.
// Adds: date-range (from→to), department/employee/status filters, late
// arrivals, work-hours averages, weekday pattern, dept breakdown, employee
// drill-down log, and a raw_log for click-to-drill-down on any card.
// ════════════════════════════════════════════════════════════════════════════
function getAttendanceAnalyticsV2(filters, passedUser, preloadedRaw) {
  var _tStart = Date.now();
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  filters = filters || {};
  var today = getISTDate();
  var from = _normDate(filters.from) || (today.substring(0, 7) + '-01');
  var to = _normDate(filters.to) || today;
  if (to < from) { var _tmp = from; from = to; to = _tmp; }

  var deptFlt = String(filters.dept || 'all');
  var empFlt = String(filters.empId || 'all');
  var statusFlt = String(filters.status || 'all'); // P/HD/A/WO/H

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var nameMap = {}, deptMap = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '');
    var na = String(d['NeedAttendance'] || '').trim().toLowerCase();
    if (na === 'no') return; // NeedAttendance=No — exclude from ALL attendance analytics
    nameMap[id] = String(d['Name'] || '');
    deptMap[id] = String(d['Department'] || '');
  });
  var officeMap = _buildOfficeHoursMap(doers);

  // Holiday set across the FULL [from,to] range (this can span multiple
  // months, unlike getMusterGrid's single-month grid) — used below to skip
  // synthesizing an Absent record on a day that's actually a holiday.
  var holSet = {};
  try {
    getSheetData(MASTER_SHEET_ID, 'Holiday List').forEach(function (h) {
      var dt = _normDateSafe(h['Date'] || h['Holiday Date'] || '');
      if (dt && dt >= from && dt <= to) holSet[dt] = true;
    });
  } catch (e) { console.warn('[getAttendanceAnalyticsV2] Holiday List read failed: ' + e.message); }

  var workStart = getConfig('WORK_START_TIME', '09:00');
  var lateThresh = parseInt(getConfig('LATE_THRESHOLD_MINS', '15'), 10) || 15;
  var hdThresh = _cfgNum('HALF_DAY_THRESHOLD_HRS', 6.0);

  var rows = _readAttendanceFiltered(from, to, deptFlt, empFlt, statusFlt, deptMap, nameMap, preloadedRaw, hdThresh, officeMap, holSet, today);

  var byEmp = {}, byDept = {}, dailyMap = {}, weekdayMap = {}, statusCount = {};
  var totalLate = 0, hoursSum = 0, hoursCount = 0;
  var empDetailLog = [];
  var WD_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  rows.forEach(function (a) {
    statusCount[a.status] = (statusCount[a.status] || 0) + 1;
    // Late check compares against THIS employee's own Office IN time when
    // they have one set, falling back to the flat company-wide
    // WORK_START_TIME for anyone who doesn't.
    var empOfficeIn = (officeMap[a.emp_id] && officeMap[a.emp_id].in) || workStart;
    var isLate = (a.status === 'P' || a.status === 'HD') && _isLateCheckIn(a.check_in, empOfficeIn, lateThresh);
    if (isLate) totalLate++;
    a.is_late = isLate; // mutate onto the row so it flows through to raw_log too
    a.office_in_used = empOfficeIn; // diagnostic: exactly what time this row was compared against

    var hrs = _parseHoursStr(a.total_hours);
    var hasHrs = !isNaN(hrs) && hrs > 0;
    if (hasHrs) { hoursSum += hrs; hoursCount++; }

    if (!byEmp[a.emp_id]) byEmp[a.emp_id] = {
      emp_id: a.emp_id, name: a.name, dept: a.dept,
      present: 0, half_day: 0, absent: 0, week_off: 0, holiday: 0,
      late: 0, working_days: 0, hoursSum: 0, hoursN: 0,
      log: [] // per-employee daily log — used by Detailed Log view
    };
    var E = byEmp[a.emp_id];
    if (a.status === 'P') { E.present++; E.working_days++; }
    if (a.status === 'HD') { E.half_day++; E.working_days++; }
    if (a.status === 'A') { E.absent++; E.working_days++; }
    if (a.status === 'WO') E.week_off++;
    if (a.status === 'H') E.holiday++;
    if (isLate) E.late++;
    if (hasHrs) { E.hoursSum += hrs; E.hoursN++; }
    // Push to per-employee log — always (previously only when empFlt!='all')
    E.log.push({ date: a.date, status: a.status, check_in: a.check_in, check_out: a.check_out, total_hours: a.total_hours, is_late: isLate, office_in_used: a.office_in_used, parsed_hours: a.parsed_hours });

    if (!byDept[a.dept]) byDept[a.dept] = { dept: a.dept, present: 0, half_day: 0, absent: 0, working_days: 0, employees: {} };
    var D = byDept[a.dept];
    D.employees[a.emp_id] = true;
    if (a.status === 'P') { D.present++; D.working_days++; }
    if (a.status === 'HD') { D.half_day++; D.working_days++; }
    if (a.status === 'A') { D.absent++; D.working_days++; }

    if (!dailyMap[a.date]) dailyMap[a.date] = { date: a.date, present: 0, half_day: 0, absent: 0, working_days: 0 };
    var Dl = dailyMap[a.date];
    if (a.status === 'P') { Dl.present++; Dl.working_days++; }
    if (a.status === 'HD') { Dl.half_day++; Dl.working_days++; }
    if (a.status === 'A') { Dl.absent++; Dl.working_days++; }

    var dow = new Date(a.date + 'T00:00:00').getDay();
    if (!weekdayMap[dow]) weekdayMap[dow] = { day: WD_NAMES[dow], dow: dow, present: 0, absent: 0, working_days: 0 };
    var W = weekdayMap[dow];
    if (a.status === 'P') W.present++;
    if (a.status === 'A') W.absent++;
    if (a.status === 'P' || a.status === 'HD' || a.status === 'A') W.working_days++;

    if (empFlt !== 'all') {
      empDetailLog.push({ date: a.date, status: a.status, check_in: a.check_in, check_out: a.check_out, total_hours: a.total_hours, is_late: isLate, office_in_used: empOfficeIn, parsed_hours: a.parsed_hours, full_day_thresh_hrs: a.full_day_thresh_hrs });
    }
  });

  var empList = Object.keys(byEmp).map(function (k) {
    var e = byEmp[k];
    var presentEquiv = e.present + e.half_day * 0.5;
    return {
      emp_id: e.emp_id, name: e.name, dept: e.dept,
      present: e.present, half_day: e.half_day, absent: e.absent,
      week_off: e.week_off, holiday: e.holiday, late: e.late,
      working_days: e.working_days,
      presence_pct: e.working_days > 0 ? Math.round(presentEquiv / e.working_days * 100) : 0,
      avg_hours: e.hoursN > 0 ? Math.round(e.hoursSum / e.hoursN * 10) / 10 : 0,
      log: (e.log || []).sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); })
    };
  }).sort(function (a, b) { return b.working_days - a.working_days; });

  var deptList = Object.keys(byDept).sort().map(function (k) {
    var d = byDept[k];
    var presentEquiv = d.present + d.half_day * 0.5;
    return {
      dept: d.dept, present: d.present, half_day: d.half_day, absent: d.absent,
      working_days: d.working_days, employees: Object.keys(d.employees).length,
      presence_pct: d.working_days > 0 ? Math.round(presentEquiv / d.working_days * 100) : 0
    };
  }).sort(function (a, b) { return b.working_days - a.working_days; });

  var trend = Object.keys(dailyMap).sort().map(function (k) {
    var d = dailyMap[k];
    var presentEquiv = d.present + d.half_day * 0.5;
    d.presence_pct = d.working_days > 0 ? Math.round(presentEquiv / d.working_days * 100) : 0;
    return d;
  });

  var weekdayList = [0, 1, 2, 3, 4, 5, 6].map(function (d) {
    var w = weekdayMap[d] || { day: WD_NAMES[d], dow: d, present: 0, absent: 0, working_days: 0 };
    var wd2 = w.present + w.absent;
    w.absence_pct = wd2 > 0 ? Math.round(w.absent / wd2 * 100) : 0;
    return w;
  });

  empDetailLog.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

  var totalWorking = (statusCount['P'] || 0) + (statusCount['HD'] || 0) + (statusCount['A'] || 0);
  var presentEquivTotal = (statusCount['P'] || 0) + (statusCount['HD'] || 0) * 0.5;
  var overallPresencePct = totalWorking > 0 ? Math.round(presentEquivTotal / totalWorking * 100) : 0;

  var employeeDetail = null;
  if (empFlt !== 'all' && byEmp[empFlt]) {
    employeeDetail = {
      emp_id: empFlt, name: byEmp[empFlt].name, dept: byEmp[empFlt].dept,
      log: empDetailLog.slice(0, 300)
    };
  }

  console.log('[getAttendanceAnalyticsV2] TOTAL: ' + (Date.now() - _tStart) + 'ms, rows=' + rows.length);

  return {
    from: from, to: to,
    filters: { dept: deptFlt, empId: empFlt, status: statusFlt },

    employees: empList.length,
    total_present: statusCount['P'] || 0,
    total_half_day: statusCount['HD'] || 0,
    total_absent: statusCount['A'] || 0,
    total_week_off: statusCount['WO'] || 0,
    total_holiday: statusCount['H'] || 0,
    total_late: totalLate,
    total_working_days: totalWorking,
    presence_pct: overallPresencePct,
    avg_hours: hoursCount > 0 ? Math.round(hoursSum / hoursCount * 10) / 10 : 0,

    by_employee: empList,
    by_dept: deptList,
    daily_trend: trend,
    weekday_pattern: weekdayList,
    status_breakdown: statusCount,
    employee_detail: employeeDetail,

    raw_log: rows.slice(0, 3000),
    raw_log_total: rows.length
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EM DASHBOARD — combined Checklist + Delegation + Attendance summary per
// employee ("doer"), with a Plan/Actual breakdown for each module plus a
// recent-days completion heatmap. Reuses _readChecklistFiltered /
// _readDelegationFiltered / _readAttendanceFiltered — the exact same,
// already-tested helpers the individual Checklist/Delegation/Attendance
// Analytics pages use — so date handling, absence synthesis, dept/emp
// filtering etc. all stay byte-for-byte consistent with those pages.
// Nothing in this function modifies those helpers or any other module.
// ════════════════════════════════════════════════════════════════════════════
function getEMDashboard(filters, passedUser) {
  var _tStart = Date.now();
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  filters = filters || {};
  var today = getISTDate();
  var from = _normDate(filters.from) || (today.substring(0, 7) + '-01');
  var to = _normDate(filters.to) || today;
  if (to < from) { var _tmp = from; from = to; to = _tmp; }

  var deptFlt = String(filters.dept || 'all');
  var empFlt = String(filters.empId || 'all');

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var nameMap = {}, deptMap = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '');
    nameMap[id] = String(d['Name'] || '');
    deptMap[id] = String(d['Department'] || '');
    // NOTE: needAttMap is built separately below for attendance scoring logic
  });
  var officeMap = _buildOfficeHoursMap(doers);

  var holSet = {};
  try {
    getSheetData(MASTER_SHEET_ID, 'Holiday List').forEach(function (h) {
      var dt = _normDateSafe(h['Date'] || h['Holiday Date'] || '');
      if (dt && dt >= from && dt <= to) holSet[dt] = true;
    });
  } catch (e) { console.warn('[getEMDashboard] Holiday List read failed: ' + e.message); }

  var hdThresh = _cfgNum('HALF_DAY_THRESHOLD_HRS', 6.0);

  // ── Build per-employee approved-leave date sets ─────────────────────────
  // Sundays are already excluded by _readAttendanceFiltered (dow===0 check).
  // Holidays are excluded via holSet. But approved leaves are NOT excluded —
  // without this, a day the employee was legitimately on leave counts as
  // "planned work" and makes their score unfairly worse.
  // Format: leaveSet['EMP001']['2026-06-15'] = true
  // Build per-employee week off day map (0=Sun default, customisable per employee)
  var weekOffDayMapEM = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '').trim();
    if (!id) return;
    var wod = d['Week Off Day'];
    var weekOffDay = 0;
    if (wod !== undefined && wod !== null && wod !== '') {
      var wodStr = String(wod).trim().toLowerCase();
      var dmap2 = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
      if (dmap2[wodStr] !== undefined) weekOffDay = dmap2[wodStr];
      else { var wnn = parseInt(wodStr, 10); if (!isNaN(wnn) && wnn >= 0 && wnn <= 6) weekOffDay = wnn; }
    }
    weekOffDayMapEM[id] = weekOffDay;
  });

  var leaveSet = {};
  try {
    var allLeaves = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'leave_requests');
    allLeaves.forEach(function (lr) {
      var status = String(lr['status'] || '').trim();
      if (status !== 'Approved') return; // only approved leaves count
      var eid = String(lr['emp_id'] || lr['Emp ID'] || '').trim();
      var lFrom = _normDate(String(lr['from_date'] || lr['From Date'] || ''));
      var lTo = _normDate(String(lr['to_date'] || lr['To Date'] || ''));
      if (!eid || !lFrom || !lTo) return;
      if (lTo < from || lFrom > to) return; // out of EM range
      // Expand every calendar day of the leave into the set
      var d2 = new Date(lFrom + 'T00:00:00');
      var end2 = new Date(lTo + 'T00:00:00');
      var guard = 0;
      while (d2 <= end2 && guard < 60) {
        var dt = Utilities.formatDate(d2, 'Asia/Kolkata', 'yyyy-MM-dd');
        if (!leaveSet[eid]) leaveSet[eid] = {};
        leaveSet[eid][dt] = true;
        d2.setDate(d2.getDate() + 1);
        guard++;
      }
    });
  } catch (e) { console.warn('[getEMDashboard] leave_requests read: ' + e.message); }

  // Helper: is this eid/date excluded from scoring?
  function _isExcluded(eid, date) {
    if (!date) return false;
    var dow = new Date(date + 'T00:00:00').getDay();
    // Per-employee weekly off day (default Sunday=0 if not configured)
    var empWODay = weekOffDayMapEM.hasOwnProperty(eid) ? weekOffDayMapEM[eid] : 0;
    if (dow === empWODay) return true;   // Employee's weekly off day
    if (holSet[date]) return true;       // Holiday
    if (leaveSet[eid] && leaveSet[eid][date]) return true; // Approved leave
    return false;
  }

  var clRows = _readChecklistFiltered(from, to, deptFlt, 'all', empFlt, deptMap);
  // ── Delegation: only count rows whose Final Due Date falls in range
  //    AND status is Pending/Shifted/Overdue (not delegated-date, not future pending).
  //    Rationale: EM Dashboard ke Delegation column me sirf DUE aur SHIFTED
  //    tasks dikhne chahiye — jinki due date range me hai. Future pending tasks
  //    count nahi karne kyunki unhe abhi complete karna baki hai but they are
  //    not yet a burden on the current period's score.
  var dlRowsAll = _readDelegationFiltered(from, to, deptFlt, empFlt, 'all', 'all', deptMap, today);
  var dlRows = dlRowsAll.filter(function (r) {
    var sts = String(r['Status'] || '').trim();
    var due = String(r['Final Date'] || '').trim();
    // Include: Completed (within range), Overdue (due < today, not completed),
    //          Shifted (date was moved), or Pending ONLY if due date <= today
    if (sts === 'Completed' || sts === 'Cancelled') return true;
    if (sts === 'Shifted') return true;
    // Pending: only count if the task is actually due (due date <= today)
    return due && due <= today;
  });
  var atRows = _readAttendanceFiltered(from, to, deptFlt, empFlt, 'all', deptMap, nameMap, null, hdThresh, officeMap, holSet, today);

  // Heatmap window
  var HEATMAP_DAYS = parseInt(filters.heatDays, 10) || 14;
  if (HEATMAP_DAYS < 7) HEATMAP_DAYS = 7;
  if (HEATMAP_DAYS > 30) HEATMAP_DAYS = 30;
  var allDates = [];
  (function () {
    var d = new Date(from + 'T00:00:00'); var endD = new Date(to + 'T00:00:00');
    var guard = 0;
    while (d <= endD && guard < 2000) { allDates.push(Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd')); d.setDate(d.getDate() + 1); guard++; }
  })();
  var heatDates = allDates.slice(-HEATMAP_DAYS);
  var heatSet = {}; heatDates.forEach(function (dt) { heatSet[dt] = true; });

  var byEmp = {};
  // Build NeedAttendance map — employees with 'No' are excluded from all
  // attendance scoring, ATT PLAN/ACTUAL columns, and Doer Details modal.
  var needAttMap = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '').trim();
    var na = String(d['NeedAttendance'] || '').trim().toLowerCase();
    needAttMap[id] = (na !== 'no'); // true = needs attendance, false = skip
  });

  function E(eid) {
    if (!byEmp[eid]) byEmp[eid] = {
      emp_id: eid, name: nameMap[eid] || eid, dept: deptMap[eid] || 'Other',
      cl_plan: 0, cl_actual: 0, dl_plan: 0, dl_actual: 0, at_plan: 0, at_actual: 0,
      need_att: needAttMap[eid] !== false, // default true if not in map
      heat: {}
    };
    return byEmp[eid];
  }
  function heatBump(eid, date, done) {
    if (!heatSet[date] || _isExcluded(eid, date)) return;
    var e = E(eid);
    if (!e.heat[date]) e.heat[date] = { planned: 0, done: 0 };
    e.heat[date].planned++;
    if (done) e.heat[date].done++;
  }

  clRows.forEach(function (r) {
    var eid = String(r['Name Id'] || ''); if (!eid) return;
    var date = r['Planned'];
    if (_isExcluded(eid, date)) return;
    var e = E(eid);
    e.cl_plan++;
    var done = String(r['Status'] || '') === 'Done';
    if (done) e.cl_actual++;
    heatBump(eid, date, done);
  });

  dlRows.forEach(function (r) {
    var eid = String(r['Delegated To'] || ''); if (!eid) return;
    var date = r['Final Date'];
    if (_isExcluded(eid, date)) return;
    var e = E(eid);
    e.dl_plan++;
    var done = String(r['Status'] || '') === 'Completed';
    if (done) e.dl_actual++;
    heatBump(eid, date, done);
  });

  atRows.forEach(function (r) {
    var eid = String(r.emp_id || ''); if (!eid) return;
    if (needAttMap[eid] === false) return; // NeedAttendance=No → skip entirely
    if (_isExcluded(eid, r.date)) return;
    var e = E(eid);
    e.at_plan++;
    if (r.status === 'P' || r.status === 'HD') e.at_actual++;
  });

  // Include every doer matching filters even with zero activity
  doers.forEach(function (d) {
    var eid = String(d['Emp ID'] || ''); if (!eid) return;
    var dept = String(d['Department'] || 'Other');
    if (deptFlt !== 'all' && dept !== deptFlt) return;
    if (empFlt !== 'all' && eid !== empFlt) return;
    E(eid);
  });

  var doerList = Object.keys(byEmp).map(function (eid) {
    var e = byEmp[eid];
    // For NeedAttendance=No employees: at_plan=0, at_actual=0 (already 0),
    // totalPlan excludes attendance so score reflects only CL+DL
    var totalPlan = e.cl_plan + e.dl_plan + (e.need_att ? e.at_plan : 0);
    var totalActual = e.cl_actual + e.dl_actual + (e.need_att ? e.at_actual : 0);
    var progress = totalPlan > 0 ? Math.round((totalActual / totalPlan) * 100) : 100;
    var heat = heatDates.map(function (dt) {
      if (_isExcluded(eid, dt)) return { date: dt, label: '—', done: 0, planned: 0 };
      var h = e.heat[dt];
      if (!h || h.planned === 0) return { date: dt, label: '-', done: 0, planned: 0 };
      return { date: dt, label: (h.done === h.planned) ? 'OK' : (h.done + '/' + h.planned), done: h.done, planned: h.planned };
    });
    return {
      emp_id: e.emp_id, name: e.name, dept: e.dept,
      cl_plan: e.cl_plan, cl_actual: e.cl_actual,
      dl_plan: e.dl_plan, dl_actual: e.dl_actual,
      at_plan: e.need_att ? e.at_plan : 0,
      at_actual: e.need_att ? e.at_actual : 0,
      need_att: e.need_att,
      total_plan: totalPlan, total_actual: totalActual, progress: progress,
      heat: heat
    };
  });
  doerList.sort(function (a, b) { return a.name.localeCompare(b.name); });

  var totals = doerList.reduce(function (acc, e) {
    acc.cl_plan += e.cl_plan; acc.cl_actual += e.cl_actual;
    acc.dl_plan += e.dl_plan; acc.dl_actual += e.dl_actual;
    // Only sum attendance for employees who need it
    acc.at_plan += e.at_plan; acc.at_actual += e.at_actual;
    acc.total_plan += e.total_plan; acc.total_actual += e.total_actual;
    return acc;
  }, { cl_plan: 0, cl_actual: 0, dl_plan: 0, dl_actual: 0, at_plan: 0, at_actual: 0, total_plan: 0, total_actual: 0 });
  totals.overall_pct = totals.total_plan > 0 ? Math.round((totals.total_actual / totals.total_plan) * 100) : 100;

  console.log('[getEMDashboard] TOTAL: ' + (Date.now() - _tStart) + 'ms, doers=' + doerList.length);
  return {
    from: from, to: to,
    filters: { dept: deptFlt, empId: empFlt },
    heat_dates: heatDates,
    totals: totals,
    doers: doerList
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EM DASHBOARD — DOER MODULE DRILL-DOWN
// On-demand item-level detail for one employee + one module (Checklist /
// Delegation / Attendance), used by the EM Dashboard's click-through detail
// popup. Reuses the same filtered-reader helpers as getEMDashboard; not
// called as part of the main dashboard load, only when a manager actually
// drills into a specific doer's module, to keep that load lightweight.
// ════════════════════════════════════════════════════════════════════════════
function getEMDoerDetail(filters, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  filters = filters || {};
  var today = getISTDate();
  var from = _normDate(filters.from) || (today.substring(0, 7) + '-01');
  var to = _normDate(filters.to) || today;
  if (to < from) { var _tmp = from; from = to; to = _tmp; }
  var empId = String(filters.empId || '');
  var module = String(filters.module || 'cl');
  if (!empId) throw new Error('empId is required');

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var nameMap = {}, deptMap = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '');
    nameMap[id] = String(d['Name'] || '');
    deptMap[id] = String(d['Department'] || '');
  });

  var items = [];

  if (module === 'cl') {
    var clRows = _readChecklistFiltered(from, to, 'all', 'all', empId, deptMap);
    items = clRows.map(function (r) {
      var done = String(r['Status'] || '') === 'Done';
      return {
        task: String(r['Task'] || 'Untitled'),
        freq: String(r['Freq'] || 'D'),
        date: r['Planned'],
        actual: r['Actual'] || '',
        status: String(r['Status'] || 'Pending'),
        done: done
      };
    });
  } else if (module === 'dl') {
    var dlRowsAll2 = _readDelegationFiltered(from, to, 'all', empId, 'all', 'all', deptMap, today);
    // Same filter as getEMDashboard: only due/shifted/completed, not future pending
    var dlRows = dlRowsAll2.filter(function (r) {
      var sts = String(r['Status'] || '').trim();
      var due = String(r['Final Date'] || '').trim();
      if (sts === 'Completed' || sts === 'Cancelled') return true;
      if (sts === 'Shifted') return true;
      return due && due <= today;
    });
    items = dlRows.map(function (r) {
      var done = String(r['Status'] || '') === 'Completed';
      return {
        task: String(r['Task'] || 'Untitled'),
        by: String(r['Delegated By Name'] || r['Delegated By'] || ''),
        date: r['First Date'],
        due: r['Final Date'],
        status: String(r['Status'] || 'Pending'),
        done: done
      };
    });
  } else { // 'at'
    var officeMap = _buildOfficeHoursMap(doers);
    var holSet = {};
    try {
      getSheetData(MASTER_SHEET_ID, 'Holiday List').forEach(function (h) {
        var dt = _normDateSafe(h['Date'] || h['Holiday Date'] || '');
        if (dt && dt >= from && dt <= to) holSet[dt] = true;
      });
    } catch (e) { console.warn('[getEMDoerDetail] Holiday List read failed: ' + e.message); }
    var hdThresh = _cfgNum('HALF_DAY_THRESHOLD_HRS', 6.0);
    var atRows = _readAttendanceFiltered(from, to, 'all', empId, 'all', deptMap, nameMap, null, hdThresh, officeMap, holSet, today);
    items = atRows.map(function (r) {
      return {
        date: r.date,
        status: r.status,
        check_in: r.check_in,
        check_out: r.check_out,
        hours: r.total_hours,
        done: (r.status === 'P' || r.status === 'HD')
      };
    });
  }

  // Most recent first
  items.sort(function (a, b) {
    var da = String(a.date || ''), db = String(b.date || '');
    return da < db ? 1 : da > db ? -1 : 0;
  });

  return {
    emp_id: empId, name: nameMap[empId] || empId, dept: deptMap[empId] || 'Other',
    module: module, from: from, to: to, items: items
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EM WEEKLY COMMITMENT — Monday meeting recorder & tracker
// Saves to EMWeeklyScore tab in the attendance spreadsheet.
// ════════════════════════════════════════════════════════════════════════════

function saveWeeklyCommitment(data, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var now = getISTTimestamp();
  var today = getISTDate();
  var recId = 'WS-' + today.replace(/-/g, '') + '-' + String(data.emp_id || '').replace(/\s/g, '');

  var row = {
    record_id: recId,
    meeting_date: String(data.meeting_date || today),
    week_reviewed_from: String(data.week_from || ''),
    week_reviewed_to: String(data.week_to || ''),
    emp_id: String(data.emp_id || ''),
    emp_name: String(data.emp_name || ''),
    dept: String(data.dept || ''),
    actual_score: Number(data.actual_score || 0),
    cl_score: data.cl_score !== undefined && data.cl_score !== null ? Number(data.cl_score) : '',
    dl_score: data.dl_score !== undefined && data.dl_score !== null ? Number(data.dl_score) : '',
    at_score: data.at_score !== undefined && data.at_score !== null ? Number(data.at_score) : '',
    commitment_score: Number(data.commitment_score || 0),
    commitment_details: String(data.commitment_details || ''),
    manager_notes: String(data.manager_notes || ''),
    commitment_status: 'Pending',
    next_week_actual: '',
    improvement_delta: '',
    recorded_by: String(user['Name'] || user['Email'] || ''),
    created_at: now
  };

  appendRow(NEW_ATTENDANCE_SHEET_ID, 'EMWeeklyScore', row);
  return { success: true, record_id: recId };
}

function getWeeklyCommitments(filters, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  filters = filters || {};
  var rows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'EMWeeklyScore');

  if (filters.emp_id && filters.emp_id !== 'all') {
    rows = rows.filter(function (r) { return String(r['emp_id'] || '') === filters.emp_id; });
  }
  if (filters.dept && filters.dept !== 'all') {
    rows = rows.filter(function (r) { return String(r['dept'] || '') === filters.dept; });
  }
  if (filters.status && filters.status !== 'all') {
    rows = rows.filter(function (r) { return String(r['commitment_status'] || '') === filters.status; });
  }
  if (filters.from) {
    rows = rows.filter(function (r) { return String(r['meeting_date'] || '') >= filters.from; });
  }
  if (filters.to) {
    rows = rows.filter(function (r) { return String(r['meeting_date'] || '') <= filters.to; });
  }

  // Sort newest first
  rows.sort(function (a, b) {
    return String(b['meeting_date'] || '').localeCompare(String(a['meeting_date'] || ''));
  });

  return rows.map(function (r) {
    return {
      record_id: String(r['record_id'] || ''),
      meeting_date: String(r['meeting_date'] || ''),
      week_reviewed_from: String(r['week_reviewed_from'] || ''),
      week_reviewed_to: String(r['week_reviewed_to'] || ''),
      emp_id: String(r['emp_id'] || ''),
      emp_name: String(r['emp_name'] || ''),
      dept: String(r['dept'] || ''),
      actual_score: Number(r['actual_score'] || 0),
      cl_score: r['cl_score'] !== '' && r['cl_score'] !== undefined ? Number(r['cl_score']) : null,
      dl_score: r['dl_score'] !== '' && r['dl_score'] !== undefined ? Number(r['dl_score']) : null,
      at_score: r['at_score'] !== '' && r['at_score'] !== undefined ? Number(r['at_score']) : null,
      commitment_score: Number(r['commitment_score'] || 0),
      commitment_details: String(r['commitment_details'] || ''),
      manager_notes: String(r['manager_notes'] || ''),
      commitment_status: String(r['commitment_status'] || 'Pending'),
      next_week_actual: String(r['next_week_actual'] || ''),
      improvement_delta: String(r['improvement_delta'] || ''),
      recorded_by: String(r['recorded_by'] || ''),
      created_at: String(r['created_at'] || ''),
      increment_cycle: String(r['increment_cycle'] || ''),
      increment_eligible: String(r['increment_eligible'] || ''),
      increment_recommended_pct: String(r['increment_recommended_pct'] || ''),
      increment_notes: String(r['increment_notes'] || ''),
      increment_approved_by: String(r['increment_approved_by'] || ''),
      increment_applied_date: String(r['increment_applied_date'] || '')
    };
  });
}

function updateCommitmentStatus(recordId, updateData, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var updates = {};
  if (updateData.commitment_status) updates['commitment_status'] = updateData.commitment_status;
  if (updateData.next_week_actual !== undefined && updateData.next_week_actual !== '') {
    updates['next_week_actual'] = Number(updateData.next_week_actual);
    if (updateData.commitment_score !== undefined) {
      updates['improvement_delta'] = Number(updateData.next_week_actual) - Number(updateData.commitment_score);
    }
  }
  if (updateData.manager_notes !== undefined) updates['manager_notes'] = updateData.manager_notes;

  updateRowByField(NEW_ATTENDANCE_SHEET_ID, 'EMWeeklyScore', 'record_id', recordId, updates);
  return { success: true };
}

// ════════════════════════════════════════════════════════════════════════════
// INCREMENT APPRAISAL MODULE
// Separate from weekly meetings — triggered only when staff requests increment
// or when it's yearly appraisal time. Pulls commitment history automatically.
// Sheet: EMIncrementAppraisal in the attendance spreadsheet.
// ════════════════════════════════════════════════════════════════════════════

function saveIncrementAppraisal(data, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var now = getISTTimestamp();
  var today = getISTDate();
  var empId = String(data.emp_id || '');
  var apprId = 'AP-' + today.replace(/-/g, '') + '-' + empId.replace(/\s/g, '');

  // Auto-compute summary from weekly commitment history for this employee
  var avgScore = '', commitRate = '', meetsCount = 0, totalClosed = 0, avgDelta = '';
  try {
    var wRows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'EMWeeklyScore').filter(function (r) {
      return String(r['emp_id'] || '') === empId;
    });
    if (wRows.length) {
      var scores = wRows.map(function (r) { return Number(r['actual_score'] || 0); });
      avgScore = Math.round(scores.reduce(function (s, v) { return s + v; }, 0) / scores.length);
      var closed = wRows.filter(function (r) { return r['commitment_status'] && r['commitment_status'] !== 'Pending'; });
      totalClosed = closed.length;
      meetsCount = closed.filter(function (r) { return r['commitment_status'] === 'Met'; }).length;
      commitRate = totalClosed > 0 ? Math.round((meetsCount / totalClosed) * 100) : '';
      var deltas = closed.filter(function (r) { return r['improvement_delta'] !== '' && r['improvement_delta'] !== undefined; })
        .map(function (r) { return Number(r['improvement_delta'] || 0); });
      if (deltas.length) avgDelta = Math.round(deltas.reduce(function (s, v) { return s + v; }, 0) / deltas.length);
    }
  } catch (e) { console.warn('[saveIncrementAppraisal] weekly history: ' + e.message); }

  var row = {
    appraisal_id: apprId,
    emp_id: empId,
    emp_name: String(data.emp_name || ''),
    dept: String(data.dept || ''),
    trigger_type: String(data.trigger_type || 'Manager Initiated'),
    request_date: String(data.request_date || today),
    review_from: String(data.review_from || ''),
    review_to: String(data.review_to || today),
    weekly_records_count: String(data.weekly_count || ''),
    avg_score: avgScore,
    commitment_rate_pct: commitRate,
    commitments_met: meetsCount,
    commitments_closed: totalClosed,
    avg_improvement_delta: avgDelta,
    manager_assessment: String(data.manager_assessment || ''),
    recommendation: String(data.recommendation || 'Pending'),
    increment_pct: String(data.increment_pct || ''),
    increment_notes: String(data.increment_notes || ''),
    approved_by: String(data.approved_by || ''),
    approved_date: '',
    applied_date: '',
    status: 'Pending',
    created_by: String(user['Name'] || user['Email'] || ''),
    created_at: now
  };

  appendRow(NEW_ATTENDANCE_SHEET_ID, 'EMIncrementAppraisal', row);
  return { success: true, appraisal_id: apprId };
}

function getIncrementAppraisals(filters, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  filters = filters || {};
  var rows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'EMIncrementAppraisal');

  if (filters.emp_id && filters.emp_id !== 'all')
    rows = rows.filter(function (r) { return String(r['emp_id'] || '') === filters.emp_id; });
  if (filters.dept && filters.dept !== 'all')
    rows = rows.filter(function (r) { return String(r['dept'] || '') === filters.dept; });
  if (filters.status && filters.status !== 'all')
    rows = rows.filter(function (r) { return String(r['status'] || '') === filters.status; });

  rows.sort(function (a, b) {
    return String(b['request_date'] || '').localeCompare(String(a['request_date'] || ''));
  });

  return rows.map(function (r) {
    return {
      appraisal_id: String(r['appraisal_id'] || ''),
      emp_id: String(r['emp_id'] || ''),
      emp_name: String(r['emp_name'] || ''),
      dept: String(r['dept'] || ''),
      trigger_type: String(r['trigger_type'] || ''),
      request_date: String(r['request_date'] || ''),
      review_from: String(r['review_from'] || ''),
      review_to: String(r['review_to'] || ''),
      avg_score: r['avg_score'] !== '' ? Number(r['avg_score'] || 0) : null,
      commitment_rate_pct: r['commitment_rate_pct'] !== '' ? Number(r['commitment_rate_pct'] || 0) : null,
      commitments_met: Number(r['commitments_met'] || 0),
      commitments_closed: Number(r['commitments_closed'] || 0),
      avg_improvement_delta: r['avg_improvement_delta'] !== '' ? Number(r['avg_improvement_delta'] || 0) : null,
      manager_assessment: String(r['manager_assessment'] || ''),
      recommendation: String(r['recommendation'] || 'Pending'),
      increment_pct: String(r['increment_pct'] || ''),
      increment_notes: String(r['increment_notes'] || ''),
      approved_by: String(r['approved_by'] || ''),
      approved_date: String(r['approved_date'] || ''),
      applied_date: String(r['applied_date'] || ''),
      status: String(r['status'] || 'Pending'),
      created_by: String(r['created_by'] || ''),
      created_at: String(r['created_at'] || '')
    };
  });
}

function updateIncrementAppraisal(appraisalId, updateData, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var updates = {};
  ['manager_assessment', 'recommendation', 'increment_pct', 'increment_notes',
    'approved_by', 'approved_date', 'applied_date', 'status'].forEach(function (f) {
      if (updateData[f] !== undefined) updates[f] = updateData[f];
    });

  updateRowByField(NEW_ATTENDANCE_SHEET_ID, 'EMIncrementAppraisal', 'appraisal_id', appraisalId, updates);
  return { success: true };
}

// ════════════════════════════════════════════════════════════════════════════
// EMPLOYEE DIRECTORY
// ════════════════════════════════════════════════════════════════════════════
function getEmployeeDirectory(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var today = getISTDate();
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var dels = getSheetData(MASTER_SHEET_ID, 'Delegation');

  var overdueDels = {};
  dels.filter(function (d) {
    if (String(d['Status'] || '') === 'Completed') return false;
    var due = _normDateSafe(d['Final Date'] || d['First Date'] || '');
    return due && due < today;
  }).forEach(function (d) {
    var to = String(d['Delegated To'] || '');
    overdueDels[to] = (overdueDels[to] || 0) + 1;
  });

  return doers.map(function (d) {
    var eid = String(d['Emp ID'] || '');
    var na = String(d['NeedAttendance'] || '').trim().toLowerCase();
    // week_off_day: 0=Sun (default), 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    // Stored in Doer List column "Week Off Day" as number or day name
    var wod = d['Week Off Day'];
    var weekOffDay = 0; // default Sunday
    if (wod !== undefined && wod !== null && wod !== '') {
      var wodStr = String(wod).trim().toLowerCase();
      var dayMap = {
        sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2,
        wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6
      };
      if (dayMap[wodStr] !== undefined) weekOffDay = dayMap[wodStr];
      else { var n = parseInt(wodStr, 10); if (!isNaN(n) && n >= 0 && n <= 6) weekOffDay = n; }
    }
    return {
      emp_id: eid,
      name: String(d['Name'] || ''),
      dept: String(d['Department'] || ''),
      email: String(d['Office Email'] || ''),
      role: String(d['Role'] || 'STAFF'),
      phone: String(d['Phone'] || d['Mobile'] || ''),
      photo: String(d['PHOTO'] || ''),
      overdue_delegations: overdueDels[eid] || 0,
      need_attendance: (na !== 'no'),   // false = NeedAttendance=No
      week_off_day: weekOffDay       // 0-6, day of week that is weekly off
    };
  }).filter(function (d) { return d.emp_id; });
}

function getEmployeeStats(empId, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var today = getISTDate();
  var month = today.substring(0, 7);
  var empCode = String(empId);

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var dRow = null;
  for (var x = 0; x < doers.length; x++) {
    if (String(doers[x]['Emp ID']) === empCode) { dRow = doers[x]; break; }
  }

  var ds = _deptSheet(dRow ? String(dRow['Department'] || '') : '');
  var logs = getSheetData(ds.id, ds.tab).filter(function (l) {
    return String(l['Name Id']) === empCode &&
      _normDateSafe(l['Planned']).substring(0, 7) === month;
  });

  var done = logs.filter(function (l) { return String(l['Status']) === 'Done'; }).length;
  var pending = getSheetData(MASTER_SHEET_ID, 'Delegation').filter(function (d) {
    return String(d['Delegated To'] || '') === empCode && String(d['Status'] || '') !== 'Completed';
  }).length;
  var attRows2 = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance').filter(function (a) {
    return String(a['emp_id'] || '') === empCode &&
      _normDateSafe(a['date'] || '').substring(0, 7) === month;
  });
  var attFd = attRows2.filter(function (a) {
    var s = String(a['status'] || '').trim();
    var ci = String(a['check_in'] || '').trim();
    return s === 'Present' || s === 'FD' || s === 'P' || (ci && ci !== '-');
  }).length;

  return {
    emp_id: empCode,
    tasks_done_this_month: done,
    tasks_logged_this_month: logs.length,
    pending_delegations: pending,
    attendance_days_this_month: attFd
  };
}

// ════════════════════════════════════════════════════════════════════════════
// HOLIDAY CALENDAR
// ════════════════════════════════════════════════════════════════════════════
function getHolidayList(year, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  try {
    var raw = getSheetData(MASTER_SHEET_ID, 'Holiday List');
    if (!raw || !raw.length) {
      console.warn('[getHolidayList] Holiday List tab is empty or missing');
      return [];
    }
    // Log first row keys for debugging
    var sampleKeys = Object.keys(raw[0] || {}).join(', ');
    console.log('[getHolidayList] Columns: ' + sampleKeys + ' | Rows: ' + raw.length);
    return raw.map(function (h) {
      // Try all possible column name variants
      var dt = _normDateSafe(
        h['Date'] || h['date'] || h['Holiday Date'] || h['HOLIDAY DATE'] ||
        h['holiday_date'] || h['HolidayDate'] || ''
      );
      var name = String(
        h['Holiday'] || h['holiday'] || h['Name'] || h['name'] ||
        h['Holiday Name'] || h['HOLIDAY'] || h['holiday_name'] || ''
      );
      return {
        date: dt,
        name: name,
        description: String(h['Description'] || h['Remarks'] || h['description'] || ''),
        type: String(h['Type'] || h['Holiday Type'] || h['type'] || 'Public Holiday')
      };
    }).filter(function (h) {
      return h.date && (!year || h.date.substring(0, 4) === String(year));
    }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  } catch (e) {
    console.warn('[getHolidayList] ' + e.message);
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ANNOUNCEMENTS
// ════════════════════════════════════════════════════════════════════════════
function getAnnouncements(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  try {
    return getSheetData(MASTER_SHEET_ID, 'Announcements')
      .filter(function (a) { return String(a['is_active'] || 'Yes') !== 'No'; })
      .map(function (a) {
        return {
          ann_id: String(a['ann_id'] || ''),
          text: String(a['text'] || ''),
          priority: String(a['priority'] || 'Normal'),
          posted_by: String(a['posted_by_name'] || ''),
          posted_at: _safeStr(a['posted_at'])
        };
      })
      .sort(function (a, b) { return b.posted_at.localeCompare(a.posted_at); });
  } catch (e) { return []; }
}

function postAnnouncement(text, priority, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');
  if (!text || !String(text).trim()) throw new Error('Announcement text is required.');

  var annId = 'ANN-' + _hex8();
  appendRow(MASTER_SHEET_ID, 'Announcements', {
    'ann_id': annId,
    'text': String(text).trim(),
    'priority': priority || 'Normal',
    'posted_by': _myCode(user),
    'posted_by_name': String(user['Name'] || ''),
    'posted_at': getISTTimestamp(),
    'is_active': 'Yes'
  });
  return { success: true, ann_id: annId };
}

function deleteAnnouncement(annId, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');
  updateRowByField(MASTER_SHEET_ID, 'Announcements', 'ann_id', annId, { 'is_active': 'No' });
  return { success: true };
}


// ════════════════════════════════════════════════════════════════════════════
// CHECK IN / CHECK OUT MODULE (v3.0 — uses NEW_ATTENDANCE_SHEET_ID)
// Sheet tab required: "Daily-Attendance" with columns:
//   att_id | emp_id | emp_name | dept | date | check_in | check_out |
//   device_ts | status | check_in_device_ts | check_out_device_ts
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get today's attendance status for the logged-in employee.
 * Returns: { status: 'not_checked_in' | 'checked_in' | 'checked_out',
 *            check_in: '09:32', check_out: '18:15', att_id: '...' }
 */
function getTodayAttendanceStatus(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var empCode = _myCode(user);
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');

  var rows = [];
  try {
    rows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance');
  } catch (e) {
    return {
      status: 'not_checked_in',
      check_in: '', check_out: '',
      check_in_ts: '', check_out_ts: '',
      total_hours: '-', att_id: ''
    };
  }

  var rec = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['emp_id'] || '') === empCode &&
        _normDateSafe(rows[i]['date']) === today) {
      rec = rows[i];
      break;
    }
  }

  if (!rec) {
    return {
      status: 'not_checked_in',
      check_in: '', check_out: '',
      check_in_ts: '', check_out_ts: '',
      total_hours: '-', att_id: ''
    };
  }

  // ✅ Single helper
  var times = _attTimesFromRow(rec);
  var ciTime = (times.check_in && times.check_in !== '-') ? times.check_in : '';
  var coTime = (times.check_out && times.check_out !== '-') ? times.check_out : '';

  var th = String(rec['total_hours'] || '-').trim();
  if (Object.prototype.toString.call(rec['total_hours']) === '[object Date]' ||
      typeof rec['total_hours'] === 'number') {
    th = String(rec['total_hours']);
  }

  var ciTs = ciTime ? (today + ' ' + ciTime + ':00') : '';
  var coTs = coTime ? (today + ' ' + coTime + ':00') : '';

  if (coTime) {
    return {
      status: 'checked_out',
      check_in: ciTime, check_out: coTime,
      check_in_ts: ciTs, check_out_ts: coTs,
      total_hours: th, att_id: String(rec['att_id'] || '')
    };
  }
  if (ciTime) {
    return {
      status: 'checked_in',
      check_in: ciTime, check_out: '',
      check_in_ts: ciTs, check_out_ts: '',
      total_hours: '-', att_id: String(rec['att_id'] || '')
    };
  }
  return {
    status: 'not_checked_in',
    check_in: '', check_out: '',
    check_in_ts: '', check_out_ts: '',
    total_hours: '-', att_id: ''
  };
}


/**
 * Record a Check-In for today.
 * Prevents duplicate check-in for the same employee on the same day.
 */
// ════════════════════════════════════════════════════════════════════════════
// GPS VALIDATION — Haversine distance check against AppConfig locations
// Returns { allowed: true/false, distance_km: N, nearest_location: 'name' }
// ════════════════════════════════════════════════════════════════════════════
function _haversineKm(lat1, lng1, lat2, lng2) {
  var R = 6371; // Earth radius km
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validateGpsForAttendance(userLat, userLng, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  // NeedLocation = No → skip GPS check entirely for this employee
  var nl = String(user['NeedLocation'] || '').trim().toLowerCase();
  if (nl === 'no') {
    return { allowed: true, reason: 'Location check not required for this employee', location_exempt: true };
  }

  var gpsEnabled = _cfgBool('GPS_ATTENDANCE', false);
  if (!gpsEnabled) return { allowed: true, reason: 'GPS check disabled' };

  var results = [];

  // Check all configured locations (LOC1, LOC2 ... expandable)
  for (var i = 1; i <= 5; i++) {
    var lat = _cfgNum('OFFICE_LOC' + i + '_LAT', null);
    var lng = _cfgNum('OFFICE_LOC' + i + '_LNG', null);
    var radius = _cfgNum('OFFICE_LOC' + i + '_RADIUS_KM', 0.05);
    var name = getConfig('OFFICE_LOC' + i + '_NAME', 'Office ' + i);
    if (lat === null || lng === null) break; // no more locations

    var dist = _haversineKm(userLat, userLng, lat, lng);
    results.push({ name: name, dist_km: dist, radius_km: radius, within: dist <= radius });
    if (dist <= radius) {
      return { allowed: true, nearest_location: name, distance_km: Math.round(dist * 1000) + 'm' };
    }
  }

  // Not within any location
  if (!results.length) return { allowed: true, reason: 'No locations configured' };
  var nearest = results.sort(function (a, b) { return a.dist_km - b.dist_km; })[0];
  return {
    allowed: false,
    nearest_location: nearest.name,
    distance_km: Math.round(nearest.dist_km * 1000),
    radius_m: Math.round(nearest.radius_km * 1000),
    message: 'You are ' + Math.round(nearest.dist_km * 1000) + 'm from ' + nearest.name +
      '. Must be within ' + Math.round(nearest.radius_km * 1000) + 'm to check in.'
  };
}

// ════════════════════════════════════════════════════════════════════════════
// MARK TEAM ATTENDANCE (OWNER / MANAGER / COORDINATOR)
// Returns all staff with NeedAttendance=Yes, merged with today's attendance.
// markStaffAttendance writes attendance records for staff who missed check-in.
// ════════════════════════════════════════════════════════════════════════════

function getTeamAttendanceStatus(dateStr, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isMarkAttendanceAllowed(user)) throw new Error('PERMISSION_DENIED');

  var date = _normDate(dateStr) || getISTDate();
  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');

  // Staff who NeedAttendance = Yes (blank = Yes)
  var staffList = doers.filter(function (d) {
    var na = String(d['NeedAttendance'] || '').trim().toLowerCase();
    return na !== 'no';
  }).map(function (d) {
    return {
      emp_id: String(d['Emp ID'] || '').trim(),
      name: String(d['Name'] || '').trim(),
      dept: String(d['Department'] || '').trim(),
      role: String(d['Role'] || 'STAFF').trim(),
      phone: String(d['Phone'] || d['Mobile'] || '').trim(),
      office_in: String(d['Office IN'] || '').trim()
    };
  }).filter(function (d) { return d.emp_id; });

  var attRows = [];
  try {
    attRows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance').filter(function (r) {
      return _normDateSafe(r['date']) === date;
    });
  } catch (e) {
    console.warn('[getTeamAttendanceStatus] att read: ' + e.message);
  }

  var attMap = {};
  attRows.forEach(function (r) {
    var eid = String(r['emp_id'] || '').trim();
    if (!eid) return;
    if (!attMap[eid]) {
      attMap[eid] = { check_in: '', check_out: '', status: '', total_hours: '', att_id: '' };
    }

    // ✅ Single helper — always HH:mm
    var times = _attTimesFromRow(r);
    var ci = times.check_in;
    var co = times.check_out;

    if (ci && ci !== '-' && (!attMap[eid].check_in || ci < attMap[eid].check_in)) {
      attMap[eid].check_in = ci;
    }
    if (co && co !== '-') {
      attMap[eid].check_out = co;
    }
    attMap[eid].status = String(r['status'] || '');
    // Prefer recomputed hours from IN/OUT so bad stored values (e.g. 17h 34m) don't show
    var recomputed = (ci && co && ci !== '-' && co !== '-') ? _attHoursLabel(ci, co) : '';
    var storedHrs = String(r['total_hours'] || '').trim();
    attMap[eid].total_hours = recomputed || storedHrs;
    attMap[eid].att_id = String(r['att_id'] || '');
  });

  var today = getISTDate();
  var isPast = date < today;

  // Past day + no attendance → auto Half Day with fixed punch (10:00–14:00)
  // So unpaid/absent is not silent; managers still see a row.
  if (isPast) {
    var FIXED_IN = '10:00';
    var FIXED_OUT = '14:00';
    staffList.forEach(function (s) {
      var a = attMap[s.emp_id];
      if (a && (a.check_in || a.status)) return; // already has a record
      try {
        var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        var dObj = new Date(date + 'T00:00:00');
        var dayNm = days[dObj.getDay()] || '';
        var attId = 'ATT-AUTO-' + _hex8();
        appendRow(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance', {
          att_id: attId,
          emp_id: s.emp_id,
          emp_name: s.name,
          dept: s.dept,
          date: date,
          day: dayNm,
          check_in: FIXED_IN,
          check_out: FIXED_OUT,
          total_hours: '4h 0m',
          check_in_ts: date + ' ' + FIXED_IN + ':00',
          check_out_ts: date + ' ' + FIXED_OUT + ':00',
          status: 'HD',
          source: 'AutoHalfDay',
          marked_by: 'System (auto)',
          created_at: getISTTimestamp()
        });
        attMap[s.emp_id] = {
          check_in: FIXED_IN,
          check_out: FIXED_OUT,
          status: 'HD',
          total_hours: '4h 0m',
          att_id: attId
        };
      } catch (eAuto) {
        console.warn('[getTeamAttendanceStatus] auto HD failed for ' + s.emp_id + ': ' + eAuto.message);
      }
    });
  }

  return staffList.map(function (s) {
    var a = attMap[s.emp_id] || {};
    var ci = a.check_in || '';
    var co = a.check_out || '';
    var hasIn = !!(ci && ci !== '-');
    var hasOut = !!(co && co !== '-');
    var hasStatus = !!(a.status && String(a.status).trim());
    return {
      emp_id: s.emp_id,
      name: s.name,
      dept: s.dept,
      role: s.role,
      phone: s.phone,
      office_in: s.office_in,
      date: date,
      check_in: ci,
      check_out: co,
      status: a.status || '',
      total_hours: a.total_hours || '',
      att_id: a.att_id || '',
      // marked = any attendance activity
      marked: !!(hasIn || hasStatus),
      // still needs OUT punch (manager or self)
      needs_checkout: !!(hasIn && !hasOut),
      // fully closed for the day
      complete: !!(hasIn && hasOut)
    };
  });
}

/**
 * Parse ANY time-ish value to minutes from midnight.
 * Priority: plain HH:mm → extractTimeStr → null.
 */
function _toMins(t) {
  if (t === null || t === undefined || t === '' || t === '-') return -1;
  // Fast path: already "HH:mm" or "HH:mm:ss"
  var s0 = String(t).trim();
  var plain = s0.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (plain) {
    var ph = parseInt(plain[1], 10), pm = parseInt(plain[2], 10);
    if (ph >= 0 && ph <= 23 && pm >= 0 && pm <= 59) return ph * 60 + pm;
  }
  // "yyyy-MM-dd HH:mm:ss" — take the TIME part only (never the date digits)
  var dt = s0.match(/^\d{4}-\d{2}-\d{2}[ T](\d{1,2}):(\d{2})(?::\d{2})?/);
  if (dt) {
    var dh = parseInt(dt[1], 10), dm = parseInt(dt[2], 10);
    if (dh >= 0 && dh <= 23 && dm >= 0 && dm <= 59) return dh * 60 + dm;
  }
  // Fallback: _extractTimeStr (Date objects, serials, etc.)
  var hhmm = _extractTimeStr(t);
  if (!hhmm || hhmm === '-') return -1;
  var parts = String(hhmm).split(':');
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 60 + m;
}

/**
 * Worked hours: ONLY difference of clock times same day.
 * 11:29 → 17:00 MUST return "5h 31m". Never uses Date subtraction.
 */
function _attHoursLabel(ciRaw, coRaw) {
  return _strictHoursLabel(ciRaw, coRaw);
}

/** Case-insensitive header index */
function _hdrIdx(hdrs, name) {
  var want = String(name || '').trim().toLowerCase();
  for (var i = 0; i < hdrs.length; i++) {
    if (String(hdrs[i] || '').trim().toLowerCase() === want) return i;
  }
  return -1;
}

/**
 * Write updates to Daily-Attendance row matching emp_id + date.
 * Live sheet only. Fills standard OUT columns: check_out, total_hours,
 * check_out_ts / check_out_device_ts, status, marked_by.
 */
function _updateDailyAttRow(empId, date, updates) {
  var ss = _getSpreadsheet(NEW_ATTENDANCE_SHEET_ID);
  var sh = ss.getSheetByName('Daily-Attendance');
  if (!sh || sh.getLastRow() < 2) return false;
  var vals = sh.getDataRange().getValues();
  var hdrs = vals[0].map(function (h) { return String(h || '').trim(); });
  var iEmp = _hdrIdx(hdrs, 'emp_id');
  var iDt = _hdrIdx(hdrs, 'date');
  if (iEmp < 0 || iDt < 0) return false;

  // Ensure columns exist for every key we want to write
  Object.keys(updates || {}).forEach(function (k) {
    if (_hdrIdx(hdrs, k) < 0) {
      sh.getRange(1, hdrs.length + 1).setValue(k);
      hdrs.push(k);
    }
  });

  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][iEmp] || '').trim() !== String(empId).trim()) continue;
    if (_normDateSafe(vals[i][iDt]) !== date) continue;
    Object.keys(updates).forEach(function (k) {
      var ci = _hdrIdx(hdrs, k);
      if (ci >= 0) {
        sh.getRange(i + 1, ci + 1).setNumberFormat('@');
        sh.getRange(i + 1, ci + 1).setValue(String(updates[k]));
      }
    });
    SpreadsheetApp.flush();
    _clearSheetCache(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance');
    return true;
  }
  return false;
}

/**
 * Strict HH:mm only — e.g. "11:29" → 689 minutes. Returns -1 if invalid.
 * Ignores dates; if string has a date, uses the TIME after the space.
 */
function _strictHhMmToMins(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s || s === '-') return -1;
  // Prefer time after date: "2026-10-03 11:29:00"
  var m = s.match(/\d{4}-\d{2}-\d{2}[ T](\d{1,2}):(\d{2})/);
  if (!m) m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) m = s.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  if (!m) return -1;
  var h = parseInt(m[1], 10);
  var mi = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return -1;
  return h * 60 + mi;
}

function _strictHoursLabel(inV, outV) {
  var a = _strictHhMmToMins(inV);
  var b = _strictHhMmToMins(outV);
  if (a < 0 || b < 0 || b <= a) return '';
  var d = b - a;
  return Math.floor(d / 60) + 'h ' + (d % 60) + 'm';
}

function markStaffAttendance(records, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isMarkAttendanceAllowed(user)) throw new Error('PERMISSION_DENIED');
  if (!records || !records.length) return { success: true, saved: 0 };

  _ensureDailyAttTab();
  try { _clearSheetCache(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance'); } catch (eC) { }

  var markedBy = String(user['Name'] || user.name || '') + ' (' + String(user['Role'] || user.role || '') + ')';
  var nowTs = getISTTimestamp();
  var saved = 0;
  var lastHours = '';

  var ss = _getSpreadsheet(NEW_ATTENDANCE_SHEET_ID);
  var sh = ss.getSheetByName('Daily-Attendance');
  if (!sh) throw new Error('Daily-Attendance tab missing');

  records.forEach(function (rec) {
    var empId = String(rec.emp_id || '').trim();
    if (!empId) return;
    var empName = String(rec.emp_name || '').trim();
    var dept = String(rec.dept || '').trim();
    var date = _normDate(rec.date) || getISTDate();
    var status = String(rec.status || 'P').trim() || 'P';
    // UI sends "HH:mm" from <input type="time">
    var inRaw = String(rec.check_in || '').trim();
    var outRaw = String(rec.check_out || '').trim();
    var inHH = inRaw ? (inRaw.length >= 5 ? inRaw.substring(0, 5) : inRaw) : '';
    var outHH = outRaw ? (outRaw.length >= 5 ? outRaw.substring(0, 5) : outRaw) : '';
    // Validate pure HH:mm
    if (inHH && !/^\d{1,2}:\d{2}$/.test(inHH)) inHH = _extractTimeStr(inRaw) || '';
    if (outHH && !/^\d{1,2}:\d{2}$/.test(outHH)) outHH = _extractTimeStr(outRaw) || '';

    // Find existing row (emp + date). Prefer last match to update latest duplicate.
    var vals = sh.getDataRange().getValues();
    var hdrs = vals[0].map(function (h) { return String(h || '').trim(); });
    var iEmp = _hdrIdx(hdrs, 'emp_id');
    var iDt = _hdrIdx(hdrs, 'date');
    var iCi = _hdrIdx(hdrs, 'check_in');
    var iCo = _hdrIdx(hdrs, 'check_out');
    var iHrs = _hdrIdx(hdrs, 'total_hours');
    var iStat = _hdrIdx(hdrs, 'status');
    var rowNum = -1;
    var existingCi = '';
    for (var i = 1; i < vals.length; i++) {
      if (String(vals[i][iEmp] || '').trim() !== empId) continue;
      if (_normDateSafe(vals[i][iDt]) !== date) continue;
      rowNum = i + 1;
      if (iCi >= 0) {
        var cellCi = vals[i][iCi];
        // Prefer display string if already HH:mm text
        var asStr = String(cellCi == null ? '' : cellCi).trim();
        if (/^\d{1,2}:\d{2}/.test(asStr)) existingCi = asStr.substring(0, 5);
        else existingCi = _extractTimeStr(cellCi) || '';
      }
    }

    // Ensure required columns exist
    function ensureCol(name) {
      var idx = _hdrIdx(hdrs, name);
      if (idx >= 0) return idx;
      sh.getRange(1, hdrs.length + 1).setValue(name);
      hdrs.push(name);
      return hdrs.length - 1;
    }
    iCi = ensureCol('check_in');
    iCo = ensureCol('check_out');
    iHrs = ensureCol('total_hours');
    iStat = ensureCol('status');
    var iCiTs = ensureCol('check_in_ts');
    var iCoTs = ensureCol('check_out_ts');
    var iCiDev = ensureCol('check_in_device_ts');
    var iCoDev = ensureCol('check_out_device_ts');
    var iBy = ensureCol('marked_by');
    var iSrc = ensureCol('source');
    var iDev = ensureCol('device_ts');

    // Effective times for hours
    var effIn = existingCi || inHH;
    var effOut = outHH;
    var hoursLabel = (effIn && effOut) ? _strictHoursLabel(effIn, effOut) : '';
    lastHours = hoursLabel;
    Logger.log('[markStaff] emp=' + empId + ' date=' + date + ' in=' + effIn + ' out=' + effOut + ' hours=' + hoursLabel + ' row=' + rowNum);

    if (rowNum > 0) {
      // UPDATE existing row — only touch OUT-related + hours; keep IN if present
      if (inHH && !existingCi) {
        sh.getRange(rowNum, iCi + 1).setNumberFormat('@').setValue(inHH);
        sh.getRange(rowNum, iCiTs + 1).setNumberFormat('@').setValue(date + ' ' + inHH + ':00');
        sh.getRange(rowNum, iCiDev + 1).setNumberFormat('@').setValue(date + ' ' + inHH + ':00');
        effIn = inHH;
        hoursLabel = (effIn && effOut) ? _strictHoursLabel(effIn, effOut) : hoursLabel;
      }
      if (outHH) {
        sh.getRange(rowNum, iCo + 1).setNumberFormat('@').setValue(outHH);
        sh.getRange(rowNum, iCoTs + 1).setNumberFormat('@').setValue(date + ' ' + outHH + ':00');
        sh.getRange(rowNum, iCoDev + 1).setNumberFormat('@').setValue(date + ' ' + outHH + ':00');
      }
      if (hoursLabel) {
        sh.getRange(rowNum, iHrs + 1).setNumberFormat('@').setValue(hoursLabel);
      }
      if (iStat >= 0) sh.getRange(rowNum, iStat + 1).setNumberFormat('@').setValue(status);
      sh.getRange(rowNum, iBy + 1).setNumberFormat('@').setValue(markedBy);
      sh.getRange(rowNum, iSrc + 1).setNumberFormat('@').setValue('ManagerMark');
      sh.getRange(rowNum, iDev + 1).setNumberFormat('@').setValue(nowTs);
    } else {
      // CREATE new row via append then force-format time/hours cells
      var attId = 'ATT-' + _hex8();
      var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      var dObj = new Date(date + 'T12:00:00');
      var dayNm = days[dObj.getDay()] || '';
      var rowObj = {};
      rowObj['att_id'] = attId;
      rowObj['emp_id'] = empId;
      rowObj['emp_name'] = empName;
      rowObj['dept'] = dept;
      rowObj['date'] = date;
      rowObj['day'] = dayNm;
      rowObj['check_in'] = inHH || (status === 'A' ? '-' : '');
      rowObj['check_out'] = outHH || (status === 'A' ? '-' : '');
      rowObj['total_hours'] = hoursLabel || (status === 'A' ? '-' : '');
      rowObj['device_ts'] = nowTs;
      rowObj['status'] = status;
      rowObj['check_in_ts'] = inHH ? date + ' ' + inHH + ':00' : '';
      rowObj['check_out_ts'] = outHH ? date + ' ' + outHH + ':00' : '';
      rowObj['check_in_device_ts'] = rowObj['check_in_ts'];
      rowObj['check_out_device_ts'] = rowObj['check_out_ts'];
      rowObj['source'] = 'ManagerMark';
      rowObj['marked_by'] = markedBy;
      appendRow(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance', rowObj);
      // Force text format on the new row's time/hours cells
      var newRow = sh.getLastRow();
      [iCi, iCo, iHrs].forEach(function (cix) {
        if (cix >= 0) sh.getRange(newRow, cix + 1).setNumberFormat('@');
      });
      if (hoursLabel && iHrs >= 0) {
        sh.getRange(newRow, iHrs + 1).setNumberFormat('@').setValue(hoursLabel);
      }
    }
    saved++;
  });

  SpreadsheetApp.flush();
  try { _clearSheetCache(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance'); } catch (e2) { }
  return { success: true, saved: saved, total_hours: lastHours };
}

/**
 * One-shot repair: recompute total_hours for every Daily-Attendance row
 * from check_in / check_out. Run from Apps Script editor if old rows show
 * wrong durations (e.g. "17h 48m" for 11:11→18:20).
 */
function repairAllAttendanceHours() {
  var ss = _getSpreadsheet(NEW_ATTENDANCE_SHEET_ID);
  var sh = ss.getSheetByName('Daily-Attendance');
  if (!sh || sh.getLastRow() < 2) return { fixed: 0 };
  var vals = sh.getDataRange().getValues();
  var hdrs = vals[0].map(function (h) { return String(h || '').trim(); });
  var iCi = _hdrIdx(hdrs, 'check_in');
  var iCo = _hdrIdx(hdrs, 'check_out');
  var iHrs = _hdrIdx(hdrs, 'total_hours');
  if (iCi < 0 || iCo < 0 || iHrs < 0) return { fixed: 0, error: 'missing columns' };
  sh.getRange(2, iHrs + 1, sh.getLastRow() - 1, 1).setNumberFormat('@');
  var fixed = 0;
  for (var i = 1; i < vals.length; i++) {
    var ci = _extractTimeStr(vals[i][iCi]);
    var co = _extractTimeStr(vals[i][iCo]);
    if (!ci || ci === '-' || !co || co === '-') continue;
    var label = _attHoursLabel(ci, co);
    if (!label) continue;
    sh.getRange(i + 1, iHrs + 1).setNumberFormat('@').setValue(label);
    fixed++;
  }
  SpreadsheetApp.flush();
  _clearSheetCache(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance');
  return { fixed: fixed };
}

function recordCheckIn(deviceTimestamp, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var empCode = _myCode(user);
  var today = getISTDate();
  var nowTime = getISTTimestamp();

  // ── GPS validation (if enabled in AppConfig) ──────────────────────────────
  // NeedLocation = No → skip GPS entirely for this employee
  var _needLoc = String(user['NeedLocation'] || '').trim().toLowerCase() !== 'no';
  if (_needLoc && deviceTimestamp && typeof deviceTimestamp === 'object' && deviceTimestamp.lat) {
    var gpsResult = validateGpsForAttendance(deviceTimestamp.lat, deviceTimestamp.lng, passedUser);
    if (!gpsResult.allowed) {
      // WA: alert manager about GPS block attempt
      try {
        if (_cfgBool('WA_GPS_BLOCK_NOTIFY', true)) {
          _waSendToManagers(
            '🚫 *GPS Check-In Blocked*\n' +
            'Employee: ' + String(user['Name'] || '') + ' (' + String(user['Department'] || '') + ')\n' +
            'Reason: ' + gpsResult.message + '\n' +
            'Date: ' + getISTDate() + '  Time: ' + getISTTimestamp().substring(11, 16) + '\n' +
            'Employee is ' + gpsResult.distance_km + 'm from ' + gpsResult.nearest_location
          );
        }
      } catch (eWA) { }
      throw new Error('GPS_BLOCKED:' + gpsResult.message);
    }
  }
  if (deviceTimestamp && typeof deviceTimestamp === 'object') {
    deviceTimestamp = deviceTimestamp.ts || deviceTimestamp;
  }

  // ── Auto-create Daily-Attendance tab if it does not exist ────────────────
  _ensureDailyAttTab();

  // ── Duplicate guard ──────────────────────────────────────────────────────
  var rows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['emp_id'] || '') === empCode &&
      _normDateSafe(rows[i]['date']) === today) {
      var existing = String(rows[i]['check_in'] || '').trim();
      if (existing && existing !== '-') {
        throw new Error('Already checked in today at ' + existing + '.');
      }
    }
  }

  // ── Use GAS server time only (avoids client timezone/date issues) ────────
  var checkInTime = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HH:mm'); // IST 24hr
  var attId = 'ATT-' + _hex8();
  var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var dayName = days[new Date().getDay()];
  // Store device timestamp as clean IST datetime string
  var deviceTsStr = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'); // IST yyyy-MM-dd format for display

  var ss = _getSpreadsheet(NEW_ATTENDANCE_SHEET_ID);
  var sh = ss.getSheetByName('Daily-Attendance');
  var hdrs = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var dataMap = {
    'att_id': attId,
    'emp_id': empCode,
    'emp_name': String(user['Name'] || user.full_name || ''),
    'dept': String(user['Department'] || user.department || ''),
    'date': today,
    'day': dayName,
    'check_in': checkInTime,
    'check_out': '-',
    'total_hours': '-',
    'device_ts': deviceTsStr,
    'status': 'Present',
    'check_in_device_ts': deviceTsStr,
    'check_out_device_ts': ''
  };
  var rowArr = hdrs.map(function (h) {
    var k = String(h || '').trim();
    return dataMap[k] !== undefined ? dataMap[k] : '';
  });
  // Use appendRow then immediately set format to plain text to prevent date parsing
  var newRow = sh.getLastRow() + 1;
  sh.getRange(newRow, 1, 1, rowArr.length).setValues([rowArr]);
  sh.getRange(newRow, 1, 1, rowArr.length).setNumberFormat('@');

  // WA: check-in confirmation + late alert
  try {
    var empPhoneCI = _waPhone(empCode);
    if (_cfgBool('WA_CHECKIN_NOTIFY', true) && empPhoneCI) {
      sendWhatsAppMessage(empPhoneCI,
        '✅ *Check-In Recorded*\n' +
        'Name: ' + String(user['Name'] || '') + '\n' +
        'Time: ' + checkInTime + '  |  Date: ' + today + '\n' +
        'Joolry Daily'
      );
    }
    // Late alert to managers
    var workStart = getConfig('WORK_START_TIME', '09:00');
    var lateThresh = parseInt(getConfig('LATE_THRESHOLD_MINS', '15'), 10) || 15;
    var wsParts = workStart.split(':');
    var wsMin = parseInt(wsParts[0] || 0) * 60 + parseInt(wsParts[1] || 0);
    var ciParts = checkInTime.split(':');
    var ciMin = parseInt(ciParts[0] || 0) * 60 + parseInt(ciParts[1] || 0);
    if ((ciMin - wsMin) > lateThresh && _cfgBool('WA_LATE_ALERT', true)) {
      _waSendToManagers(
        '⏰ *Late Check-In Alert*\n' +
        'Employee: ' + String(user['Name'] || '') + ' (' + String(user['Department'] || '') + ')\n' +
        'Check-in: ' + checkInTime + '  |  Work starts: ' + workStart + '\n' +
        'Late by: ~' + (ciMin - wsMin - lateThresh) + ' mins\n' +
        'Date: ' + today
      );
    }
  } catch (eWA) { }
  return { success: true, att_id: attId, check_in: checkInTime, timestamp: nowTime };
}

/**
 * Record a Check-Out for today.
 * Updates the existing check-in row. Prevents check-out without check-in.
 */
function recordCheckOut(deviceTimestamp, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');

  var empCode = _myCode(user);
  var today = getISTDate();
  var nowTime = getISTTimestamp();
  var checkOut = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HH:mm'); // IST 24hr

  // ── GPS validation (if enabled in AppConfig) ──────────────────────────────
  // NeedLocation = No → skip GPS entirely for this employee
  var _needLocOut = String(user['NeedLocation'] || '').trim().toLowerCase() !== 'no';
  if (_needLocOut && deviceTimestamp && typeof deviceTimestamp === 'object' && deviceTimestamp.lat) {
    var gpsResultOut = validateGpsForAttendance(deviceTimestamp.lat, deviceTimestamp.lng, passedUser);
    if (!gpsResultOut.allowed) {
      try {
        if (_cfgBool('WA_GPS_BLOCK_NOTIFY', true)) {
          _waSendToManagers(
            '🚫 *GPS Check-Out Blocked*\n' +
            'Employee: ' + String(user['Name'] || '') + ' (' + String(user['Department'] || '') + ')\n' +
            'Reason: ' + gpsResultOut.message + '\n' +
            'Date: ' + getISTDate() + '  Time: ' + getISTTimestamp().substring(11, 16) + '\n' +
            'Employee is ' + gpsResultOut.distance_km + 'm from ' + gpsResultOut.nearest_location
          );
        }
      } catch (eWA) { }
      throw new Error('GPS_BLOCKED:' + gpsResultOut.message);
    }
  }
  if (deviceTimestamp && typeof deviceTimestamp === 'object') {
    deviceTimestamp = deviceTimestamp.ts || deviceTimestamp;
  }

  // ── Find today's check-in row ────────────────────────────────────────────
  var rows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance');
  var rec = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['emp_id'] || '') === empCode &&
      _normDateSafe(rows[i]['date']) === today) {
      rec = rows[i]; break;
    }
  }
  if (!rec) throw new Error('No check-in found for today. Please check in first.');
  var ci = _extractTimeStr(rec['check_in']);
  if (!ci || ci === '-') throw new Error('Please check in before checking out.');
  var co = _extractTimeStr(rec['check_out']);
  if (co && co !== '-') throw new Error('Already checked out today at ' + co + '.');

  // ── Calculate total hours (IST-safe via _extractTimeStr / _toMins) ───────
  var totalHours = _attHoursLabel(ci, checkOut) || '-';
  var totalHrsNum = 0;
  var _ciM = _toMins(ci);
  var _coM = _toMins(checkOut);
  if (_ciM > 0 && _coM > _ciM) totalHrsNum = (_coM - _ciM) / 60;

  // ── Update row directly via sheet range ─────────────────────────────────
  var attId = String(rec['att_id'] || '');
  var deviceTsStr = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'); // IST yyyy-MM-dd format for display
  var ss = _getSpreadsheet(NEW_ATTENDANCE_SHEET_ID);
  var sh = ss.getSheetByName('Daily-Attendance');
  var data = sh.getDataRange().getValues();
  var hdrs = data[0].map(function (h) { return String(h || '').trim(); });
  var attIdx = hdrs.indexOf('att_id');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][attIdx] || '').trim() === attId) {
      var coIdx = hdrs.indexOf('check_out');
      var thIdx = hdrs.indexOf('total_hours');
      var cdIdx = hdrs.indexOf('check_out_device_ts');
      var stIdx = hdrs.indexOf('status');
      if (coIdx >= 0) { sh.getRange(i + 1, coIdx + 1).setNumberFormat('@').setValue(checkOut); }
      if (thIdx >= 0) { sh.getRange(i + 1, thIdx + 1).setNumberFormat('@').setValue(totalHours); }
      if (cdIdx >= 0) { sh.getRange(i + 1, cdIdx + 1).setNumberFormat('@').setValue(deviceTsStr); }
      // ── Determine Full Day vs Half Day using per-employee Doer List
      // shift times. Previously used only the global HALF_DAY_THRESHOLD_HRS
      // (default 8.5h) which was too strict — now reads this employee's
      // own Office IN / Office OUT from the Doer List and marks Full Day
      // when worked hours >= 65% of their expected shift, which gives a
      // threshold of ~5.85h for a 9h shift. Falls back to the global
      // HALF_DAY_THRESHOLD_HRS config if no per-employee times are found.
      var hdThresh = _cfgNum('HALF_DAY_THRESHOLD_HRS', 6.0);
      var fullDayThresh = hdThresh;
      try {
        var doerRows = getSheetData(MASTER_SHEET_ID, 'Doer List');
        for (var di = 0; di < doerRows.length; di++) {
          if (String(doerRows[di]['Emp ID'] || '').trim() === empCode) {
            var offIn = _extractTimeStr(doerRows[di]['Office IN']);
            var offOut = _extractTimeStr(doerRows[di]['Office OUT']);
            if (offIn && offOut) {
              var expHrs = _hoursBetween(offIn, offOut);
              if (!isNaN(expHrs) && expHrs >= 3 && expHrs <= 14) {
                fullDayThresh = expHrs * 0.75;
              }
            }
            break;
          }
        }
      } catch (eDl) { console.warn('[recordCheckOut] Doer List read failed: ' + eDl.message); }
      var finalStatus = (totalHrsNum > 0 && totalHrsNum >= fullDayThresh) ? 'Present' : 'Half Day';
      if (stIdx >= 0) { sh.getRange(i + 1, stIdx + 1).setNumberFormat('@').setValue(finalStatus); }
      break;
    }
  }

  // WA: check-out confirmation
  try {
    if (_cfgBool('WA_CHECKIN_NOTIFY', true)) {
      var empPhoneCO = _waPhone(_myCode(user));
      if (empPhoneCO) {
        sendWhatsAppMessage(empPhoneCO,
          '🏁 *Check-Out Recorded*\n' +
          'Name: ' + String(user['Name'] || '') + '\n' +
          'Time: ' + checkOut + '  |  Hours: ' + totalHours + '\n' +
          'Joolry Daily'
        );
      }
    }
  } catch (eWA) { }
  return { success: true, att_id: attId, check_out: checkOut, total_hours: totalHours, timestamp: nowTime };
}

/**
 * One-time setup: create the Daily-Attendance tab if it doesn't exist.
 * Run manually from the Apps Script editor.
 */
function setupDailyAttendanceTab() {
  _ensureDailyAttTab();
  console.log('[setupDailyAttendanceTab] Done.');
}

/**
 * Internal helper — creates Daily-Attendance tab if missing.
 * Called automatically by recordCheckIn so setup is never needed manually.
 */
function _ensureDailyAttTab() {
  try {
    var ss = _getSpreadsheet(NEW_ATTENDANCE_SHEET_ID);
    if (!ss.getSheetByName('Daily-Attendance')) {
      var sh = ss.insertSheet('Daily-Attendance');
      var headers = [
        'att_id', 'emp_id', 'emp_name', 'dept', 'date', 'day',
        'check_in', 'check_out', 'total_hours',
        'device_ts', 'status',
        'check_in_device_ts', 'check_out_device_ts'
      ];
      sh.appendRow(headers);
      sh.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#005F73')
        .setFontColor('#ffffff');
      // Set ALL columns as plain text to prevent Sheets auto-parsing dates/times
      sh.getRange(1, 1, 1000, headers.length).setNumberFormat('@');
      console.log('[_ensureDailyAttTab] Created Daily-Attendance tab.');
    }
  } catch (e) {
    console.error('[_ensureDailyAttTab] ' + e.message);
    throw new Error('Could not create attendance tab: ' + e.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PROFILE & PASSWORD
// ════════════════════════════════════════════════════════════════════════════
function getMyProfile(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var today = getISTDate();
  var month = today.substring(0, 7);
  var empCode = _myCode(user);

  var ds = _deptSheet(String(user['Department'] || ''));
  var logs = getSheetData(ds.id, ds.tab).filter(function (l) {
    return String(l['Name Id']) === empCode &&
      _normDateSafe(l['Planned']).substring(0, 7) === month;
  });
  var done = logs.filter(function (l) { return String(l['Status']) === 'Done'; }).length;
  var delPend = getSheetData(MASTER_SHEET_ID, 'Delegation').filter(function (d) {
    return String(d['Delegated To'] || '') === empCode && String(d['Status'] || '') !== 'Completed';
  }).length;
  var lrCount = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'leave_requests').filter(function (r) {
    return String(r.emp_id) === empCode && String(r.from_date || '').substring(0, 7) === month;
  }).length;
  var attDays = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance').filter(function (a) {
    if (String(a['emp_id'] || '') !== empCode) return false;
    if (_normDateSafe(a['date'] || '').substring(0, 7) !== month) return false;
    var s = String(a['status'] || '').trim();
    var ci = String(a['check_in'] || '').trim();
    return s === 'Present' || s === 'FD' || s === 'P' || (ci && ci !== '-');
  }).length;

  return {
    emp_id: empCode,
    name: String(user['Name'] || ''),
    email: String(user['Office Email'] || ''),
    dept: String(user['Department'] || ''),
    role: String(user['Role'] || 'STAFF'),
    photo: String(user['PHOTO'] || ''),
    stats: {
      tasks_done_this_month: done,
      tasks_logged_this_month: logs.length,
      pending_delegations: delPend,
      leave_requests_this_month: lrCount,
      present_days_this_month: attDays
    }
  };
}

function changePassword(newPw, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!newPw || String(newPw).trim().length < 4)
    throw new Error('Password must be at least 4 characters.');
  var ok = updateRowByField(MASTER_SHEET_ID, 'Doer List', 'Emp ID', _myCode(user), {
    'Password': String(newPw).trim()
  });
  if (!ok) throw new Error('Could not update password. Employee record not found.');
  return { success: true };
}

// ════════════════════════════════════════════════════════════════════════════
// ACTIVITY FEED
// ════════════════════════════════════════════════════════════════════════════
function getRecentActivity(passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  var empCode = _myCode(user);
  var today = getISTDate();
  var from = _daysAgo(7);

  // Done tasks in last 7 days
  var ds = _deptSheet(String(user['Department'] || ''));
  var logs = getSheetData(ds.id, ds.tab).filter(function (l) {
    if (String(l['Name Id']) !== empCode) return false;
    var p = _normDateSafe(l['Planned']);
    return p >= from && p <= today && String(l['Status']) === 'Done';
  }).map(function (l) {
    return {
      type: 'task_done',
      label: String(l['Task'] || ''),
      date: _normDateSafe(l['Planned']),
      actual_dt: _normDateSafe(l['Actual'])
    };
  });

  // Delegation activity in last 7 days
  var dels = getSheetData(MASTER_SHEET_ID, 'Delegation').filter(function (d) {
    // ▼ BUG FIX: _safeStr() applied to Timestamp before .substring()
    var ts = _normDate(_safeStr(d['Timestamp'] || '').substring(0, 10));
    return ts >= from && ts <= today &&
      (String(d['Delegated To'] || '') === empCode || String(d['Delegated By'] || '') === empCode);
  }).map(function (d) {
    // ▼ BUG FIX: _safeStr() applied to Timestamp before .substring()
    return {
      type: String(d['Delegated By'] || '') === empCode ? 'del_out' : 'del_in',
      label: String(d['Task'] || ''),
      date: _normDate(_safeStr(d['Timestamp'] || '').substring(0, 10))
    };
  });

  var all = logs.concat(dels).sort(function (a, b) { return b.date.localeCompare(a.date); });
  return all.slice(0, 20);
}

// ════════════════════════════════════════════════════════════════════════════
// ADMIN & SETUP UTILITIES
// ════════════════════════════════════════════════════════════════════════════

/**
 * One-time setup: create the Announcements tab if it doesn't exist.
 * Run manually from the Apps Script editor.
 */
function setupAnnouncementsTab() {
  try {
    var ss = _getSpreadsheet(MASTER_SHEET_ID);
    if (!ss.getSheetByName('Announcements')) {
      var sh = ss.insertSheet('Announcements');
      sh.appendRow(['ann_id', 'text', 'priority', 'posted_by', 'posted_by_name', 'posted_at', 'is_active']);
      sh.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#005F73').setFontColor('#ffffff');
      console.log('[setupAnnouncementsTab] Created Announcements tab successfully.');
    } else {
      console.log('[setupAnnouncementsTab] Tab already exists — no action taken.');
    }
  } catch (e) {
    console.error('[setupAnnouncementsTab] ' + e.message);
  }
}

/**
 * One-time setup: create the leave_requests tab if it doesn't exist.
 * Run manually from the Apps Script editor.
 */
function setupLeaveRequestsTab() {
  try {
    var ss = _getSpreadsheet(NEW_ATTENDANCE_SHEET_ID);
    if (!ss.getSheetByName('leave_requests')) {
      var sh = ss.insertSheet('leave_requests');
      sh.appendRow([
        'request_id', 'emp_id', 'emp_name', 'dept', 'leave_type',
        'from_date', 'to_date', 'num_days', 'reason',
        'status', 'approved_by', 'approved_at', 'requested_at'
      ]);
      sh.getRange(1, 1, 1, 13).setFontWeight('bold').setBackground('#005F73').setFontColor('#ffffff');
      console.log('[setupLeaveRequestsTab] Created leave_requests tab successfully.');
    } else {
      console.log('[setupLeaveRequestsTab] Tab already exists — no action taken.');
    }
  } catch (e) {
    console.error('[setupLeaveRequestsTab] ' + e.message);
  }
}

/**
 * Run all setup functions in one go.
 * Safe to run multiple times — checks if tabs already exist first.
 */
function runFullSetup() {
  setupAnnouncementsTab();
  setupLeaveRequestsTab();
  setupDailyAttendanceTab();
  console.log('[runFullSetup] All setup tasks completed.');
}

// ════════════════════════════════════════════════════════════════════════════
// PAYROLL MODULE — Management only (OWNER / MANAGER)
// Sheet: Payroll in MASTER_SHEET_ID
// Columns: payroll_id, emp_id, emp_name, dept, month, basic_salary,
//          hra, conveyance, other_allowances, gross_salary,
//          pf_deduction, esi_deduction, tds, other_deductions,
//          total_deductions, net_salary, payment_date, payment_mode,
//          remarks, status, approved_by, created_at
// ════════════════════════════════════════════════════════════════════════════
function getPayroll(filters, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  filters = filters || {};
  var rows = [];
  try {
    rows = getSheetData(MASTER_SHEET_ID, 'Payroll');
  } catch (e) {
    console.warn('[getPayroll] Payroll sheet not found: ' + e.message);
    return { records: [], summary: {} };
  }

  // Filters
  if (filters.month && filters.month !== 'all')
    rows = rows.filter(function (r) { return String(r['month'] || '') === filters.month; });
  if (filters.emp_id && filters.emp_id !== 'all')
    rows = rows.filter(function (r) { return String(r['emp_id'] || '') === filters.emp_id; });
  if (filters.dept && filters.dept !== 'all')
    rows = rows.filter(function (r) { return String(r['dept'] || '') === filters.dept; });
  if (filters.status && filters.status !== 'all')
    rows = rows.filter(function (r) { return String(r['status'] || '') === filters.status; });

  rows.sort(function (a, b) {
    var m = String(b['month'] || '').localeCompare(String(a['month'] || ''));
    if (m !== 0) return m;
    return String(a['emp_name'] || '').localeCompare(String(b['emp_name'] || ''));
  });

  var records = rows.map(function (r) {
    return {
      payroll_id: String(r['payroll_id'] || ''),
      emp_id: String(r['emp_id'] || ''),
      emp_name: String(r['emp_name'] || ''),
      dept: String(r['dept'] || ''),
      month: String(r['month'] || ''),
      basic_salary: Number(r['basic_salary'] || 0),
      hra: Number(r['hra'] || 0),
      conveyance: Number(r['conveyance'] || 0),
      other_allowances: Number(r['other_allowances'] || 0),
      gross_salary: Number(r['gross_salary'] || 0),
      pf_deduction: Number(r['pf_deduction'] || 0),
      esi_deduction: Number(r['esi_deduction'] || 0),
      tds: Number(r['tds'] || 0),
      other_deductions: Number(r['other_deductions'] || 0),
      total_deductions: Number(r['total_deductions'] || 0),
      net_salary: Number(r['net_salary'] || 0),
      payment_date: String(r['payment_date'] || ''),
      payment_mode: String(r['payment_mode'] || ''),
      remarks: String(r['remarks'] || ''),
      status: String(r['status'] || 'Pending'),
      approved_by: String(r['approved_by'] || ''),
      created_at: String(r['created_at'] || '')
    };
  });

  // Summary
  var summary = {
    total_records: records.length,
    total_gross: records.reduce(function (s, r) { return s + r.gross_salary; }, 0),
    total_deductions: records.reduce(function (s, r) { return s + r.total_deductions; }, 0),
    total_net: records.reduce(function (s, r) { return s + r.net_salary; }, 0),
    paid_count: records.filter(function (r) { return r.status === 'Paid'; }).length,
    pending_count: records.filter(function (r) { return r.status === 'Pending'; }).length
  };

  return { records: records, summary: summary };
}

function savePayroll(data, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  if (!data.emp_id) throw new Error('Employee is required');
  if (!data.month) throw new Error('Month is required');
  if (!data.basic_salary && data.basic_salary !== 0) throw new Error('Basic salary is required');

  var now = getISTTimestamp();
  var today = getISTDate();
  var payrollId = 'PAY-' + today.replace(/-/g, '') + '-' + String(data.emp_id).replace(/\s/g, '');

  // Auto-calc totals if not provided
  var gross = (Number(data.basic_salary) || 0) + (Number(data.hra) || 0) +
    (Number(data.conveyance) || 0) + (Number(data.other_allowances) || 0);
  var totalDed = (Number(data.pf_deduction) || 0) + (Number(data.esi_deduction) || 0) +
    (Number(data.tds) || 0) + (Number(data.other_deductions) || 0);
  var net = gross - totalDed;

  var row = {
    payroll_id: payrollId,
    emp_id: String(data.emp_id || ''),
    emp_name: String(data.emp_name || ''),
    dept: String(data.dept || ''),
    month: String(data.month || ''),
    basic_salary: Number(data.basic_salary || 0),
    hra: Number(data.hra || 0),
    conveyance: Number(data.conveyance || 0),
    other_allowances: Number(data.other_allowances || 0),
    gross_salary: data.gross_salary !== undefined ? Number(data.gross_salary) : gross,
    pf_deduction: Number(data.pf_deduction || 0),
    esi_deduction: Number(data.esi_deduction || 0),
    tds: Number(data.tds || 0),
    other_deductions: Number(data.other_deductions || 0),
    total_deductions: data.total_deductions !== undefined ? Number(data.total_deductions) : totalDed,
    net_salary: data.net_salary !== undefined ? Number(data.net_salary) : net,
    payment_date: String(data.payment_date || ''),
    payment_mode: String(data.payment_mode || 'Bank Transfer'),
    remarks: String(data.remarks || ''),
    status: String(data.status || 'Pending'),
    approved_by: String(user['Name'] || ''),
    created_at: now
  };

  appendRow(MASTER_SHEET_ID, 'Payroll', row);
  return { success: true, payroll_id: payrollId };
}

function updatePayrollStatus(payrollId, status, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isOwner(user)) throw new Error('PERMISSION_DENIED'); // only OWNER can mark Paid
  updateRowByField(MASTER_SHEET_ID, 'Payroll', 'payroll_id', payrollId, {
    'status': status,
    'approved_by': String(user['Name'] || ''),
    'payment_date': status === 'Paid' ? getISTDate() : ''
  });
  return { success: true };
}

// ════════════════════════════════════════════════════════════════════════════
// PAYROLL SUMMARY — Attendance + Approved Leave based salary computation
// Reads salary components from Doer List (Basic, HRA, Conveyance, PF, etc.)
// Computes per-day salary, deducts LWP days, returns per-employee summary
// Columns needed in Doer List:
//   Basic Salary, HRA, Conveyance, Other Allowances, PF Deduction,
//   ESI Deduction, TDS, Other Deductions
// ════════════════════════════════════════════════════════════════════════════

function getPayrollSummary(monthYear, deptFlt, passedUser) {
  var user = verifyUser(passedUser);
  if (!user) throw new Error('NOT_AUTHENTICATED');
  if (!isManager(user)) throw new Error('PERMISSION_DENIED');

  var today = getISTDate();
  var month = monthYear || today.substring(0, 7);
  var yr = parseInt(month.split('-')[0], 10);
  var mo = parseInt(month.split('-')[1], 10) - 1;

  var daysInMonth = new Date(yr, mo + 1, 0).getDate();
  var allDates = [];
  for (var d = 1; d <= daysInMonth; d++) {
    var mm = (mo + 1) < 10 ? '0' + (mo + 1) : '' + (mo + 1);
    var dd = d < 10 ? '0' + d : '' + d;
    allDates.push(yr + '-' + mm + '-' + dd);
  }

  var holSet = {};
  try {
    getSheetData(MASTER_SHEET_ID, 'Holiday List').forEach(function (h) {
      var dt = _normDateSafe(h['Date'] || h['Holiday Date'] || '');
      if (dt && dt.substring(0, 7) === month) holSet[dt] = true;
    });
  } catch (e) { }

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');

  var doerMap = {};
  var weekOffDayMap = {};
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '').trim();
    if (!id) return;
    var na = String(d['NeedAttendance'] || '').trim().toLowerCase();
    if (na === 'no') return;
    if (deptFlt && deptFlt !== 'all' && String(d['Department'] || '') !== deptFlt) return;

    doerMap[id] = {
      emp_id: id,
      name: String(d['Name'] || ''),
      dept: String(d['Department'] || ''),
      role: String(d['Role'] || 'STAFF'),
      photo: String(d['PHOTO'] || ''),
      phone: String(d['Phone'] || d['Mobile'] || ''),
      basic_salary: Number(d['Basic Salary'] || d['Basic'] || d['basic_salary'] || d['Salary'] || d['basic'] || d['BASIC'] || 0),
      hra: Number(d['HRA'] || d['H.R.A'] || d['hra'] || d['House Rent'] || d['HRA Amt'] || 0),
      conveyance: Number(d['Conveyance'] || d['Conv'] || d['conveyance'] || d['Travel'] || d['TA'] || d['Conv Allowance'] || 0),
      other_allowances: Number(d['Other Allowances'] || d['Other Allow'] || d['Other'] || d['other_allowances'] || d['Misc'] || d['Special Allowance'] || 0),
      pf_deduction: Number(d['PF Deduction'] || d['PF'] || d['pf_deduction'] || d['Provident Fund'] || d['EPF'] || d['PF Amount'] || 0),
      esi_deduction: Number(d['ESI Deduction'] || d['ESI'] || d['esi_deduction'] || d['ESIC'] || d['ESI Amount'] || 0),
      tds: Number(d['TDS'] || d['Income Tax'] || d['tds'] || d['Tax'] || d['IT'] || 0),
      other_deductions: Number(d['Other Deductions'] || d['Other Ded'] || d['other_deductions'] || d['Misc Deduction'] || 0),
      office_in: String(d['Office IN'] || '').trim(),
      office_out: String(d['Office OUT'] || '').trim()
    };

    weekOffDayMap[id] = _parseWeekOffDay(d['Week Off Day']);
  });

  var leaveSet = {};
  try {
    getSheetData(NEW_ATTENDANCE_SHEET_ID, 'leave_requests').forEach(function (l) {
      if (String(l['status'] || '').trim() !== 'Approved') return;
      var eid = String(l['emp_id'] || '').trim();
      var lt = String(l['leave_type'] || 'CL');
      var fd = _normDateSafe(l['from_date'] || '');
      var td = _normDateSafe(l['to_date'] || '');
      if (!eid || !fd || !td) return;
      if (!leaveSet[eid]) leaveSet[eid] = {};
      var cur = new Date(parseInt(fd.substring(0, 4), 10), parseInt(fd.substring(5, 7), 10) - 1, parseInt(fd.substring(8, 10), 10));
      var end = new Date(parseInt(td.substring(0, 4), 10), parseInt(td.substring(5, 7), 10) - 1, parseInt(td.substring(8, 10), 10));
      while (cur <= end) {
        var ds = Utilities.formatDate(cur, 'Asia/Kolkata', 'yyyy-MM-dd');
        if (ds.substring(0, 7) === month) leaveSet[eid][ds] = lt;
        cur.setDate(cur.getDate() + 1);
      }
    });
  } catch (e) {
    console.warn('[getPayrollSummary] leave_requests: ' + e.message);
  }

  var attSet = {};
  try {
    getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance').forEach(function (a) {
      var eid = String(a['emp_id'] || '').trim();
      var dt = _normDateSafe(a['date'] || '');
      if (!eid || !dt || dt.substring(0, 7) !== month) return;
      if (!attSet[eid]) attSet[eid] = {};
      var s = _normAttStatus(String(a['status'] || ''));
      var ci = a['check_in'] instanceof Date
        ? Utilities.formatDate(a['check_in'], 'Asia/Kolkata', 'HH:mm')
        : String(a['check_in'] || '').trim();
      var co = a['check_out'] instanceof Date
        ? Utilities.formatDate(a['check_out'], 'Asia/Kolkata', 'HH:mm')
        : String(a['check_out'] || '').trim();
      var th = String(a['total_hours'] || '').trim();
      attSet[eid][dt] = { status: s || 'P', in: ci, out: co, hours: th };
    });
  } catch (e) {
    console.warn('[getPayrollSummary] attendance: ' + e.message);
  }

  var results = Object.keys(doerMap).map(function (eid) {
    var doer = doerMap[eid];
    var empWOD = weekOffDayMap.hasOwnProperty(eid) ? weekOffDayMap[eid] : 0;
    var empAtt = attSet[eid] || {};
    var empLeave = leaveSet[eid] || {};

    var totalWorkingDays = 0;
    var presentDays = 0;
    var absentDays = 0;
    var leaveDays = 0;
    var lwpDays = 0;
    var holidayDays = 0;
    var weekOffDays = 0;
    var dailyLog = [];

    allDates.forEach(function (date) {
      var dow = _dowFromYmd(date);
      var isWO = (dow === empWOD);
      var isHol = !!holSet[date];

      // Week Off / Holiday ALWAYS win over sheet Absent
      if (isWO) {
        weekOffDays++;
        var woAtt = empAtt[date] || null;
        dailyLog.push({
          date: date,
          status: 'WO',
          value: 0,
          in: woAtt ? (woAtt.in || '') : '',
          out: woAtt ? (woAtt.out || '') : '',
          hours: woAtt ? (woAtt.hours || '') : ''
        });
        return;
      }
      if (isHol) {
        holidayDays++;
        dailyLog.push({ date: date, status: 'H', value: 0, in: '', out: '', hours: '' });
        return;
      }

      totalWorkingDays++;
      var attRec = empAtt[date] || null;
      var attSt = attRec ? attRec.status : '';
      var punchIn = attRec ? (attRec.in || '') : '';
      var punchOut = attRec ? (attRec.out || '') : '';
      var punchHrs = attRec ? (attRec.hours || '') : '';
      var leaveType = empLeave[date] || '';

      if (attRec && punchIn && punchOut && punchIn !== '-' && punchOut !== '-') {
        try {
          var ciP2 = punchIn.split(':'), coP2 = punchOut.split(':');
          var diffM = (parseInt(coP2[0], 10) * 60 + parseInt(coP2[1], 10)) -
                      (parseInt(ciP2[0], 10) * 60 + parseInt(ciP2[1], 10));
          if (diffM > 0) {
            var workedH = diffM / 60;
            var expH = doer.office_in && doer.office_out ? _hoursBetween(doer.office_in, doer.office_out) : 8;
            if (isNaN(expH) || expH < 3 || expH > 14) expH = 8;
            attSt = (workedH >= expH * 0.75) ? 'P' : 'HD';
          }
        } catch (eHD) { }
      }

      var dayStatus, dayValue;
      if (attSt === 'P') {
        dayStatus = 'P'; dayValue = 1; presentDays++;
      } else if (attSt === 'HD') {
        dayStatus = 'HD'; dayValue = 0.5; presentDays += 0.5;
      } else if (leaveType) {
        if (leaveType === 'LWP') {
          dayStatus = 'LWP'; dayValue = 0; lwpDays++;
        } else {
          dayStatus = leaveType; dayValue = 1; leaveDays++;
        }
      } else {
        dayStatus = 'A'; dayValue = 0; absentDays++;
      }

      dailyLog.push({
        date: date,
        status: dayStatus,
        value: dayValue,
        in: punchIn,
        out: punchOut,
        hours: punchHrs
      });
    });

    // ── Joolry client policy: fixed 30-day salary + Weekly Off entitlement ──
    // WO entitlement = Sundays in month (can be taken any day via "Weekly Off" leave)
    // Extra pay when WO taken < entitlement; excess WO → PTO then Unpaid
    var monthlySalary = doer.basic_salary + doer.hra + doer.conveyance + doer.other_allowances;
    if (!monthlySalary) monthlySalary = doer.basic_salary;

    var woEntitlement = _sundaysInMonth(yr, mo + 1);

    // Count leave types from approved leave map for this emp
    var woTaken = 0, ptoTaken = 0, unpaidLeaveDays = 0, otherPaidLeave = 0;
    Object.keys(empLeave).forEach(function (ds) {
      var lt = _normLeaveType(empLeave[ds]);
      if (lt === 'Weekly Off') woTaken++;
      else if (lt === 'PTO') ptoTaken++;
      else if (lt === 'Unpaid') unpaidLeaveDays++;
      else otherPaidLeave++;
    });
    // Absences without leave = unpaid
    unpaidLeaveDays += absentDays;

    // PTO remaining (year) before this month's excess cover
    var ptoAnnual = 0;
    try {
      var rawDoer = doers.filter(function (x) { return String(x['Emp ID'] || '').trim() === eid; })[0];
      if (rawDoer) ptoAnnual = _ptoAnnualFromDoer(rawDoer);
    } catch (eP) { }
    var ytdPto = 0;
    try {
      ytdPto = (_countApprovedLeaveDaysByType(eid, String(yr))['PTO'] || 0);
      // Don't double-count current month PTO already in ytd when covering excess
    } catch (eY) { }
    var ptoRemainingBefore = Math.max(0, ptoAnnual - ytdPto);

    var pol = _calcWoPayroll(monthlySalary, woEntitlement, woTaken, ptoTaken, ptoRemainingBefore);
    // Also deduct pure unpaid leave days (not from WO excess — already in pol)
    // If unpaidLeaveDays includes absences, add deduction for those not already in excess
    var extraUnpaidDays = Math.max(0, unpaidLeaveDays - pol.unpaid_from_excess);
    var extraUnpaidDed = Math.round(extraUnpaidDays * pol.daily_rate);

    var gross = monthlySalary;
    var lwpDeduction = pol.unpaid_deduction + extraUnpaidDed;
    var totalDed = doer.pf_deduction + doer.esi_deduction + doer.tds + doer.other_deductions + lwpDeduction;
    // Net = monthly + extra WO pay − deductions
    var net = Math.max(0, monthlySalary + pol.extra_pay - totalDed);

    var payableDays = presentDays + otherPaidLeave + ptoTaken + Math.min(woTaken, woEntitlement);
    var deductDays = pol.unpaid_from_excess + extraUnpaidDays;

    return {
      emp_id: eid,
      emp_name: doer.name,
      dept: doer.dept,
      role: doer.role,
      photo: doer.photo,
      phone: doer.phone,
      basic_salary: doer.basic_salary,
      hra: doer.hra,
      conveyance: doer.conveyance,
      other_allowances: doer.other_allowances,
      gross_salary: gross,
      pf_deduction: doer.pf_deduction,
      esi_deduction: doer.esi_deduction,
      tds: doer.tds,
      other_deductions: doer.other_deductions,
      lwp_deduction: lwpDeduction,
      total_deductions: totalDed,
      net_salary: net,
      // Policy fields
      week_off_entitlement: woEntitlement,
      week_off_taken: woTaken,
      week_off_worked: pol.wo_worked,
      extra_pay: pol.extra_pay,
      pto_taken: ptoTaken,
      pto_annual: ptoAnnual,
      unpaid_days: deductDays,
      total_working_days: totalWorkingDays,
      present_days: presentDays,
      absent_days: absentDays,
      leave_days: leaveDays,
      lwp_days: deductDays,
      week_off_days: woTaken,
      holiday_days: holidayDays,
      payable_days: payableDays,
      per_day_salary: pol.daily_rate,
      daily_log: dailyLog
    };
  });

  results.sort(function (a, b) {
    return a.dept.localeCompare(b.dept) || a.emp_name.localeCompare(b.emp_name);
  });

  var grandGross = results.reduce(function (s, r) { return s + r.gross_salary; }, 0);
  var grandDed = results.reduce(function (s, r) { return s + r.total_deductions; }, 0);
  var grandNet = results.reduce(function (s, r) { return s + r.net_salary; }, 0);

  return {
    month: month,
    days_in_month: daysInMonth,
    employees: results,
    summary: {
      total_employees: results.length,
      total_gross: grandGross,
      total_deductions: grandDed,
      total_net: grandNet
    }
  };
}

function setupPayrollTab() {
  try {
    var ss = _getSpreadsheet(MASTER_SHEET_ID);
    if (!ss.getSheetByName('Payroll')) {
      var sh = ss.insertSheet('Payroll');
      var headers = [
        'payroll_id', 'emp_id', 'emp_name', 'dept', 'month',
        'basic_salary', 'hra', 'conveyance', 'other_allowances', 'gross_salary',
        'pf_deduction', 'esi_deduction', 'tds', 'other_deductions', 'total_deductions',
        'net_salary', 'payment_date', 'payment_mode', 'remarks', 'status', 'approved_by', 'created_at'
      ];
      sh.appendRow(headers);
      sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#005F73').setFontColor('#ffffff');
      console.log('[setupPayrollTab] Created Payroll tab.');
    } else {
      console.log('[setupPayrollTab] Tab already exists.');
    }
  } catch (e) { console.error('[setupPayrollTab] ' + e.message); }
}

// ════════════════════════════════════════════════════════════════════════════
// CACHE MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

/** Clear all portal caches. Call after bulk data imports or structural changes. */
function clearAllCaches() {
  var cache = CacheService.getScriptCache();
  ['doer_list_v3', 'doer_list_v2', 'week_list_v2', 'doer_list', 'week_list'].forEach(function (k) {
    cache.remove(k);
  });
  _cc = null; // also reset config cache
  return { success: true, message: 'All caches cleared.' };
}

function clearAttendanceCaches() {
  var cs = CacheService.getScriptCache();
  var ids = [NEW_ATTENDANCE_SHEET_ID, MASTER_SHEET_ID];
  var tabs = ['Daily-Attendance', 'Doer List'];
  ids.forEach(function (id) {
    tabs.forEach(function (tab) {
      try {
        cs.remove('sd_' + String(id).slice(-6) + '_' + tab.replace(/\s/g, '_'));
      } catch (e) {}
    });
  });
  Logger.log('OK: attendance caches cleared');
}


// ── TIMEZONE DEBUG — Run this from Apps Script editor to diagnose ──────────
function debugTimezone() {
  var now = new Date();
  console.log('new Date() raw:', now.toString());
  console.log('new Date() UTC ISO:', now.toISOString());
  console.log('formatDate Asia/Kolkata HH:mm:', Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm'));
  console.log('formatDate Asia/Kolkata full:', Utilities.formatDate(now, 'Asia/Kolkata', 'dd-MM-yyyy HH:mm:ss'));
  console.log('formatDate TIMEZONE HH:mm:', Utilities.formatDate(now, _getTimezone(), 'HH:mm'));
  console.log('formatDate TIMEZONE full:', Utilities.formatDate(now, _getTimezone(), 'dd-MM-yyyy HH:mm:ss'));
  console.log('Session timezone:', Session.getScriptTimeZone());
  console.log('TIMEZONE var value:', TIMEZONE);
}

// ════════════════════════════════════════════════════════════════════════════
// END OF Code_Enhanced.gs
// ════════════════════════════════════════════════════════════════════════════

// ── ATTENDANCE DEBUG — Run from Apps Script editor ──────────────────────────
function debugAttendanceRead() {
  var empCode = 'Emp-1';
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  console.log('Looking for empCode:', empCode, 'today:', today);

  var rows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance');
  console.log('Total rows in Daily-Attendance:', rows.length);

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var rEmpId = String(r['emp_id'] || '');
    var rDate = _normDateSafe(r['date']);
    console.log('Row', i, '| emp_id:', rEmpId, '| date:', rDate,
      '| match emp:', rEmpId === empCode,
      '| match date:', rDate === today);
    if (rEmpId === empCode) {
      console.log('  check_in_device_ts raw type:', typeof r['check_in_device_ts']);
      console.log('  check_in_device_ts instanceof Date:', r['check_in_device_ts'] instanceof Date);
      console.log('  check_in_device_ts String():', String(r['check_in_device_ts']));
      console.log('  check_out raw:', String(r['check_out']));
    }
  }
}

function debugWhichFile() {
  var fileId = getConfig('DRIVE_INDEX_HTML');
  var file = DriveApp.getFileById(fileId);
  console.log('File ID:', fileId);
  console.log('File name:', file.getName());
  console.log('File size chars:', file.getBlob().getDataAsString('utf-8').length);
}

function testAttStatus() {
  var empCode = 'Emp-1';
  var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  var rows = getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance');
  var rec = rows[0]; // first row

  console.log('today:', today);
  console.log('rec date:', String(rec['date']));
  console.log('rec emp_id:', String(rec['emp_id']));
  console.log('check_in type:', typeof rec['check_in']);
  console.log('check_in instanceof Date:', rec['check_in'] instanceof Date);
  console.log('check_in String():', String(rec['check_in']));
  console.log('check_out String():', String(rec['check_out']));
}


function debugChecklistGen() {
  var rows = getSheetData(MASTER_SHEET_ID, 'Working Day Calender');
  console.log('Cal rows count:', rows.length);
  if (rows.length) console.log('First row keys:', Object.keys(rows[0]));
}


function debugSaveNewTask() {
  var testObj = {
    task_name: 'Test Task',
    emp_id: 'Emp-1',
    emp_name: 'Test Employee',
    dept: 'Admin',
    email: 'test@joolry.in',
    frequency: 'D',
    start_date: '2025-05-15'  // jo frontend se aa raha hai exact format
  };

  var startDt = new Date(testObj.start_date);
  console.log('start_date input:', testObj.start_date);
  console.log('new Date() result:', startDt);
  console.log('isNaN:', isNaN(startDt.getTime()));

  try {
    _generateChecklistForTask({
      uid: 'TEST-DEBUG',
      task_name: testObj.task_name,
      emp_id: testObj.emp_id,
      emp_name: testObj.emp_name,
      dept: testObj.dept,
      email: testObj.email,
      frequency: testObj.frequency,
      start_date: testObj.start_date
    });
    console.log('SUCCESS — rows generated');
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

function debugSaveNewTask2() {
  // Ye wahi format hai jo ab Day/Date column mein save ho raha hai
  var formatted = '15-05-2025 00:00:00';

  var startDt = new Date(formatted);
  console.log('formatted input:', formatted);
  console.log('new Date() result:', startDt);
  console.log('isNaN:', isNaN(startDt.getTime())); // true aayega — yahi problem hai
}

function debugGenerateChecklist() {
  // Exact wahi data jo frontend se aata hai
  var t = {
    uid: 'TASK-test123',
    task_name: 'Test Daily Task',
    emp_id: 'Emp-1',
    emp_name: 'Test Employee',
    dept: 'Admin',
    email: 'test@joolry.in',
    frequency: 'D',
    start_date: '2025-05-15'
  };

  var startDt = new Date(t.start_date);
  console.log('startDt:', startDt);
  console.log('isNaN:', isNaN(startDt.getTime()));

  // Calendar check
  var calRows = getSheetData(MASTER_SHEET_ID, 'Working Day Calender');
  var workDays = calRows.map(function (r) {
    var d = r['Working Dates'];
    if (!d) return null;
    return Utilities.formatDate(new Date(d), _getTimezone(), 'yyyy-MM-dd');
  }).filter(Boolean);

  console.log('workDays count:', workDays.length);
  console.log('lastWorkDay:', workDays[workDays.length - 1]);
  console.log('startDt <= lastWorkDay:', startDt <= new Date(workDays[workDays.length - 1]));

  // Repeating check
  var freq = t.frequency;
  var repeating = ['D', 'W', 'F', 'M', '2M', 'Q', '4M', 'H', 'Y', 'E1st', 'E2nd', 'E3rd', 'E4th', 'ELast'].indexOf(freq) >= 0;
  console.log('frequency:', freq);
  console.log('repeating:', repeating);

  // Rows count simulate
  var cur = new Date(startDt);
  var lastWorkDay = new Date(workDays[workDays.length - 1]);
  var count = 0;
  var maxRows = 500;
  while (cur <= lastWorkDay && count < maxRows) {
    count++;
    cur.setDate(cur.getDate() + 1);
  }
  console.log('rows that WOULD be generated:', count);

  // CHECKLIST_MASTER_ID accessible?
  try {
    var ss = _getSpreadsheet(CHECKLIST_MASTER_ID);
    var sh = ss.getSheetByName('Checklist');
    console.log('Checklist found:', !!sh);
    console.log('Current last row:', sh ? sh.getLastRow() : 'N/A');
  } catch (e) {
    console.log('CHECKLIST_MASTER_ID ERROR:', e.message);
  }
}



function debugDirectGenerate() {
  try {
    _generateChecklistForTask({
      uid: 'TASK-directtest',
      task_name: 'Direct Test Task',
      emp_id: 'Emp-1',
      emp_name: 'Test Employee',
      dept: 'Admin',
      email: 'test@joolry.in',
      frequency: 'D',
      start_date: '2025-05-15'
    });

    // Check kitni rows add hui
    var ss = _getSpreadsheet(CHECKLIST_MASTER_ID);
    var sh = ss.getSheetByName('Checklist');
    console.log('Last row AFTER generate:', sh.getLastRow());
    console.log('SUCCESS');

  } catch (e) {
    console.log('ERROR:', e.message);
    console.log('Stack:', e.stack);
  }
}


function debugSaveNewTaskFull() {
  // Exactly wahi object jo frontend bhejta hai
  var taskObj = {
    task_name: 'Frontend Test Task',
    emp_id: 'Emp-1',
    emp_name: 'Test Employee',
    dept: 'Admin',
    email: 'test@joolry.in',
    frequency: 'D',
    start_date: '2025-05-21'  // aaj ki date
  };

  console.log('task_name:', taskObj.task_name);
  console.log('emp_id:', taskObj.emp_id);
  console.log('frequency:', taskObj.frequency);
  console.log('start_date:', taskObj.start_date);
  console.log('start_date type:', typeof taskObj.start_date);

  // saveNewTask simulate — bina verifyUser ke
  var uid = 'TASK-' + 'testuid1';

  try {
    _generateChecklistForTask({
      uid: uid,
      task_name: String(taskObj.task_name || ''),
      emp_id: String(taskObj.emp_id || ''),
      emp_name: String(taskObj.emp_name || ''),
      dept: String(taskObj.dept || ''),
      email: String(taskObj.email || ''),
      frequency: String(taskObj.frequency || 'D'),
      start_date: String(taskObj.start_date || '')
    });
    console.log('Checklist generated OK');
  } catch (ge) {
    console.log('Checklist FAILED:', ge.message);
    console.log('Stack:', ge.stack);
  }
}

function debugTaskList() {
  var data = getSheetData(MASTER_SHEET_ID, 'Task List');
  data.forEach(function (t) {
    console.log(
      'Task:', t['Task'],
      '| Status:', t['Status'],
      '| Delete:', t['Delete Repeated Task'],
      '| UID:', t['Setup Task ID']
    );
  });
}

function debugGetDeptTasks() {
  var today = '2026-05-21';
  var dOfWk = new Date(today).getDay();
  var dOfMo = new Date(today).getDate();
  console.log('today:', today, '| dayOfWeek:', dOfWk, '| dayOfMonth:', dOfMo);

  var setup = getSheetData(MASTER_SHEET_ID, 'Task List');
  console.log('Total Task List rows:', setup.length);

  setup.forEach(function (t) {
    var f = String(t['Frequency'] || 'D');
    var dd = parseInt(t['Day/Date']) || 0;
    var del = String(t['Delete Repeated Task'] || '');

    var passes = true;
    if (del === 'Yes') { passes = false; console.log(t['Task'], '→ SKIP: Delete=Yes'); }
    else if (f === 'D') { console.log(t['Task'], '→ PASS: Daily'); }
    else if (f === 'W' && dd !== dOfWk) { passes = false; console.log(t['Task'], '→ SKIP: W dd=' + dd + ' dOfWk=' + dOfWk); }
    else if (f === 'M' && dd !== dOfMo) { passes = false; console.log(t['Task'], '→ SKIP: M dd=' + dd + ' dOfMo=' + dOfMo); }
    else { console.log(t['Task'], '→ PASS: freq=' + f); }
  });
}

function debugDeptTasks() {
  var today = getISTDate();
  var dOfWk = new Date(today).getDay();
  var dOfMo = new Date(today).getDate();
  console.log('today:', today, 'dow:', dOfWk, 'dom:', dOfMo);

  var setup = getSheetData(MASTER_SHEET_ID, 'Task List');
  setup.forEach(function (t) {
    var f = String(t['Frequency'] || '');
    var dd = String(t['Day/Date'] || '');
    var del = String(t['Delete Repeated Task'] || '');
    console.log('Task:', t['Task'], '| F:', f, '| DD:', dd, '| Del:', del, '| DID:', t['Doer ID']);
  });
}

function debugChecklistToday() {
  var today = '2026-05-21';
  var rows = getSheetData(CHECKLIST_MASTER_ID, 'Checklist');
  console.log('Total rows:', rows.length);
  rows.forEach(function (r) {
    var planned = _normDateSafe(r['Planned']);
    if (planned === today) {
      console.log('MATCH → Task:', r['Task'], '| EmpId:', r['Name Id'], '| Planned:', planned);
    }
  });
  console.log('Done checking');
}
// ════════════════════════════════════════════════════════════════════════════
// PERFORMANCE PROFILER
// Run runPerfProfile() directly from GAS Script Editor (Run button) to get
// a full timing report across all major backend operations.
// Results appear in View → Logs (Ctrl+Enter).
// DO NOT call this from frontend — it runs as the script owner, not a user.
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// PERFORMANCE PROFILER — run runPerfProfile() from GAS Script Editor
// Results in View > Logs. DO NOT call from frontend.
// ════════════════════════════════════════════════════════════════════════════
function refreshChecklistToday() {
  var ss = _getSpreadsheet(CHECKLIST_MASTER_ID);
  var shC = ss.getSheetByName('Checklist');
  var shT = ss.getSheetByName('Checklist_Today');
  if (!shC || !shT) return { error: 'Sheet not found' };

  // Current week Mon–Sat in IST
  var now = new Date();
  var tz = 'Asia/Kolkata';
  var istNow = new Date(Utilities.formatDate(now, tz, "yyyy-MM-dd'T'HH:mm:ss"));
  var dayOfWeek = istNow.getDay(); // 0=Sun
  // NOTE: this function runs via a Sunday 11PM trigger to stage the UPCOMING week.
  // On Sunday, "next Monday" is +1 day (not -6, which wrongly gave the week that's ending).
  var daysFromMon = (dayOfWeek === 0) ? -1 : dayOfWeek - 1;
  var monday = new Date(istNow);
  monday.setDate(istNow.getDate() - daysFromMon);

  var weekDates = [];
  for (var i = 0; i < 6; i++) {
    var d = new Date(monday);
    d.setDate(monday.getDate() + i);
    weekDates.push(Utilities.formatDate(d, tz, 'yyyy-MM-dd'));
  }
  Logger.log('refreshChecklistToday: week = ' + weekDates.join(', '));

  // Read just the Planned column (fast: 1 col × 56K rows)
  var lastRow = shC.getLastRow();
  var lastCol = shC.getLastColumn();
  if (lastRow < 2) return { error: 'Checklist empty' };

  var hdrs = shC.getRange(1, 1, 1, lastCol).getValues()[0];
  var hTrim = hdrs.map(function (h) { return String(h || '').trim(); });
  var iPlnd = hTrim.indexOf('Planned');
  var iAct = hTrim.indexOf('Actual');
  if (iPlnd < 0) return { error: 'Planned column not found in Checklist' };

  var planCol = shC.getRange(2, iPlnd + 1, lastRow - 1, 1).getValues();

  // Find rows for current week
  var matchRows = [];
  for (var ri = 0; ri < planCol.length; ri++) {
    var pd = _normDateSafe(planCol[ri][0]);
    if (weekDates.indexOf(pd) >= 0) matchRows.push(ri + 2);
  }
  Logger.log('Rows for this week: ' + matchRows.length);
  if (matchRows.length === 0) return { success: true, rows: 0, week: weekDates[0] + ' to ' + weekDates[5] };

  // Read matching rows in one block
  matchRows.sort(function (a, b) { return a - b; });
  var minR = matchRows[0], maxR = matchRows[matchRows.length - 1];
  var blockData = shC.getRange(minR, 1, maxR - minR + 1, lastCol).getValues();

  // Build final data: header + matched rows, converting Date objects to strings
  // (avoids blank display when Date objects are written to differently-formatted cells)
  var finalData = [hdrs.map(function (h) { return String(h || '').trim(); })]; // clean header
  var rowSet = {};
  matchRows.forEach(function (r) { rowSet[r] = true; });

  for (var bi = 0; bi < blockData.length; bi++) {
    var absRow = minR + bi;
    if (!rowSet[absRow]) continue;

    var row = blockData[bi].slice(); // copy
    // Convert Date objects → formatted strings so they display correctly everywhere
    for (var ci = 0; ci < row.length; ci++) {
      if (row[ci] instanceof Date) {
        row[ci] = Utilities.formatDate(row[ci], tz, 'dd/MM/yyyy HH:mm:ss');
      }
    }
    finalData.push(row);
  }

  // Replace Checklist_Today with fresh week data
  shT.clearContents();
  shT.getRange(1, 1, finalData.length, finalData[0].length).setValues(finalData);

  // Format Planned/Actual columns as Date-Time for correct display
  var iPlndT = finalData[0].indexOf('Planned') + 1;
  var iActT = finalData[0].indexOf('Actual') + 1;
  var nRows = finalData.length - 1;
  if (nRows > 0) {
    if (iPlndT > 0) shT.getRange(2, iPlndT, nRows, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    if (iActT > 0) shT.getRange(2, iActT, nRows, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  }

  SpreadsheetApp.flush();
  _clearSheetCache(CHECKLIST_MASTER_ID, 'Checklist_Today');

  Logger.log('Checklist_Today refreshed: ' + (finalData.length - 1) + ' rows, week ' + weekDates[0] + ' to ' + weekDates[5]);
  return { success: true, rows: finalData.length - 1, week: weekDates[0] + ' to ' + weekDates[5] };
}

function setupWeeklyChecklistRefresh() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshChecklistToday') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshChecklistToday')
    .timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(23).nearMinute(0).create();
  Logger.log('Weekly refresh trigger set: Sunday 11PM');
  return { success: true, message: 'Trigger set: Sunday 11PM' };
}

function runPerfProfile() {
  var today = getISTDate();
  var monthFrom = today.slice(0, 7) + '-01';
  var DU = { 'Emp ID': 'PERF', 'Name': 'Perf', 'Role': 'OWNER', 'Department': 'MDO', 'Office Email': 'p@t.in', 'NeedAttendance': 'Yes' };
  function T(l, f) { var t = Date.now(); try { var r = f(); console.log('  OK  ' + l + ' → ' + (Date.now() - t) + 'ms' + (r && r.length !== undefined ? ' rows=' + r.length : '')); } catch (e) { console.log('  ERR ' + l + ' → ' + e.message); } }
  function H(s) { console.log('\n[' + s + ']'); }

  console.log('JOOLRY PERF PROFILE ' + today);

  H('1. SHEET READS — COLD (cache cleared)');
  CacheService.getScriptCache().removeAll();
  T('Doer List', function () { return getSheetData(MASTER_SHEET_ID, 'Doer List'); });
  T('Task List', function () { return getSheetData(MASTER_SHEET_ID, 'Task List'); });
  T('Holiday List', function () { return getSheetData(MASTER_SHEET_ID, 'Holiday List'); });
  T('Delegation', function () { return getSheetData(MASTER_SHEET_ID, 'Delegation'); });
  T('AppConfig', function () { return getSheetData(MASTER_SHEET_ID, 'AppConfig'); });
  T('Checklist_Today', function () { return getSheetData(CHECKLIST_MASTER_ID, 'Checklist_Today'); });
  T('Daily-Attendance', function () { return getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance'); });
  T('leave_requests', function () { return getSheetData(NEW_ATTENDANCE_SHEET_ID, 'leave_requests'); });

  H('2. SHEET READS — WARM (from cache, should be <10ms)');
  T('Doer List warm', function () { return getSheetData(MASTER_SHEET_ID, 'Doer List'); });
  T('Daily-Attendance warm', function () { return getSheetData(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance'); });
  T('Checklist_Today warm', function () { return getSheetData(CHECKLIST_MASTER_ID, 'Checklist_Today'); });

  H('3. MAJOR FUNCTIONS (uses warm cache from above)');
  T('getEMDashboard', function () { return getEMDashboard({ from: monthFrom, to: today, dept: 'all', empId: 'all', heatDays: 14 }, DU); });
  T('getAttendanceV2', function () { return getAttendanceAnalyticsV2({ from: monthFrom, to: today, dept: 'all', empId: 'all', status: 'all' }, DU); });
  T('getMusterGrid', function () { return getMusterGrid('All', today.slice(0, 7), DU); });
  T('getChecklistV2', function () { return getChecklistAnalyticsV2({ from: monthFrom, to: today, dept: 'all', freq: 'all', empId: 'all' }, DU); });
  T('getDelegationV2', function () { return getDelegationAnalyticsV2({ from: '2020-01-01', to: today, dept: 'all', empId: 'all', giverId: 'all', status: 'all' }, DU); });
  T('getTeamAttStatus', function () { return getTeamAttendanceStatus(today, DU); });
  T('getTeamChecklistToday', function () { return getTeamChecklistToday(today, 'all', DU); });

  H('4. SheetsAPI vs SpreadsheetApp — Daily-Attendance');
  T('Sheets API v4', function () { return _sheetsApiBulkRead(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance'); });
  T('SpreadsheetApp', function () { var s = SpreadsheetApp.openById(NEW_ATTENDANCE_SHEET_ID).getSheetByName('Daily-Attendance'); return s.getDataRange().getValues(); });

  console.log('\nDONE. CACHE HIT=fast(<10ms) | SHEET READ=slow(200-2000ms)');
}


/**
 * After office hours: if checked-in but no check-out → mark Half Day.
 * Run via time-driven trigger every 30–60 min (e.g. 6 PM – 11 PM IST).
 * Also safe to call manually from Script Editor.
 */
function autoMarkMissedCheckOuts() {
  var today = getISTDate();
  var nowHm = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HH:mm');
  var nowMins = _hmToMins(nowHm);
  if (isNaN(nowMins)) return { success: false, error: 'bad_time' };

  var doers = getSheetData(MASTER_SHEET_ID, 'Doer List');
  var officeOutMap = {}; // empId -> 'HH:mm'
  doers.forEach(function (d) {
    var id = String(d['Emp ID'] || '').trim();
    if (!id) return;
    var oo = _extractTimeStr(d['Office OUT']);
    if (oo) officeOutMap[id] = oo;
  });
  var defaultOut = getConfig('WORK_END_TIME', '18:00') || '18:00';

  var ss = _getSpreadsheet(NEW_ATTENDANCE_SHEET_ID);
  var sh = ss.getSheetByName('Daily-Attendance');
  if (!sh || sh.getLastRow() < 2) return { success: true, updated: 0 };

  var data = sh.getDataRange().getValues();
  var hdrs = data[0].map(function (h) { return String(h || '').trim(); });
  var iEmp = hdrs.indexOf('emp_id');
  var iDate = hdrs.indexOf('date');
  var iIn = hdrs.indexOf('check_in');
  var iOut = hdrs.indexOf('check_out');
  var iSt = hdrs.indexOf('status');
  var iTh = hdrs.indexOf('total_hours');
  if (iEmp < 0 || iDate < 0 || iIn < 0 || iOut < 0) {
    return { success: false, error: 'missing_cols' };
  }

  var updated = 0;
  for (var i = 1; i < data.length; i++) {
    var rowDate = _normDateSafe(data[i][iDate]);
    if (rowDate !== today) continue;

    var eid = String(data[i][iEmp] || '').trim();
    var ci = _extractTimeStr(data[i][iIn]);
    var co = _extractTimeStr(data[i][iOut]);
    if (!ci || ci === '-') continue;          // never checked in
    if (co && co !== '-') continue;           // already checked out

    var officeOut = officeOutMap[eid] || defaultOut;
    var outMins = _hmToMins(officeOut);
    // Only after office end (+ 15 min grace)
    if (isNaN(outMins) || nowMins < outMins + 15) continue;

    if (iSt >= 0) {
      sh.getRange(i + 1, iSt + 1).setNumberFormat('@').setValue('Half Day');
    }
    // Optional: leave check_out blank; total_hours stay '-'
    // Mark reason in total_hours if empty — soft signal for reports
    if (iTh >= 0) {
      var th = String(data[i][iTh] || '').trim();
      if (!th || th === '-') {
        sh.getRange(i + 1, iTh + 1).setNumberFormat('@').setValue('No checkout');
      }
    }
    updated++;
  }

  if (updated > 0) {
    try { _clearSheetCache(NEW_ATTENDANCE_SHEET_ID, 'Daily-Attendance'); } catch (e) {}
  }
  Logger.log('[autoMarkMissedCheckOuts] updated=' + updated);
  return { success: true, updated: updated, date: today };
}

function _hmToMins(hm) {
  if (!hm || String(hm).indexOf(':') < 0) return NaN;
  var p = String(hm).split(':');
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
}


/** Parse Doer List "Week Off Day" → 0=Sun … 6=Sat. Default Sunday. */
function _parseWeekOffDay(wod) {
  if (wod === undefined || wod === null || wod === '') return 0;
  if (typeof wod === 'number' && !isNaN(wod)) {
    var n0 = Math.round(wod);
    if (n0 >= 0 && n0 <= 6) return n0;
  }
  var s = String(wod).replace(/\u00a0/g, ' ').trim().toLowerCase();
  if (!s) return 0;
  var dmap = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6
  };
  if (dmap[s] !== undefined) return dmap[s];
  var three = s.substring(0, 3);
  if (dmap[three] !== undefined) return dmap[three];
  var n = parseInt(s, 10);
  if (!isNaN(n) && n >= 0 && n <= 6) return n;
  return 0;
}

/** Day-of-week from yyyy-MM-dd (local calendar). 0=Sun … 6=Sat */
function _dowFromYmd(dateStr) {
  if (!dateStr) return -1;
  var p = String(dateStr).substring(0, 10).split('-');
  if (p.length < 3) return -1;
  var y = parseInt(p[0], 10), m = parseInt(p[1], 10) - 1, d = parseInt(p[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return -1;
  return new Date(y, m, d).getDay();
}
