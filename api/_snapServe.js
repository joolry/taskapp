// api/_snapServe.js — Answer hot reads from the global Firestore snapshot (Fresko-style)
// Returns undefined when snapshot cannot answer → caller falls back to per-fn cache / GAS.

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
  const list = snap.doers || [];
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].email || '').toLowerCase() === em) return list[i];
  }
  return null;
}

function empCode(doer) {
  return String((doer && (doer.emp_id || doer.emp_code || doer.user_id)) || '');
}

function buildDashStats(snap, doer) {
  const today = snap.today || istToday();
  const code = empCode(doer);
  const stats = {
    pendingTasks: 0,
    doneTasks: 0,
    totalTasks: 0,
    overdueDelegations: 0,
    myAttendanceToday: '-',
    unreadAnnouncements: 0,
    name: String((doer && doer.name) || ''),
    dept: String((doer && doer.department) || ''),
    role: String((doer && doer.role) || 'STAFF')
  };

  const tasks = (snap.checklistToday || []).filter(function (l) {
    return String(l.nameId || l['Name Id'] || '') === code &&
      normDate(l.planned || l['Planned']) === today;
  });
  stats.totalTasks = tasks.length;
  stats.doneTasks = tasks.filter(function (l) {
    return String(l.status || l['Status'] || '') === 'Done';
  }).length;
  stats.pendingTasks = stats.totalTasks - stats.doneTasks;

  const dels = snap.delegations || [];
  stats.overdueDelegations = dels.filter(function (d) {
    if (String(d.delegatedTo || d['Delegated To'] || '') !== code) return false;
    if (String(d.status || d['Status'] || '') === 'Completed') return false;
    const due = normDate(d.finalDate || d['Final Date'] || d.firstDate || d['First Date'] || '');
    return due && due < today;
  }).length;

  const att = (snap.attendance || []).find(function (a) {
    return String(a.emp_id || '') === code && normDate(a.date) === today;
  });
  if (att) {
    const rs = String(att.status || '').trim();
    const ci = extractTime(att.check_in);
    stats.myAttendanceToday = rs || (ci ? 'Present' : '-');
  }

  stats.unreadAnnouncements = (snap.announcements || []).filter(function (a) {
    return String(a.is_active || 'Yes') !== 'No';
  }).length;

  return stats;
}

function buildTodayAtt(snap, doer) {
  const today = snap.today || istToday();
  const code = empCode(doer);
  const empty = {
    status: 'not_checked_in',
    check_in: '', check_out: '',
    check_in_ts: '', check_out_ts: '',
    total_hours: '-', att_id: ''
  };
  const rec = (snap.attendance || []).find(function (a) {
    return String(a.emp_id || '') === code && normDate(a.date) === today;
  });
  if (!rec) return empty;

  const ci = extractTime(rec.check_in) || extractTime(rec.check_in_device_ts);
  const co = extractTime(rec.check_out) || extractTime(rec.check_out_device_ts);
  const th = String(rec.total_hours || '-').trim() || '-';
  const ciTs = ci ? (today + ' ' + ci + ':00') : '';
  const coTs = co ? (today + ' ' + co + ':00') : '';

  if (co) {
    return {
      status: 'checked_out',
      check_in: ci, check_out: co,
      check_in_ts: ciTs, check_out_ts: coTs,
      total_hours: th, att_id: String(rec.att_id || '')
    };
  }
  if (ci) {
    return {
      status: 'checked_in',
      check_in: ci, check_out: '',
      check_in_ts: ciTs, check_out_ts: '',
      total_hours: '-', att_id: String(rec.att_id || '')
    };
  }
  return empty;
}

function buildTodayTasks(snap, doer, dateArg) {
  const today = snap.today || istToday();
  const target = normDate(dateArg) || today;
  const code = empCode(doer);
  const rows = snap.checklistToday || [];
  const out = [];
  const occCount = {};

  for (let i = 0; i < rows.length; i++) {
    const l = rows[i];
    const nameId = String(l.nameId || l['Name Id'] || '').trim();
    const transTo = String(l.transferredTo || l['Transferred To'] || '').trim();
    const rowDate = normDate(l.planned || l['Planned']);
    if (rowDate && rowDate !== target) continue;

    const isOwn = nameId === code;
    const isFromSomeone = !isOwn && transTo === code;
    if (!isOwn && !isFromSomeone) continue;

    const taskName = String(l.task || l['Task'] || '').trim();
    const occKey = nameId + '|' + taskName;
    const occ = occCount[occKey] || 0;
    occCount[occKey] = occ + 1;

    const isTransOut = isOwn && !!transTo && transTo !== code;
    const isReceived = (isOwn && !!transTo && transTo === code) || isFromSomeone;
    const st = String(l.status || l['Status'] || '').trim();

    out.push({
      row_num: l.rowNum || (i + 2),
      occ: occ,
      task_uid: String(l.taskId || l['Task ID'] || l.uid || l['UID In TaskLIst'] || ''),
      task_name: taskName,
      frequency: String(l.freq || l['Freq'] || l['Frequency'] || ''),
      emp_id: nameId,
      planned: rowDate || target,
      status: st || 'Pending',
      actual: String(l.actual || l['Actual'] || ''),
      transferred_to: transTo,
      transferred_at: String(l.transferredAt || l['Transferred At'] || ''),
      transfer_by: String(l.transferBy || l['Transfer By'] || ''),
      transfer_reason: String(l.transferReason || l['Transfer Reason'] || ''),
      is_transferred: isTransOut,
      is_received: isReceived,
      remark: String(l.remark || l['Remark'] || ''),
      scheduled_time: String(l.scheduledTime || '')
    });
  }
  return out;
}

function mapDelRow(d) {
  return {
    task_id: String(d.taskId || d['Task ID'] || ''),
    task: String(d.task || d['Task'] || ''),
    status: String(d.status || d['Status'] || ''),
    delegated_by: String(d.delegatedBy || d['Delegated By'] || ''),
    delegated_to: String(d.delegatedTo || d['Delegated To'] || ''),
    first_date: normDate(d.firstDate || d['First Date'] || ''),
    final_date: normDate(d.finalDate || d['Final Date'] || ''),
    priority: String(d.priority || d['Priority'] || ''),
    remark: String(d.remark || d['Remark'] || ''),
    timestamp: String(d.timestamp || d['Timestamp'] || '')
  };
}

function buildMyDelegations(snap, doer) {
  const code = empCode(doer);
  return (snap.delegations || []).filter(function (d) {
    return String(d.delegatedTo || d['Delegated To'] || '') === code;
  }).map(mapDelRow);
}

function buildMyDelegatedOut(snap, doer) {
  const code = empCode(doer);
  return (snap.delegations || []).filter(function (d) {
    return String(d.delegatedBy || d['Delegated By'] || '') === code;
  }).map(mapDelRow);
}

function buildAllDelegations(snap) {
  return (snap.delegations || []).map(mapDelRow);
}

function buildAnnouncements(snap) {
  return (snap.announcements || []).filter(function (a) {
    return String(a.is_active || 'Yes') !== 'No';
  }).map(function (a) {
    return {
      ann_id: String(a.ann_id || ''),
      text: String(a.text || ''),
      priority: String(a.priority || 'Normal'),
      posted_by: String(a.posted_by || ''),
      posted_by_name: String(a.posted_by_name || ''),
      posted_at: String(a.posted_at || '')
    };
  });
}

function buildBootData(snap, doer) {
  return {
    dashStats: buildDashStats(snap, doer),
    todayAtt: buildTodayAtt(snap, doer),
    announcements: buildAnnouncements(snap),
    myDelegations: buildMyDelegations(snap, doer),
    appConfig: snap.appConfig || {}
  };
}

function buildDashboardStatsFresh(snap, doer) {
  return {
    dashStats: buildDashStats(snap, doer),
    todayAtt: buildTodayAtt(snap, doer),
    announcements: buildAnnouncements(snap),
    myDelegations: buildMyDelegations(snap, doer)
  };
}

function buildTeamAttendance(snap, dateArg) {
  const date = normDate(dateArg) || snap.today || istToday();
  const doers = (snap.doers || []).filter(function (d) {
    return d.need_attendance !== false;
  });
  const attMap = {};
  (snap.attendance || []).forEach(function (r) {
    if (normDate(r.date) !== date) return;
    const eid = String(r.emp_id || '').trim();
    if (!eid) return;
    const ci = extractTime(r.check_in);
    const co = extractTime(r.check_out);
    attMap[eid] = {
      check_in: ci, check_out: co,
      status: String(r.status || ''),
      total_hours: String(r.total_hours || ''),
      att_id: String(r.att_id || '')
    };
  });
  return doers.map(function (s) {
    const a = attMap[s.emp_id] || {};
    const hasIn = !!(a.check_in && a.check_in !== '-');
    const hasOut = !!(a.check_out && a.check_out !== '-');
    return {
      emp_id: s.emp_id,
      name: s.name,
      dept: s.department || '',
      role: s.role || 'STAFF',
      phone: s.phone || '',
      office_in: s.office_in || '',
      date: date,
      check_in: a.check_in || '',
      check_out: a.check_out || '',
      status: a.status || '',
      total_hours: a.total_hours || '',
      att_id: a.att_id || '',
      marked: !!(hasIn || a.status),
      needs_checkout: !!(hasIn && !hasOut),
      complete: !!(hasIn && hasOut)
    };
  });
}

function buildTeamChecklist(snap, dateArg, deptFlt) {
  const date = normDate(dateArg) || snap.today || istToday();
  const empMap = {};
  (snap.doers || []).forEach(function (d) {
    empMap[d.emp_id] = d;
  });
  const rows = snap.checklistToday || [];
  const out = [];
  const occCount = {};

  for (let i = 0; i < rows.length; i++) {
    const l = rows[i];
    const eid = String(l.nameId || l['Name Id'] || '').trim();
    if (!eid) continue;
    const rowDate = normDate(l.planned || l['Planned']);
    if (rowDate && rowDate !== date) continue;
    const emp = empMap[eid] || { name: eid, department: '', role: 'STAFF' };
    if (deptFlt && deptFlt !== 'all' && emp.department !== deptFlt) continue;

    const taskName = String(l.task || l['Task'] || '').trim();
    const occKey = eid + '|' + taskName;
    const occ = occCount[occKey] || 0;
    occCount[occKey] = occ + 1;
    const transTo = String(l.transferredTo || l['Transferred To'] || '').trim();

    out.push({
      row_num: l.rowNum || (i + 2),
      occ: occ,
      task_uid: String(l.taskId || l['Task ID'] || l.uid || ''),
      task_name: taskName,
      emp_id: eid,
      emp_name: emp.name,
      dept: emp.department || '',
      role: emp.role || 'STAFF',
      planned: rowDate || date,
      status: String(l.status || l['Status'] || 'Pending'),
      actual: String(l.actual || l['Actual'] || ''),
      frequency: String(l.freq || l['Freq'] || ''),
      transferred_to: transTo,
      transfer_by: String(l.transferBy || l['Transfer By'] || ''),
      transferred_at: String(l.transferredAt || l['Transferred At'] || ''),
      transfer_reason: String(l.transferReason || l['Transfer Reason'] || ''),
      is_transferred: !!transTo,
      remark: String(l.remark || l['Remark'] || ''),
      scheduled_time: String(l.scheduledTime || '')
    });
  }
  return out;
}

/**
 * Try to serve fn from snapshot. Returns undefined if cannot.
 * email = verified session email
 * args = client args WITHOUT passedUser
 */
function fromSnapshot(fn, args, email, snap) {
  if (!snap || !snap.today) return undefined;
  // Day rollover → force rebuild path
  if (snap.today !== istToday()) return undefined;

  const doer = findDoer(snap, email);
  if (!doer && fn !== 'getAnnouncements' && fn !== 'getAllAppConfigForFrontend' &&
      fn !== 'getHolidayList' && fn !== 'getDoerList') {
    return undefined;
  }

  switch (fn) {
    case 'getBootData':
      return buildBootData(snap, doer);
    case 'getDashboardStats':
      return buildDashStats(snap, doer);
    case 'getDashboardStatsFresh':
      return buildDashboardStatsFresh(snap, doer);
    case 'getTodayAttendanceStatus':
      return buildTodayAtt(snap, doer);
    case 'getTodayTasks':
      return buildTodayTasks(snap, doer, args[1] || args[0]);
    case 'getMyDelegations':
      return buildMyDelegations(snap, doer);
    case 'getMyDelegatedOut':
      return buildMyDelegatedOut(snap, doer);
    case 'getAllDelegations':
      return buildAllDelegations(snap);
    case 'getAnnouncements':
      return buildAnnouncements(snap);
    case 'getAllAppConfigForFrontend':
      return snap.appConfig || {};
    case 'getHolidayList':
      return snap.holidays || [];
    case 'getDoerList':
      return (snap.doers || []).map(function (d) {
        return {
          emp_id: d.emp_id,
          name: d.name,
          department: d.department || '',
          email: d.email || '',
          role: d.role || 'STAFF',
          photo: d.photo || '',
          phone: d.phone || '',
          week_off_day: d.week_off_day != null ? d.week_off_day : 0
        };
      });
    case 'getTeamAttendanceStatus':
      return buildTeamAttendance(snap, args[0]);
    case 'getTeamChecklistToday':
      return buildTeamChecklist(snap, args[0], args[1]);
    case 'getAllData': {
      // Approximate full boot payload for older clients
      const boot = buildBootData(snap, doer);
      return Object.assign({}, boot, {
        todayTasks: buildTodayTasks(snap, doer, null),
        holidays: snap.holidays || [],
        leaveBalance: {}
      });
    }
    default:
      return undefined;
  }
}

module.exports = { fromSnapshot, istToday, findDoer };
