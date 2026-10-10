// api/_snapServe.js — MAIN + MY WORK reads from Firestore snapshot only
function istToday() {
  return new Date(Date.now() + 19800000).toISOString().slice(0, 10);
}
function normDate(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return s.slice(0, 10);
}
function extractTime(v) {
  if (v == null || v === '' || v === '-') return '';
  const s = String(v).trim();
  let m = s.match(/\d{4}-\d{2}-\d{2}[ T](\d{1,2}):(\d{2})/);
  if (!m) m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) m = s.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return '';
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(mi)) return '';
  return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
}
function findDoer(snap, email) {
  const em = String(email || '').toLowerCase().trim();
  for (const d of (snap.doers || [])) {
    if (String(d.email || '').toLowerCase() === em) return d;
  }
  return null;
}
function empCode(doer) {
  return String((doer && (doer.emp_id || doer.emp_code || doer.user_id)) || '');
}
function isManager(doer) {
  const r = String((doer && doer.role) || '').toUpperCase();
  return r === 'OWNER' || r === 'MANAGER' || r === 'ADMIN';
}
function doerNameMap(snap) {
  const m = {};
  (snap.doers || []).forEach(function (d) {
    if (d.emp_id) m[String(d.emp_id)] = String(d.name || '');
  });
  return m;
}
function mapDelRow(d, today, nameMap) {
  today = today || istToday();
  nameMap = nameMap || {};
  const by = String(d.delegatedBy || d.delegated_by || '');
  const to = String(d.delegatedTo || d.delegated_to || '');
  const due = normDate(d.finalDate || d.final_date || d.firstDate || d.first_date || '');
  const sts = String(d.status || 'Pending');
  const tsRaw = String(d.timestamp || '');
  const assignedAt = tsRaw.substring(0, 19);
  let completedAt = '';
  if (sts === 'Completed') completedAt = due;
  return {
    task_id: String(d.taskId || d.task_id || ''),
    delegated_by: by,
    delegated_by_name: nameMap[by] || by || '',
    delegated_to: to,
    delegated_to_name: nameMap[to] || to || '',
    task_desc: String(d.task || d.task_desc || ''),
    task: String(d.task || d.task_desc || ''),
    first_date: normDate(d.firstDate || d.first_date || ''),
    final_date: due,
    revision_1: '',
    revision_2: '',
    status: sts,
    photo_url: '',
    is_overdue: !!(due && sts !== 'Completed' && due < today),
    timestamp: assignedAt,
    assigned_at: assignedAt,
    completed_at: completedAt,
    completion_remarks: String(d.remark || d.remarks || ''),
    shift_reason: String(d.remark || ''),
    remarks: String(d.remark || ''),
    priority: String(d.priority || '')
  };
}
function hoursBetween(ci, co) {
  if (!ci || !co || ci === '-' || co === '-') return 0;
  const a = ci.split(':'), b = co.split(':');
  const diff = (parseInt(b[0], 10) * 60 + parseInt(b[1], 10)) - (parseInt(a[0], 10) * 60 + parseInt(a[1], 10));
  return diff > 0 ? diff / 60 : 0;
}
function fmtHours(h) {
  if (!h || h <= 0) return '-';
  const m = Math.round(h * 60);
  return Math.floor(m / 60) + 'h ' + (m % 60 < 10 ? '0' : '') + (m % 60) + 'm';
}
function isLatePunch(ci, officeIn, lateMins) {
  if (!ci || !officeIn) return false;
  const a = ci.split(':'), b = String(officeIn).split(':');
  return (parseInt(a[0], 10) * 60 + parseInt(a[1], 10)) > (parseInt(b[0], 10) * 60 + parseInt(b[1], 10) + (lateMins || 15));
}
function daysAgoStr(n) {
  return new Date(Date.now() + 19800000 - n * 86400000).toISOString().slice(0, 10);
}

// ── Checklist rows = checklistToday + checklistRecent, WITHOUT double counting ───────────────────
// (after a refresh both arrays hold today's rows; counting both gave duplicate / stale rows in Week + History)
const _chkMemo = new WeakMap();
function chkAll(snap) {
  const hit = _chkMemo.get(snap); if (hit) return hit;
  const today = snap.checklistToday || [], recent = snap.checklistRecent || [];
  const have = new Set();
  today.forEach(function (l) { have.add(normDate(l.planned) + '|' + String(l.nameId || '') + '|' + String(l.task || '')); });
  const out = today.slice();
  recent.forEach(function (l) {
    if (!have.has(normDate(l.planned) + '|' + String(l.nameId || '') + '|' + String(l.task || ''))) out.push(l);
  });
  _chkMemo.set(snap, out);
  return out;
}
// Which dates the snapshot really holds. Outside this window we must ask the sheet (GAS), not show "empty".
const _covMemo = new WeakMap();
function coverage(snap) {
  const hit = _covMemo.get(snap); if (hit) return hit;
  let from = '', to = '';
  chkAll(snap).forEach(function (l) {
    const d = normDate(l.planned); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    if (!from || d < from) from = d;
    if (!to || d > to) to = d;
  });
  const t = snap.today || istToday();
  if (!from || t < from) from = from || t;
  if (!to || t > to) to = t;
  const c = { from: from, to: to };
  _covMemo.set(snap, c);
  return c;
}
function asDate(v) {
  const s = String(v == null ? '' : v).trim();
  return (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) ? normDate(s) : '';
}

function buildDashStats(snap, doer) {
  const today = snap.today || istToday();
  const code = empCode(doer);
  const stats = {
    pendingTasks: 0, doneTasks: 0, totalTasks: 0, overdueDelegations: 0,
    myAttendanceToday: '-', unreadAnnouncements: 0,
    name: String((doer && doer.name) || ''), dept: String((doer && doer.department) || ''),
    role: String((doer && doer.role) || 'STAFF')
  };
  if (!code) return stats;
  const tasks = (snap.checklistToday || []).filter(l => String(l.nameId || '') === code && normDate(l.planned) === today);
  stats.totalTasks = tasks.length;
  stats.doneTasks = tasks.filter(l => String(l.status || '') === 'Done').length;
  stats.pendingTasks = stats.totalTasks - stats.doneTasks;
  stats.overdueDelegations = (snap.delegations || []).filter(d => {
    if (String(d.delegatedTo || '') !== code || String(d.status || '') === 'Completed') return false;
    const due = normDate(d.finalDate || d.firstDate || '');
    return due && due < today;
  }).length;
  const att = (snap.attendance || []).find(a => String(a.emp_id || '') === code && normDate(a.date) === today);
  if (att) stats.myAttendanceToday = String(att.status || '').trim() || (extractTime(att.check_in) ? 'Present' : '-');
  stats.unreadAnnouncements = (snap.announcements || []).filter(a => String(a.is_active || 'Yes') !== 'No').length;
  return stats;
}

function buildTodayAtt(snap, doer) {
  const today = snap.today || istToday();
  const code = empCode(doer);
  const empty = { status: 'not_checked_in', check_in: '', check_out: '', check_in_ts: '', check_out_ts: '', total_hours: '-', att_id: '' };
  if (!code) return empty;
  const rec = (snap.attendance || []).find(a => String(a.emp_id || '') === code && normDate(a.date) === today);
  if (!rec) return empty;
  const ci = extractTime(rec.check_in) || extractTime(rec.check_in_device_ts);
  const co = extractTime(rec.check_out) || extractTime(rec.check_out_device_ts);
  const th = String(rec.total_hours || '-').trim() || '-';
  if (co) return { status: 'checked_out', check_in: ci, check_out: co, check_in_ts: today + ' ' + ci + ':00', check_out_ts: today + ' ' + co + ':00', total_hours: th, att_id: String(rec.att_id || '') };
  if (ci) return { status: 'checked_in', check_in: ci, check_out: '', check_in_ts: today + ' ' + ci + ':00', check_out_ts: '', total_hours: '-', att_id: String(rec.att_id || '') };
  return empty;
}

function buildTodayTasks(snap, doer, dateArg, empArg) {
  const today = snap.today || istToday();
  const target = asDate(dateArg) || today;
  // managers may open another employee's list (same rule as Code.gs); everybody else sees only their own
  const code = (isManager(doer) && empArg && /^[\w-]+$/.test(String(empArg))) ? String(empArg) : empCode(doer);
  if (!code) return [];
  const out = [], occCount = {};
  const src = chkAll(snap);
  for (let i = 0; i < src.length; i++) {
    const l = src[i];
    const nameId = String(l.nameId || '').trim();
    const transTo = String(l.transferredTo || '').trim();
    const rowDate = normDate(l.planned);
    if (rowDate && rowDate !== target) continue;
    const isOwn = nameId === code, isFrom = !isOwn && transTo === code;
    if (!isOwn && !isFrom) continue;
    const taskName = String(l.task || '').trim();
    const occKey = nameId + '|' + taskName;
    const occ = occCount[occKey] || 0; occCount[occKey] = occ + 1;
    out.push({
      row_num: l.rowNum || (i + 2), occ, task_uid: String(l.taskId || l.uid || ''),
      task_name: taskName, frequency: String(l.freq || ''), emp_id: nameId,
      planned: rowDate || target, status: String(l.status || '') || 'Pending',
      actual: String(l.actual || ''), transferred_to: transTo,
      transferred_at: String(l.transferredAt || ''), transfer_by: String(l.transferBy || ''),
      transfer_reason: String(l.transferReason || ''),
      is_transferred: isOwn && !!transTo && transTo !== code,
      is_received: (isOwn && transTo === code) || isFrom,
      remark: String(l.remark || ''), scheduled_time: String(l.scheduledTime || '')
    });
  }
  return out;
}

function buildMyDelegations(snap, doer) {
  const code = empCode(doer);
  if (!code) return [];
  const today = snap.today || istToday();
  const names = doerNameMap(snap);
  return (snap.delegations || []).filter(d => String(d.delegatedTo || '') === code).map(d => mapDelRow(d, today, names));
}
function buildMyDelegatedOut(snap, doer) {
  const code = empCode(doer);
  if (!code) return [];
  const today = snap.today || istToday();
  const names = doerNameMap(snap);
  return (snap.delegations || []).filter(d => String(d.delegatedBy || '') === code).map(d => mapDelRow(d, today, names));
}
function buildAllDelegations(snap, filters) {
  const today = snap.today || istToday();
  const names = doerNameMap(snap);
  let rows = (snap.delegations || []).map(d => mapDelRow(d, today, names));
  if (filters && typeof filters === 'object') {
    if (filters.from_date) rows = rows.filter(d => !d.final_date || d.final_date >= filters.from_date);
    if (filters.to_date) rows = rows.filter(d => !d.first_date || d.first_date <= filters.to_date);
    if (filters.delegated_to && filters.delegated_to !== 'all') rows = rows.filter(d => d.delegated_to === filters.delegated_to);
    if (filters.status && filters.status !== 'All' && filters.status !== 'all') rows = rows.filter(d => d.status === filters.status);
  }
  return rows;
}
function buildAnnouncements(snap) {
  return (snap.announcements || []).filter(a => String(a.is_active || 'Yes') !== 'No').map(a => ({
    ann_id: String(a.ann_id || ''), text: String(a.text || ''), priority: String(a.priority || 'Normal'),
    posted_by: String(a.posted_by || ''), posted_by_name: String(a.posted_by_name || ''), posted_at: String(a.posted_at || '')
  }));
}
function buildBootData(snap, doer) {
  return { dashStats: buildDashStats(snap, doer), todayAtt: buildTodayAtt(snap, doer), announcements: buildAnnouncements(snap), myDelegations: buildMyDelegations(snap, doer), appConfig: snap.appConfig || {} };
}
function buildDashboardStatsFresh(snap, doer) {
  return { dashStats: buildDashStats(snap, doer), todayAtt: buildTodayAtt(snap, doer), announcements: buildAnnouncements(snap), myDelegations: buildMyDelegations(snap, doer) };
}
function buildTeamAttendance(snap, dateArg) {
  const date = normDate(dateArg) || snap.today || istToday();
  const doers = (snap.doers || []).filter(d => d.need_attendance !== false);
  const attMap = {};
  (snap.attendance || []).forEach(r => {
    if (normDate(r.date) !== date) return;
    const eid = String(r.emp_id || '').trim();
    if (eid) attMap[eid] = { check_in: extractTime(r.check_in), check_out: extractTime(r.check_out), status: String(r.status || ''), total_hours: String(r.total_hours || ''), att_id: String(r.att_id || '') };
  });
  return doers.map(s => {
    const a = attMap[s.emp_id] || {};
    const hasIn = !!(a.check_in && a.check_in !== '-');
    const hasOut = !!(a.check_out && a.check_out !== '-');
    return { emp_id: s.emp_id, name: s.name, dept: s.department || '', role: s.role || 'STAFF', phone: s.phone || '', office_in: s.office_in || '', date, check_in: a.check_in || '', check_out: a.check_out || '', status: a.status || '', total_hours: a.total_hours || '', att_id: a.att_id || '', marked: !!(hasIn || a.status), needs_checkout: !!(hasIn && !hasOut), complete: !!(hasIn && hasOut) };
  });
}
function buildTeamChecklist(snap, dateArg, deptFlt) {
  const date = asDate(dateArg) || snap.today || istToday();
  const empMap = {}; (snap.doers || []).forEach(d => { empMap[d.emp_id] = d; });
  const source = chkAll(snap);
  const seen = {}, out = [], occCount = {};
  for (let i = 0; i < source.length; i++) {
    const l = source[i];
    const eid = String(l.nameId || '').trim();
    if (!eid) continue;
    const rowDate = normDate(l.planned);
    if (rowDate && rowDate !== date) continue;
    const key = eid + '|' + String(l.task || '') + '|' + rowDate;
    if (seen[key]) continue; seen[key] = true;
    const emp = empMap[eid] || { name: eid, department: '', role: 'STAFF' };
    if (deptFlt && deptFlt !== 'all' && emp.department !== deptFlt) continue;
    const taskName = String(l.task || '').trim();
    const occKey = eid + '|' + taskName;
    const occ = occCount[occKey] || 0; occCount[occKey] = occ + 1;
    const transTo = String(l.transferredTo || '').trim();
    out.push({ row_num: l.rowNum || (i + 2), occ, task_uid: String(l.taskId || l.uid || ''), task_name: taskName, emp_id: eid, emp_name: emp.name, dept: emp.department || '', role: emp.role || 'STAFF', planned: rowDate || date, status: String(l.status || 'Pending'), actual: String(l.actual || ''), frequency: String(l.freq || ''), transferred_to: transTo, transfer_by: String(l.transferBy || ''), transferred_at: String(l.transferredAt || ''), transfer_reason: String(l.transferReason || ''), is_transferred: !!transTo, remark: String(l.remark || ''), scheduled_time: String(l.scheduledTime || '') });
  }
  return out;
}

function buildMyAttendance(snap, doer, empIdArg, monthYear) {
  const code = empIdArg || empCode(doer);
  if (!code) return { summary: {}, records: [] };
  const cfg = snap.appConfig || {};
  const officeIn = (doer && doer.office_in) || cfg.WORK_START_TIME || '10:00';
  const lateThresh = parseInt(cfg.LATE_THRESHOLD_MINS || '15', 10) || 15;
  const hdThresh = parseFloat(cfg.HALF_DAY_THRESHOLD_HRS || '6') || 6;
  const recs = (snap.attendance || []).filter(a => String(a.emp_id || '') === String(code) && (!monthYear || normDate(a.date).substring(0, 7) === monthYear))
    .sort((a, b) => normDate(b.date).localeCompare(normDate(a.date)));
  const sum = { full_days: 0, half_days: 0, absent: 0, holiday: 0, week_off: 0, late: 0 };
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const records = recs.map(r => {
    const ci = extractTime(r.check_in), co = extractTime(r.check_out);
    const hrs = hoursBetween(ci, co);
    const calculatedHours = hrs > 0 ? fmtHours(hrs) : (String(r.total_hours || '-') || '-');
    let st = String(r.status || '').trim().toUpperCase();
    let statusLabel = String(r.status || ''), isLate = false;
    if (st === 'P' || st === 'PRESENT' || st === 'FD') { statusLabel = 'Present'; sum.full_days++; isLate = isLatePunch(ci, officeIn, lateThresh); if (isLate) sum.late++; }
    else if (st === 'HD') { statusLabel = 'Half Day'; sum.half_days++; }
    else if (st === 'A' || st === 'ABSENT') { statusLabel = 'Absent'; sum.absent++; }
    else if (st === 'H' || st === 'HOLIDAY') { statusLabel = 'Holiday'; sum.holiday++; }
    else if (st === 'WO' || st === 'WE' || st === 'WEEK OFF') { statusLabel = 'Week Off'; sum.week_off++; }
    else if (ci) {
      if (hrs > 0 && hrs < hdThresh) { statusLabel = 'Half Day'; sum.half_days++; }
      else { statusLabel = 'Present'; sum.full_days++; }
      isLate = isLatePunch(ci, officeIn, lateThresh); if (isLate) sum.late++;
    }
    let dayName = String(r.day || '');
    if (!dayName && r.date) { const d = new Date(normDate(r.date) + 'T12:00:00+05:30'); if (!isNaN(d.getTime())) dayName = dayNames[d.getDay()]; }
    return { emp_id: String(r.emp_id || ''), emp_name: String(r.emp_name || ''), dept: String(r.dept || ''), date: normDate(r.date), day_name: dayName, punch_in: ci || '', punch_out: co || '', total_hours: calculatedHours, check_in: ci || '', check_out: co || '', break_hours: '-', status: statusLabel, is_late: isLate, office_in: officeIn, half_day_reason: '' };
  });
  return { summary: sum, records };
}

function buildLeaveRequests(snap, doer, filters) {
  const code = empCode(doer), mgr = isManager(doer);
  let rows = snap.leaveRequests || [];
  if (!(filters && filters.for === 'approvals' && mgr)) rows = rows.filter(r => String(r.emp_id || '') === code);
  if (filters && filters.status && filters.status !== 'All') rows = rows.filter(r => String(r.status || '') === filters.status);
  return rows.slice().sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
}
function buildLeaveSummary(snap, doer, empIdArg, monthYear) {
  const code = empIdArg || empCode(doer);
  const month = monthYear || (snap.today || istToday()).substring(0, 7);
  const counts = {}; let pending = 0, rejected = 0;
  (snap.leaveRequests || []).forEach(r => {
    if (String(r.emp_id || '') !== String(code)) return;
    const fd = normDate(r.from_date);
    if (month && fd && fd.substring(0, 7) !== month) return;
    const st = String(r.status || '');
    if (st === 'Pending') pending++;
    else if (st === 'Rejected') rejected++;
    else if (st === 'Approved') { const lt = String(r.leave_type || 'PTO'); counts[lt] = (counts[lt] || 0) + (parseFloat(r.num_days) || 1); }
  });
  const yr = parseInt(month.split('-')[0], 10), mo = parseInt(month.split('-')[1], 10);
  let sundays = 0;
  if (yr && mo) { const dim = new Date(yr, mo, 0).getDate(); for (let d = 1; d <= dim; d++) if (new Date(yr, mo - 1, d).getDay() === 0) sundays++; }
  const woTaken = counts['Weekly Off'] || 0, ptoTaken = counts['PTO'] || counts['Paid Leave'] || 0, unpaid = counts['Unpaid'] || counts['LWP'] || 0;
  return [{ emp_id: code, month_year: month, sick_leave: counts['Sick Leave'] || 0, paid_leave: ptoTaken, casual_leave: counts['Casual Leave'] || 0, comp_off: counts['Comp Off'] || 0, wfh: counts['WFH'] || 0, lwp: unpaid, week_off_entitlement: sundays, week_off_taken: woTaken, week_off_remaining: Math.max(0, sundays - woTaken), week_off_worked: Math.max(0, sundays - woTaken), pto_taken: ptoTaken, unpaid_taken: unpaid, total_approved: woTaken + ptoTaken + unpaid + (counts['Sick Leave'] || 0) + (counts['Casual Leave'] || 0), total_pending: pending, total_rejected: rejected }];
}
function buildLeaveBalance(snap, doer) {
  return buildLeaveSummary(snap, doer, null, (snap.today || istToday()).substring(0, 7))[0] || {};
}
function buildRegRequests(snap, doer) {
  const code = empCode(doer), mgr = isManager(doer);
  let rows = snap.regRequests || [];
  if (!mgr) rows = rows.filter(r => String(r.emp_id || '') === code);
  return rows.slice().sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
}

function isoWeekDates(yr, wk) {
  const jan4 = new Date(Date.UTC(yr, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4); week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));
  const start = new Date(week1Mon); start.setUTCDate(week1Mon.getUTCDate() + (wk - 1) * 7);
  const dates = [];
  for (let d = 0; d < 7; d++) { const dt = new Date(start); dt.setUTCDate(start.getUTCDate() + d); dates.push(dt.toISOString().slice(0, 10)); }
  return dates;
}
function buildWeeklyTasks(snap, doer, empIdArg, weekNum, yearNum) {
  const code = empIdArg || empCode(doer);
  const yr = yearNum ? Number(yearNum) : new Date().getFullYear();
  const wk = Number(weekNum) || 1;
  const weekDates = isoWeekDates(yr, wk);
  const holSet = {}; (snap.holidays || []).forEach(h => { if (h.date) holSet[h.date] = true; });
  const source = chkAll(snap);
  const byDate = {}; weekDates.forEach(d => { byDate[d] = []; });
  source.forEach(l => {
    if (String(l.nameId || '') !== String(code)) return;
    const pd = normDate(l.planned);
    if (!byDate[pd]) return;
    byDate[pd].push({ task_name: String(l.task || ''), status: String(l.status || 'Pending'), actual: String(l.actual || ''), frequency: String(l.freq || ''), task_uid: String(l.taskId || l.uid || ''), planned: pd });
  });
  return weekDates.map(d => {
    const dt = new Date(d + 'T12:00:00+05:30');
    return { date: d, day_name: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()], is_holiday: !!holSet[d], is_sunday: dt.getDay() === 0, tasks: byDate[d] || [] };
  });
}
function buildTaskHistory(snap, doer, empIdArg, fromDate, toDate) {
  const code = empIdArg || empCode(doer);
  const from = normDate(fromDate) || daysAgoStr(14);
  const to = normDate(toDate) || (snap.today || istToday());
  return chkAll(snap)
    .filter(l => String(l.nameId || '') === String(code) && normDate(l.planned) >= from && normDate(l.planned) <= to)
    .map(l => ({ planned: normDate(l.planned), task_name: String(l.task || ''), status: String(l.status || ''), actual: String(l.actual || ''), frequency: String(l.freq || ''), task_uid: String(l.taskId || l.uid || ''), remark: String(l.remark || '') }))
    .sort((a, b) => b.planned.localeCompare(a.planned));
}
// Task List row -> every column of the sheet, under the keys the app expects (+ legacy keys).
function mapTaskRow(t) {
  return {
    task_uid: t.setupId, task_name: t.task, emp_id: t.doerId, emp_name: t.doerName, dept: t.department,
    frequency: t.frequency, day_date: t.dayDate, day_label: t.dayDate, week_day: t.weekDay, month_day: t.monthDay,
    status: t.status, delete_repeated: t.deleteRepeated || '', start_date: t.startDate,
    // legacy keys (kept so nothing else breaks)
    setup_id: t.setupId, doer_id: t.doerId, doer_name: t.doerName, department: t.department
  };
}
function buildDeptTasks(snap, doer, dept) {
  // Same rule as Code.gs getDeptTasks: managers/owners see all, others only their own
  const mine = isManager(doer) ? '' : empCode(doer);
  return (snap.taskList || [])
    .filter(t => !dept || dept === 'All' || String(t.department || '') === dept)
    .filter(t => !mine || String(t.doerId || '') === mine)
    .map(mapTaskRow);
}
function buildTaskSetup(snap, doer, empIdArg) {
  // Same rule as Code.gs getTaskSetup: manager with no filter sees all, others only their own
  const code = empIdArg || (isManager(doer) ? '' : empCode(doer));
  return (snap.taskList || []).filter(t => !code || String(t.doerId || '') === String(code)).map(mapTaskRow);
}
function buildCelebrations(snap) {
  const today = snap.today || istToday(), md = today.substring(5), out = [];
  (snap.doers || []).forEach(d => {
    function check(raw, type, icon, label) {
      if (!raw) return;
      const s = String(raw).trim(); let norm = '';
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) norm = s.slice(0, 10);
      else { const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) norm = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
      if (!norm || norm.length < 10 || norm.substring(5) !== md) return;
      out.push({ emp_id: d.emp_id, name: d.name, dept: d.department || '', type, icon, label, date: norm });
    }
    check(d.dob, 'birthday', '🎂', 'Birthday');
    check(d.anniversary || d.doj, 'anniversary', '🎉', 'Work Anniversary');
  });
  return out;
}
function buildRecentActivity(snap, doer) {
  const items = [], code = empCode(doer);
  (snap.announcements || []).slice(0, 10).forEach(a => items.push({ type: 'announcement', title: String(a.text || '').slice(0, 80), at: String(a.posted_at || ''), by: String(a.posted_by_name || a.posted_by || '') }));
  (snap.delegations || []).slice(0, 20).forEach(d => {
    if (code && String(d.delegatedTo || '') !== code && String(d.delegatedBy || '') !== code) return;
    items.push({ type: 'delegation', title: String(d.task || ''), status: String(d.status || ''), at: String(d.timestamp || d.finalDate || ''), by: String(d.delegatedBy || '') });
  });
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return items.slice(0, 30);
}

function fromSnapshot(fn, args, email, snap) {
  if (!snap) return undefined;
  const doer = findDoer(snap, email) || { emp_id: '', name: '', department: '', role: 'STAFF', email: email || '' };
  switch (fn) {
    case 'getBootData': return buildBootData(snap, doer);
    case 'getDashboardStats': return buildDashStats(snap, doer);
    case 'getDashboardStatsFresh': return buildDashboardStatsFresh(snap, doer);
    case 'getTodayAttendanceStatus': return buildTodayAtt(snap, doer);
    case 'getTodayTasks': {
      const dt = asDate(args[1]) || asDate(args[0]), cv = coverage(snap);
      if (dt && (dt < cv.from || dt > cv.to)) return undefined;
      return buildTodayTasks(snap, doer, dt, args[0]);
    }
    case 'getMyDelegations': return buildMyDelegations(snap, doer);
    case 'getMyDelegatedOut': return buildMyDelegatedOut(snap, doer);
    case 'getAllDelegations': return buildAllDelegations(snap, args[0]);
    case 'getAnnouncements': return buildAnnouncements(snap);
    case 'getAllAppConfigForFrontend': return snap.appConfig || {};
    case 'getHolidayList': return snap.holidays || [];
    case 'getDoerList': return (snap.doers || []).map(d => ({ emp_id: d.emp_id, name: d.name, department: d.department || '', email: d.email || '', role: d.role || 'STAFF', photo: d.photo || '', phone: d.phone || '', week_off_day: d.week_off_day != null ? d.week_off_day : 0 }));
    case 'getTeamAttendanceStatus': return buildTeamAttendance(snap, args[0]);
    case 'getTeamChecklistToday': {
      const dt = asDate(args[0]), cv = coverage(snap);
      if (dt && (dt < cv.from || dt > cv.to)) return undefined;
      return buildTeamChecklist(snap, args[0], args[1]);
    }
    case 'getMyAttendance': return buildMyAttendance(snap, doer, args[0], args[1]);
    case 'getLeaveRequests': return buildLeaveRequests(snap, doer, args[0]);
    case 'getLeaveSummary': return buildLeaveSummary(snap, doer, args[0], args[1]);
    case 'getLeaveBalance': return buildLeaveBalance(snap, doer);
    case 'getRegularizationRequests': return buildRegRequests(snap, doer);
    case 'getWeeklyTasks': {
      const yr = args[2] ? Number(args[2]) : new Date().getFullYear(), wd = isoWeekDates(yr, Number(args[1]) || 1), cv = coverage(snap);
      if (wd[0] < cv.from && wd[6] < (snap.today || istToday())) return undefined;   // old week not fully in snapshot
      return buildWeeklyTasks(snap, doer, args[0], args[1], args[2]);
    }
    case 'getTaskHistory': {
      const from = asDate(args[1]) || daysAgoStr(14), cv = coverage(snap);
      if (from < cv.from) return undefined;                                          // range older than snapshot
      return buildTaskHistory(snap, doer, args[0], args[1], args[2]);
    }
    case 'getDeptTasks': return buildDeptTasks(snap, doer, args[0]);
    case 'getTaskSetup': return buildTaskSetup(snap, doer, args[0]);
    case 'getTodayCelebrations': return buildCelebrations(snap);
    case 'getRecentActivity': return buildRecentActivity(snap, doer);
    case 'getAllData': {
      const boot = buildBootData(snap, doer);
      return Object.assign({}, boot, { todayTasks: buildTodayTasks(snap, doer, null), holidays: snap.holidays || [], leaveBalance: buildLeaveBalance(snap, doer) });
    }
    default: return undefined;
  }
}
module.exports = { fromSnapshot, istToday, findDoer, normDate, coverage, chkAll };
