'use strict';
    /* ══════════════════════════════════════════════════════════
       STATE VARIABLES
    ══════════════════════════════════════════════════════════ */
    var _U = null;   // Current logged-in user object from GAS

    // ── Session persistence helpers ───────────────────────────────────────────
    var _SESSION_KEY = 'joolry_session_v1';
    // Uses localStorage so session survives page refresh AND tab close
    // Expiry enforced client-side; sign-out always clears it
    function _saveSession(user, token) {
      try {
        var sessionHours = 12;
        try {
          var sh = parseInt(localStorage.getItem('joolry_session_hours') || '');
          if (!isNaN(sh) && sh > 0) sessionHours = sh;
        } catch (e) { }
        var exp = Date.now() + sessionHours * 3600 * 1000;
        localStorage.setItem(_SESSION_KEY, JSON.stringify({
          user: user, token: token, exp: exp, v: 2
        }));
      } catch (e) { }
    }
    function _loadSession() {
      try {
        var raw = localStorage.getItem(_SESSION_KEY);
        if (!raw) return null;
        var s = JSON.parse(raw);
        if (!s || !s.user || !s.token || s.v !== 2) return null;
        if (Date.now() > s.exp) {localStorage.removeItem(_SESSION_KEY); return null;}
        return s;
      } catch (e) {return null;}
    }
    function _clearSession() {
      try {
        localStorage.removeItem(_SESSION_KEY);
        sessionStorage.removeItem('fk_last_view'); // clear nav state too
      } catch (e) { }
    }
    var _V = null;   // Current view name
    var _ST = null;   // Current sub-tab
    var _D = {};
    var _LC_KEY = 'fk_data_v2';
    // Different TTLs: today data short, config/holidays long
    var _LC_TTL_TODAY = 8 * 60 * 1000;      // 8 min for todayAtt / todayTasks / dashStats
    var _LC_TTL_LONG = 6 * 60 * 60 * 1000; // 6 hours for config, holidays, celebrations

    function _lcSave() {
      try {
        var payload = {
          ts: Date.now(),
          d: {
            dashStats: _D.dashStats || null,
            todayAtt: _D.todayAtt || null,
            todayTasks: _D.todayTasks || null,
            announcements: _D.announcements || null,
            leaveBalance: _D.leaveBalance || null,
            holidays: _D.holidays || null,
            myDelegations: _D.myDelegations || null,
            myDelegationsMine: _D.myDelegationsMine || null,
            myDelegatedOut: _D.myDelegatedOut || null,
            celebrations: _D.celebrations || null,
            appConfig: _D.appConfig || null,
            myAtt: _D.myAtt || null,
            myAttMonth: _D.myAttMonth || null
          }
        };
        localStorage.setItem(_LC_KEY, JSON.stringify(payload));
      } catch (e) { }
    }

    function _lcLoad() {
      try {
        var r = localStorage.getItem(_LC_KEY);
        if (!r) return false;
        var p = JSON.parse(r);
        if (!p || !p.ts) return false;

        var age = Date.now() - p.ts;
        var d = p.d || {};
        var hasUseful = false;

        // Long-lived data
        if (age < _LC_TTL_LONG) {
          if (d.holidays) {_D.holidays = d.holidays; hasUseful = true;}
          if (d.celebrations) {_D.celebrations = d.celebrations; hasUseful = true;}
          if (d.appConfig) {_D.appConfig = d.appConfig; hasUseful = true;}
          if (d.leaveBalance) {_D.leaveBalance = d.leaveBalance; hasUseful = true;}
        }

        // Today / dashboard data (shorter TTL)
        if (age < _LC_TTL_TODAY) {
          if (d.dashStats) {_D.dashStats = d.dashStats; hasUseful = true;}
          if (d.todayAtt) {_D.todayAtt = d.todayAtt; hasUseful = true;}
          if (d.todayTasks) {_D.todayTasks = d.todayTasks; hasUseful = true;}
          if (d.announcements) {_D.announcements = d.announcements; hasUseful = true;}
          if (d.myDelegations) {_D.myDelegations = d.myDelegations; hasUseful = true;}
          if (d.myDelegationsMine) {_D.myDelegationsMine = d.myDelegationsMine; hasUseful = true;}
          if (d.myDelegatedOut) {_D.myDelegatedOut = d.myDelegatedOut; hasUseful = true;}
        }

        // Attendance (month-specific)
        if (age < _LC_TTL_TODAY && d.myAtt && d.myAttMonth) {
          _D.myAtt = d.myAtt;
          _D.myAttMonth = d.myAttMonth;
          hasUseful = true;
        }

        if (hasUseful) {
          _D.lastFetch = p.ts;
          return true;
        }
        return false;
      } catch (e) {return false;}
    }

    function _lcClear() {
      try {localStorage.removeItem(_LC_KEY);} catch (e) { }
    }

    var _refreshTimer = null;   // background auto-refresh interval handle
    var _AUTO_REFRESH_MS = 90000; // 90s — balance between freshness and GAS quota

    // Background refresh — fetches only the lightweight dashboard data so
    // changes in Google Sheets (task updates, delegation status, announcements)
    // appear automatically without the user having to manually reload.
    function _startAutoRefresh() {
      _stopAutoRefresh();
      _refreshTimer = setInterval(function () {
        if (document.hidden) return; // skip when tab is in background
        _gas('getDashboardStatsFresh', [], function (d) {
          if (!d) {_hideSplash(); _loadV('dash'); return;}
          if (d.dashStats) _D.dashStats = d.dashStats;
          if (d.todayAtt) _D.todayAtt = d.todayAtt;
          if (d.announcements) _D.announcements = d.announcements;
          if (d.myDelegations) _D.myDelegations = d.myDelegations;
          _D.lastFetch = Date.now(); _lcSave();
          // If currently on the dashboard, silently re-render the KPI strip
          var cur = window._curView || '';
          if (cur === 'dash') {
            var kpiEl = document.getElementById('dashKpi');
            if (kpiEl && d.dashStats) _renderDashKpi(d.dashStats);
          }
        }, function () { }); // silent fail — will retry next interval
      }, _AUTO_REFRESH_MS);
    }

    function _stopAutoRefresh() {
      if (_refreshTimer) {clearInterval(_refreshTimer); _refreshTimer = null;}
    }

    // Hard refresh — clears in-memory _D (forces fresh server fetch on next
    // navigation), shows a spinner, then reloads current view
    function _forceRefresh() {
      var cur = window._curView || 'dash';
      // Clear in-memory + localStorage cache (all Checklist SWR keys too)
      delete _D.dashStats; delete _D.todayAtt; delete _D.todayTasks;
      delete _D.announcements; delete _D.myDelegations; delete _D.myAtt;
      delete _D.lastFetch;
      delete _D.weekTasks; delete _D._ckWeekKey;
      delete _D.teamChecklist; delete _D._ckTeamKey;
      delete _D.histLogs; delete _D._ckHistKey;
      delete _D._ckTodayKey;
      window._tsAllTasks = null;
      _D.lastFetch = null;
      _lcClear();
      try { _toast('<i class="fas fa-rotate-right fa-spin"></i> Syncing latest…', 'info'); } catch (e) {}
      // 1) Ask server to rebuild SNAPSHOT from sheets (realtime)
      // 2) Then reload current view from fresh snap (instant after sync)
      _gasX('clientForceSync', [], 45000, function (d) {
        if (d && d.dashStats) _D.dashStats = d.dashStats;
        if (d && d.todayAtt) _D.todayAtt = d.todayAtt;
        if (d && d.announcements) _D.announcements = d.announcements;
        if (d && d.myDelegations) _D.myDelegations = d.myDelegations;
        if (d && d.todayTasks) {
          _D.todayTasks = d.todayTasks;
          _D._ckTodayKey = String((_U && _U.emp_code) || '') + '|' + _today();
        }
        _D.lastFetch = Date.now();
        try { _lcSave(); } catch (e2) {}
        _loadV(cur);
      }, function () {
        // Fallback: still reload view (will use whatever snap is available)
        _gas('getDashboardStatsFresh', [], function (d) {
          if (d) {
            if (d.dashStats) _D.dashStats = d.dashStats;
            if (d.todayAtt) _D.todayAtt = d.todayAtt;
            if (d.announcements) _D.announcements = d.announcements;
            if (d.myDelegations) _D.myDelegations = d.myDelegations;
            _D.lastFetch = Date.now();
          }
          _loadV(cur);
        }, function () {_loadV(cur);});
      });
    }
    // Cache control: auto-disabled on desktop (>1024px), user can override
    var _cacheOk = (function () {
      try {
        var pref = localStorage.getItem('fk_cache_pref');
        if (pref === '1') return true;
        if (pref === '0') return false;
        return window.innerWidth <= 1024; // mobile/tablet default: cache ON; desktop: OFF
      } catch (e) {return window.innerWidth <= 1024;}
    })();
    function _setCacheToggle(val) {
      _cacheOk = val;
      try {localStorage.setItem('fk_cache_pref', val ? '1' : '0');} catch (e) { }
      var stEl = document.getElementById('cacheState');
      if (stEl) stEl.textContent = val ? 'ON' : 'OFF';
      _toast('Cache ' + (val ? 'enabled' : 'disabled'), 'ok');
    }
    var _dark = false;  // Dark mode state
    var _charts = {};     // Active Chart.js instances (key → instance)
    var _chartQ = [];    // Queue of chart-render callbacks waiting for Chart.js

    // Safe chart render — waits for Chart.js if not yet loaded
    function _whenChart(fn) {
      if (window.Chart) {fn(); return;}
      _chartQ.push(fn);
      // Poll until Chart.js loads (CDN defer may not be ready yet)
      if (_chartQ.length === 1) {
        var poll = setInterval(function () {
          if (!window.Chart) return;
          clearInterval(poll);
          var q = _chartQ.splice(0);
          q.forEach(function (f) {try {f();} catch (e) { } });
        }, 50);
      }
    }
    var _ntfs = [];     // Notification list
    var _ntfU = 0;      // Unread count

    /* Calendar navigation state */
    var _calY = new Date().getFullYear();
    var _calM = new Date().getMonth();

    /* Global search state */
    var _gsTimer = null;
    var _gsList = [];
    var _gsFocused = -1;

    /* Button loading state registry */
    var _loadingBtns = {};

    /* ══════════════════════════════════════════════════════════
       DATE / UTILITY HELPERS
    ══════════════════════════════════════════════════════════ */
    // IST calendar date helpers (UTC+5:30) — never use toISOString() alone (UTC day shift)
    function _istNow() {
      return new Date(Date.now() + 19800000);
    }
    function _today() {
      return _istNow().toISOString().slice(0, 10);
    }
    function _currMonth() {
      return _istNow().toISOString().slice(0, 7);
    }
    function _daysLater(n) {
      var d = _istNow();
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    }
    // ── Universal date/time normalizer ─────────────────────────────────────
    // Handles: "2026-08-10", ISO "2026-08-10T14:30:00", "dd/MM/yyyy HH:mm:ss",
    //          "Apr 01 2026 00:00:00 GMT+0530 (India Standard Time)",
    //          "Mon Apr 01 2026 00:00:00 GMT+0530", raw JS Date.toString()
    function _parseAnyDate(s) {
      if (!s) return null;
      var str = String(s).trim();
      if (!str || str === '-' || str === 'undefined' || str === 'null') return null;

      // Raw JS Date.toString(): "Apr 01 2026 00:00:00 GMT+0530..." or "Mon Apr 01 2026..."
      var gmtMatch = str.match(/([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}:\d{2}:\d{2})/);
      if (gmtMatch) {
        var mo = {Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11};
        var d = new Date(parseInt(gmtMatch[3]), mo[gmtMatch[1]], parseInt(gmtMatch[2]));
        var tp = gmtMatch[4].split(':');
        d.setHours(parseInt(tp[0]), parseInt(tp[1]), parseInt(tp[2]));
        return isNaN(d.getTime()) ? null : d;
      }

      // dd/MM/yyyy HH:mm:ss (AppSheet / GAS format)
      var ddmm = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{2}:\d{2})(?::\d{2})?)?/);
      if (ddmm) {
        var d2 = new Date(parseInt(ddmm[3]), parseInt(ddmm[2]) - 1, parseInt(ddmm[1]));
        if (ddmm[4]) {var t2 = ddmm[4].split(':'); d2.setHours(parseInt(t2[0]), parseInt(t2[1]));}
        return isNaN(d2.getTime()) ? null : d2;
      }

      // ISO / other standard formats
      var normalized = str.length === 10 ? str + 'T00:00:00' : str.replace(' ', 'T');
      var d3 = new Date(normalized);
      return isNaN(d3.getTime()) ? null : d3;
    }

    var _MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function _fmtDate(s) {
      if (!s || s === '-' || s === 'undefined' || s === 'null') return '—';
      try {
        var d = _parseAnyDate(s);
        if (!d) return String(s).substring(0, 16);
        // "8 Aug 2026"
        return d.getDate() + ' ' + _MN[d.getMonth()] + ' ' + d.getFullYear();
      } catch (e) {return s;}
    }
    function _fmtDateShort(s) {
      if (!s || s === '-') return '—';
      try {
        var d = _parseAnyDate(s);
        if (!d) return String(s).substring(0, 10);
        // "8 Aug 2026" — always show year
        return d.getDate() + ' ' + _MN[d.getMonth()] + ' ' + d.getFullYear();
      } catch (e) {return s;}
    }
    function _fmtDateTime(s) {
      if (!s || s === '-') return '—';
      try {
        var d = _parseAnyDate(s);
        if (!d) return String(s).substring(0, 16);
        // "8 Aug 2026 11:00 AM"
        var h = d.getHours(), mi = d.getMinutes();
        var ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
        return d.getDate() + ' ' + _MN[d.getMonth()] + ' ' + d.getFullYear() +
          ' ' + h12 + ':' + (mi < 10 ? '0' : '') + mi + ' ' + ap;
      } catch (e) {return s;}
    }
    function _fmtTimestamp(s) {
      if (!s) return '—';
      try {
        var d = _parseAnyDate(s);
        if (!d) return String(s).substring(0, 16);
        var now = new Date();
        var diff = now - d;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
        return _fmtDate(s);
      } catch (e) {return s;}
    }
    function _dl(dateStr) {
      if (!dateStr) return null;
      var diff = new Date(dateStr + 'T00:00:00') - new Date(_today() + 'T00:00:00');
      return Math.round(diff / 86400000);
    }
    function _dayName(dateStr) {
      try {
        return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', {weekday: 'long'});
      } catch (e) {return '';}
    }
    function _isoWeek(d) {
      d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }
    function _currentWeek() {return _isoWeek(new Date());}

    /* ══════════════════════════════════════════════════════════
       STRING / UI HELPERS
    ══════════════════════════════════════════════════════════ */
    function _isOwner() {
      return _U && _U.role === 'OWNER';
    }
    // Clean total_hours — strips GAS Date object serialization (e.g. "Sat Dec 30 1899...")
    function _cleanHours(v) {
      if (!v || v === '-') return '—';
      var s = String(v).trim();
      if (!s || s === '-') return '—';
      // Already formatted (e.g. "7h 30m")
      if (s.indexOf('h') >= 0) {
        var m2 = s.match(/(\d+)h\s*(\d+)?m?/);
        return m2 ? m2[1] + 'h ' + (m2[2] || '0') + 'm' : s;
      }
      // GAS Date object serialised as ISO string or old-style: detect "1899" or "T"
      if (s.indexOf('1899') >= 0 || (s.indexOf('T') > 0 && s.indexOf('-') > 0)) {
        var tm = s.match(/T(\d{1,2}):(\d{2}):(\d{2})/);
        return tm ? tm[1] + 'h ' + tm[2] + 'm' : '—';
      }
      // "HH:MM:SS" or "HH:MM" — convert to "Xh Ym"
      var tc = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (tc) {
        var hh = parseInt(tc[1], 10), mm = parseInt(tc[2], 10);
        return hh + 'h ' + (mm < 10 ? '0' : '') + mm + 'm';
      }
      // Fraction of day from Sheets serial time
      var fv = parseFloat(s);
      if (!isNaN(fv) && fv > 0 && fv < 1) {
        var totalM = Math.round(fv * 24 * 60);
        return Math.floor(totalM / 60) + 'h ' + (totalM % 60 < 10 ? '0' : '') + (totalM % 60) + 'm';
      }
      return s;
    }
    // Returns <option> tags for all unique departments from loaded doer/emp list
    function _getDeptOptions() {
      var depts = [];
      var seen = {};
      // Use empDir (manager) or doers (staff) — whichever is populated
      var src = (_D.empDir && _D.empDir.length) ? _D.empDir
        : (_D.doers && _D.doers.length) ? _D.doers
          : [];
      src.forEach(function (d) {
        var dep = String(d.dept || d.department || '').trim();
        if (dep && !seen[dep]) {seen[dep] = true; depts.push(dep);}
      });
      depts.sort();
      return depts.map(function (d) {return '<option value="' + _esc(d) + '">' + _esc(d) + '</option>';}).join('');
    }
    function _req(v, label) {
      var s = String(v || '').trim();
      if (!s) {_toast('Required: ' + label, 'err'); return false;}
      return true;
    }
    function _esc(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    function _colorForStatus(s) {
      var m = {
        Done: 'var(--G)', Completed: 'var(--G)', Approved: 'var(--G)',
        Pending: 'var(--O)', Shifted: 'var(--V)', Overdue: 'var(--R)',
        Cancelled: 'var(--tx3)', Rejected: 'var(--R)',
        Holiday: '#4338ca', WO: 'var(--tx2)', 'Week Off': 'var(--tx2)',
        FD: 'var(--G)', HD: 'var(--O)', A: 'var(--R)', P: 'var(--G)',
        H: '#4338ca', WFH: 'var(--P)', LWP: 'var(--R)',
        High: 'var(--R)', Normal: 'var(--P)', Low: 'var(--tx2)'
      };
      return m[s] || 'var(--P)';
    }
    function _statusBadge(s, leaveMode) {
      var cls = {
        Done: 'bdone', Completed: 'bdone', Approved: 'baprv',
        Pending: 'bpend', Shifted: 'bshft', Overdue: 'bovr',
        Cancelled: 'bwo', Rejected: 'brej',
        Holiday: 'bhol', WO: 'bwo', 'Week Off': 'bwo',
        FD: 'bfd', HD: 'bhd', Absent: 'babs', A: 'babs', P: 'bfd',
        H: 'bhol', High: 'prio-high', Normal: 'prio-normal', Low: 'prio-low'
      };
      if (leaveMode) {
        cls['Pending'] = 'bpend-lvr';
      }
      return '<span class="bdg ' + (cls[s] || 'bpend') + '">' + _esc(s || '—') + '</span>';
    }
    function _freqBadge(f) {
      var m = {D: 'freq-d', W: 'freq-w', M: 'freq-m'};
      var l = {D: 'Daily', W: 'Weekly', M: 'Monthly'};
      return '<span class="bdg ' + (m[f] || 'freq-d') + '">' + (l[f] || f || '?') + '</span>';
    }

    /* ══════════════════════════════════════════════════════════
       SKELETON BUILDER
    ══════════════════════════════════════════════════════════ */
    /* ── Loading messages — playful, contextual ── */
    var _skelMsgs = [
      '🔄 Fetching data…', '⏳ Please wait…', '📡 Connecting…',
      '🚀 Loading…', '✨ Almost ready…', '📊 Crunching numbers…',
      '🔍 Gathering info…', '💫 One moment…'
    ];
    var _skelMsgIdx = 0;
    function _skelMsg() {return _skelMsgs[(_skelMsgIdx++) % _skelMsgs.length];}

    function _skel(rows, cls) {
      rows = rows || 3; cls = cls || 'sk-h5';
      var msg = _skelMsg();
      var h = '<div class="sk-row" data-msg="' + msg + '">';
      for (var i = 0; i < rows; i++) {
        var w = i % 3 === 0 ? '' : i % 3 === 1 ? 'width:88%' : 'width:72%';
        h += '<div class="sk ' + cls + '" style="' + w + ';animation-delay:' + (i * 0.12) + 's"></div>';
      }
      return h + '</div>';
    }

    function _skelKpi(n) {
      n = n || 4;
      var h = '<div class="krow" style="grid-template-columns:repeat(' + n + ',1fr)">';
      for (var i = 0; i < n; i++)
        h += '<div class="sk sk-h6" style="border-radius:14px;min-height:90px;animation-delay:' + (i * 0.1) + 's"></div>';
      return h + '</div>';
    }

    /* Context-specific skeleton builders */
    function _skelCard(n) {      // Card grid skeleton
      n = n || 3;
      var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">';
      for (var i = 0; i < n; i++)
        h += '<div class="sk sk-h5" style="min-height:120px;border-radius:16px;animation-delay:' + (i * 0.1) + 's"></div>';
      return h + '</div>';
    }
    function _skelTable(rows) {  // Table skeleton
      rows = rows || 5;
      var h = '<div class="sk-row" style="gap:6px">' +
        '<div class="sk sk-h6" style="height:38px;border-radius:8px;opacity:.5"></div>';
      for (var i = 0; i < rows; i++)
        h += '<div class="sk sk-h5" style="height:48px;border-radius:8px;animation-delay:' + (i * 0.08) + 's"></div>';
      return h + '</div>';
    }

    /* ══════════════════════════════════════════════════════════
       BUTTON LOADING STATE
    ══════════════════════════════════════════════════════════ */
    function _startSub(id, label) {
      var b = document.getElementById(id);
      if (!b || _loadingBtns[id]) return false;
      _loadingBtns[id] = true;
      b._orig = b.innerHTML;
      b.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> ' + (label || 'Processing…');
      b.style.opacity = '.75';
      b.style.pointerEvents = 'none';
      b.style.transform = 'scale(.98)';
      b.style.transition = 'all .15s';
      return true;
    }
    function _endSub(id) {
      var b = document.getElementById(id);
      if (!b) {delete _loadingBtns[id]; return;}
      delete _loadingBtns[id];
      if (b._orig !== undefined) b.innerHTML = b._orig;
      b.style.opacity = '1';
      b.style.pointerEvents = 'auto';
      b.style.transform = '';
    }
    // Show ✓ checkmark briefly on success before restoring original label
    function _successSub(id, msg) {
      var b = document.getElementById(id);
      if (!b) {_endSub(id); return;}
      delete _loadingBtns[id];
      b.innerHTML = '<i class="fas fa-check" style="animation:btnCheck .3s both"></i> ' + (msg || 'Saved!');
      b.style.background = 'var(--G)';
      b.style.color = '#fff';
      b.style.opacity = '1';
      b.style.pointerEvents = 'none';
      b.style.transform = '';
      setTimeout(function () {_endSub(id); b.style.background = ''; b.style.color = '';}, 1600);
    }

    /* ── Searchable Select (ss) JS ─────────────────────────────────────────
       Event-delegation approach: no onclick on individual options.
       _ssHtml(id, optHtml, placeholder, cbName) — generates the HTML.
       Hidden <input id="{id}"> holds the value — existing reads still work.
    ─────────────────────────────────────────────────────────────────────── */
    function _ssHtml(id, optHtml, ph, cb) {
      var re = /<option([^>]*)>([\s\S]*?)<\/option>/gi, m, divs = '';
      while ((m = re.exec(optHtml)) !== null) {
        var a = m[1], lbl = m[2].trim();
        var val = (a.match(/value="([^"]*)"/) || [, ''])[1];
        divs += '<div class="ss-opt" data-v="' + _esc(val) + '">' + _esc(lbl) + '</div>';
      }
      return '<div class="ss-wrap" data-id="' + _esc(id) + '" data-cb="' + _esc(cb || '') + '">' +
        '<input class="ss-inp ana-sel" id="ssd_' + _esc(id) + '" placeholder="' + _esc(ph || 'Select…') + '" readonly>' +
        '<i class="fas fa-chevron-down ss-arr"></i>' +
        '<div class="ss-list" id="ssl_' + _esc(id) + '">' +
        '<div class="ss-sw"><input class="ss-si" placeholder="\uD83D\uDD0D Search…"></div>' +
        '<div class="ss-opts">' + divs + '</div>' +
        '</div>' +
        '<input type="hidden" id="' + _esc(id) + '">' +
        '</div>';
    }
    function _ssSetVal(id, val, lbl) {
      var h = document.getElementById(id), d = document.getElementById('ssd_' + id);
      if (h) h.value = val; if (d) d.value = lbl !== undefined ? lbl : val;
    }
    function _ssVal(id) {
      var h = document.getElementById(id);
      return h ? h.value : '';
    }

    /* Universal searchable select auto-initialiser.
       After every _loadV() this converts ALL <select> elements in the
       content area to searchable ss-wrap components automatically.
       No per-view changes needed - works for every page in the app. */
    function _initSearchSelects(root) {
      var ct = root || document.getElementById('content');
      if (!ct) return;
      ct.querySelectorAll('select:not([data-ss="1"])').forEach(function (sel) {
        if (sel.closest('.ss-wrap')) return;
        sel.setAttribute('data-ss', '1');
        var id = sel.id;
        var st = (sel.getAttribute('style') || '');
        var selIdx = sel.selectedIndex >= 0 ? sel.selectedIndex : 0;
        var selTxt = (sel.options[selIdx] ? sel.options[selIdx].text : '') || '';
        var selVal = sel.value || '';
        var wrap = document.createElement('div');
        wrap.className = 'ss-wrap';
        if (id) wrap.setAttribute('data-id', id);
        if (id) wrap.setAttribute('data-selref', id);
        if (st.trim()) wrap.setAttribute('style', st);
        wrap.innerHTML =
          '<input class="ss-inp ana-sel" id="ssd_' + _esc(id) + '"' +
          ' placeholder="' + _esc(selTxt || 'Select...') + '"' +
          ' value="' + _esc(selTxt) + '" readonly>' +
          '<i class="fas fa-chevron-down ss-arr"></i>' +
          '<div class="ss-list" id="ssl_' + _esc(id) + '">' +
          '<div class="ss-sw"><input class="ss-si" placeholder="Search..."></div>' +
          '<div class="ss-opts" id="ssop_' + _esc(id) + '">' + _buildSsOpts(sel, selVal) + '</div>' +
          '</div>';
        // Keep original select hidden but in DOM — all existing .value/.options/.innerHTML
        // code still works on it. ss-wrap is purely a visual layer on top.
        sel.style.cssText = 'display:none!important;position:absolute;width:0;height:0;opacity:0;pointer-events:none';
        sel.parentNode.insertBefore(wrap, sel);
        // Watch for async option changes (e.g. _populateDeptSel adds options later)
        (function (s, wid) {
          var obs = new MutationObserver(function () {
            var optsEl = document.getElementById('ssop_' + wid);
            if (optsEl) optsEl.innerHTML = _buildSsOpts(s, s.value || '');
            var dsp = document.getElementById('ssd_' + wid);
            if (dsp && s.options[s.selectedIndex]) {
              var t = s.options[s.selectedIndex].text;
              dsp.value = t; dsp.placeholder = t || 'Select...';
            }
          });
          obs.observe(s, {childList: true, subtree: true, attributes: true});
        })(sel, id);
      });
    }

    function _buildSsOpts(sel, curVal) {
      var divs = '';
      Array.from(sel.options).forEach(function (o) {
        divs += '<div class="ss-opt' + (o.value === curVal ? ' ss-hl' : '') +
          '" data-v="' + _esc(o.value) + '">' + _esc(o.text) + '</div>';
      });
      return divs || '<div class="ss-none">No options</div>';
    }


    (function () {
      // ── Portal dropdown — appended to <body> so overflow/transform never clips it ──
      var _ssPortal = null; // the currently open list element (detached from ss-wrap, lives in body)
      var _ssActiveWrap = null; // the ss-wrap that owns the open list
      var _ssOriginParent = null; // original parent to return list to on close
      var _ssOriginNext = null; // original next-sibling for correct DOM position

      function _ssGetTheme() {
        var cs = getComputedStyle(document.documentElement);
        var bg = cs.getPropertyValue('--sur').trim();
        var bdr = cs.getPropertyValue('--bdr2').trim();
        var dark = document.documentElement.classList.contains('dark') ||
          document.body.classList.contains('dark');
        return {
          bg: bg || (dark ? '#1e293b' : '#ffffff'),
          bdr: bdr || (dark ? '#334155' : '#e2e8f0')
        };
      }

      function _ssPosition(list, wrap) {
        var rect = wrap.getBoundingClientRect();
        var wW = window.innerWidth, wH = window.innerHeight;
        var dW = Math.min(Math.max(rect.width, 180), wW - 16);
        var lft = Math.max(4, Math.min(rect.left, wW - dW - 4));
        var spB = wH - rect.bottom - 6, spA = rect.top - 6;
        var above = spB < 200 && spA > spB;
        list.style.right = 'auto';
        list.style.minWidth = '0';
        list.style.left = lft + 'px';
        list.style.width = dW + 'px';
        if (above) {
          list.style.top = 'auto';
          list.style.bottom = (wH - rect.top + 4) + 'px';
        } else {
          list.style.bottom = 'auto';
          list.style.top = (rect.bottom + 4) + 'px';
        }
      }

      function closePortal() {
        if (_ssPortal) {
          // Return list to original DOM position
          _ssPortal.classList.remove('ss-open');
          _ssPortal.style.cssText = '';
          if (_ssPortal._ssScrollFn) {
            window.removeEventListener('scroll', _ssPortal._ssScrollFn, true);
            window.removeEventListener('resize', _ssPortal._ssScrollFn, true);
            delete _ssPortal._ssScrollFn;
          }
          if (_ssPortal.parentNode === document.body) {
            if (_ssOriginParent) {
              _ssOriginParent.insertBefore(_ssPortal, _ssOriginNext);
            }
          }
          _ssPortal = null;
        }
        if (_ssActiveWrap) {
          var inp2 = _ssActiveWrap.querySelector('.ss-inp');
          if (inp2) inp2.classList.remove('ss-open');
          var arr2 = _ssActiveWrap.querySelector('.ss-arr');
          if (arr2) arr2.style.transform = 'translateY(-50%)';
          _ssActiveWrap = null;
        }
        _ssOriginParent = null;
        _ssOriginNext = null;
      }

      function filter(list, q) {
        var ql = (q || '').toLowerCase().trim(), any = false;
        list.querySelectorAll('.ss-opt').forEach(function (o) {
          var h = ql && o.textContent.toLowerCase().indexOf(ql) < 0;
          o.classList.toggle('ss-hi', h);
          if (!h) any = true;
        });
        var em = list.querySelector('.ss-none');
        if (!any && ql) {
          if (!em) {em = document.createElement('div'); em.className = 'ss-none'; em.textContent = 'No results'; list.querySelector('.ss-opts').appendChild(em);}
        } else if (em) em.remove();
      }

      document.addEventListener('click', function (e) {
        var inp = e.target.closest('.ss-inp');
        if (inp) {
          var w = inp.closest('.ss-wrap'), id = w && w.getAttribute('data-id');
          var list = id && document.getElementById('ssl_' + id);
          if (!list) return;
          var wasOpen = (_ssPortal === list);
          closePortal();
          if (!wasOpen) {
            // Portal: calculate position first, then append — no layout flash
            _ssOriginParent = list.parentNode;
            _ssOriginNext = list.nextSibling;
            var t = _ssGetTheme();
            var r0 = w.getBoundingClientRect();
            var wW = window.innerWidth, wH = window.innerHeight;
            // Width: match the select width minimum, cap at viewport
            // Don't use min 200px as override — use actual select width or content
            var minW = Math.max(r0.width, 160);
            var dW = Math.min(minW, wW - 16);
            var lft = Math.max(4, Math.min(r0.left, wW - dW - 4));
            var spB = wH - r0.bottom - 6, spA = r0.top - 6;
            var above = spB < 200 && spA > spB;
            list.style.cssText =
              'position:fixed!important;' +
              'left:' + lft + 'px;' +
              'right:auto;' +
              (above
                ? 'bottom:' + (wH - r0.top + 4) + 'px;top:auto;'
                : 'top:' + (r0.bottom + 4) + 'px;bottom:auto;') +
              'width:' + dW + 'px;' +
              'min-width:0;' +
              'z-index:2147483647;' +
              'background:' + t.bg + ';' +
              'border:1.5px solid ' + t.bdr + ';' +
              'border-radius:12px;' +
              'box-shadow:0 10px 40px rgba(0,0,0,.18);' +
              'display:flex!important;flex-direction:column;' +
              'max-height:300px;overflow:hidden';
            document.body.appendChild(list);
            list.classList.add('ss-open');
            inp.classList.add('ss-open');
            _ssPortal = list;
            _ssActiveWrap = w;
            var arr = w.querySelector('.ss-arr');
            if (arr) arr.style.transform = 'translateY(-50%) rotate(180deg)';
            var si = list.querySelector('.ss-si');
            if (si) {si.value = ''; filter(list, ''); setTimeout(function () {si.focus();}, 60);}
            // Reposition on scroll/resize
            var fn = function () {_ssPosition(list, w);};
            list._ssScrollFn = fn;
            window.addEventListener('scroll', fn, true);
            window.addEventListener('resize', fn, true);
          }
          e.stopPropagation(); return;
        }

        var opt = e.target.closest('.ss-opt');
        if (opt) {
          // Find the wrap — either via portal parent tracking or DOM
          var w2 = _ssActiveWrap;
          if (!w2) {var l2 = opt.closest('.ss-list'); w2 = l2 && l2.closest('.ss-wrap');}
          if (!w2) return;
          var id2 = w2.getAttribute('data-id');
          var val = opt.getAttribute('data-v');
          var lbl = opt.textContent.trim();
          var d = document.getElementById('ssd_' + id2);
          if (d) d.value = lbl;
          if (_ssPortal) _ssPortal.querySelectorAll('.ss-opt').forEach(function (o) {o.classList.toggle('ss-hl', o === opt);});
          closePortal();
          // Update hidden select / fire callbacks
          var cb = w2.getAttribute('data-cb');
          var selRef = w2.getAttribute('data-selref');
          var cbi = w2.getAttribute('data-cbi');
          if (cb) {
            var hid = document.getElementById(id2);
            if (hid && hid.type === 'hidden') hid.value = val;
            try {window[cb]();} catch (ex) { }
          }
          if (selRef) {
            var origSel = document.getElementById(selRef);
            if (origSel && origSel.tagName === 'SELECT') {
              origSel.value = val;
              try {origSel.dispatchEvent(new Event('change'));} catch (ex) { }
            } else if (origSel && origSel.type === 'hidden') {
              origSel.value = val;
            }
          }
          if (cbi && !cb && !selRef) {try {(new Function(cbi))();} catch (ex) { } }
          e.stopPropagation(); return;
        }

        // Click outside — close
        if (!e.target.closest('.ss-wrap') && !e.target.closest('.ss-list')) {
          closePortal();
        }
      });

      document.addEventListener('input', function (e) {
        if (e.target.matches('.ss-si')) {
          var list = _ssPortal || e.target.closest('.ss-list');
          if (list) filter(list, e.target.value);
        }
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closePortal();
      });
    })();


    /* ══════════════════════════════════════════════════════════
       TOAST NOTIFICATION
    ══════════════════════════════════════════════════════════ */
    var _toastTimer = null;

    /* ══════════════════════════════════════════════════════════
       MODAL SYSTEM
    ══════════════════════════════════════════════════════════ */
    var _modalCb = null;

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        _closeModal();
        _closeGS();
        var np = document.getElementById('ntfPanel');
        if (np && np.classList.contains('on')) np.classList.remove('on');
      }
    });

    /* ══════════════════════════════════════════════════════════
       SIGN-OUT DIALOG
    ══════════════════════════════════════════════════════════ */
    function _soShow() {
      try {
        var sbNm = document.getElementById('sbName');
        var sbRl = document.getElementById('sbRole');
        var nm = (_U && _U.name && _U.name !== 'User' && _U.name !== 'Staff' && _U.name.trim() !== '') ? _U.name : (sbNm && sbNm.textContent && sbNm.textContent !== 'Joolry Staff' ? sbNm.textContent : '');
        var rl = (_U && _U.role) ? (_U.role + ' · ' + (_U.dept || '')) : (sbRl && sbRl.textContent ? sbRl.textContent : 'Staff');
        if (!nm || nm.trim() === '') nm = 'Staff Member';
        var n = document.getElementById('soUserName'), r = document.getElementById('soUserDept');
        if (n) n.textContent = nm; if (r) r.textContent = rl;
      } catch (e) { }
      var soEl = document.getElementById('soOv');
      soEl.style.display = ''; // reset inline style set by _signOut
      soEl.classList.add('on');
      document.body.style.overflow = 'hidden';
    }
    function _soHide() {
      var soEl = document.getElementById('soOv');
      soEl.classList.remove('on');
      soEl.style.display = 'none';
      document.body.style.overflow = '';
    }
    function _signOut() {
      try {_rcClear(true); _clearSession(); localStorage.removeItem('joolry_session_v1'); sessionStorage.clear();} catch (e) { }
      _U = null; _TOKEN = null;
      window._fkLoaded = false;
      document.documentElement.classList.remove('has-session');
      try {
        if (window._autoRefreshTimer) clearInterval(window._autoRefreshTimer);
        if (window._refreshTimer) clearInterval(window._refreshTimer);
        if (window._fkTipTimer) {clearInterval(window._fkTipTimer); window._fkTipTimer = null;}
        // Remove any floating badges
        var badges = ['fkBgSync', 'fkBgRefresh', 'fkInstallBar', '_fkLoadScreen'];
        badges.forEach(function (id) {var el = document.getElementById(id); if (el) el.remove();});
        // Remove tip element
        var tip = document.getElementById('_fkTip'); if (tip) tip.remove();
      } catch (e) { }
      var sApp = document.getElementById('sApp'), sLogin = document.getElementById('sLogin'), soOv = document.getElementById('soOv');
      if (soOv) {soOv.classList.remove('on'); soOv.style.display = 'none';}
      document.body.style.overflow = '';
      if (sApp) {
        sApp.classList.remove('on');
        // Clear content area so no stale UI shows next login
        var ct = document.getElementById('content'); if (ct) ct.innerHTML = '';
      }
      if (sLogin) {sLogin.classList.remove('pre-hidden'); sLogin.classList.add('on'); sLogin.style.display = '';}
      var mn = document.getElementById('mobNav'); if (mn) mn.style.display = 'none';
      // Reset sidebar to defaults for next login
      try {
        var sbn = document.getElementById('sbName'), sbr = document.getElementById('sbRole'), sbi = document.getElementById('sbAvaInitials');
        if (sbn) sbn.textContent = 'Joolry Staff'; if (sbr) sbr.textContent = 'Staff'; if (sbi) sbi.textContent = '?';
      } catch (e) { }
      setTimeout(function () {
        var em = document.getElementById('femail'), pw = document.getElementById('fpass'), er = document.getElementById('loginErr');
        if (em) em.value = ''; if (pw) pw.value = ''; if (er) {er.textContent = ''; er.classList.remove('on');}
        if (em) em.focus();
      }, 100);
    }

    /* ══════════════════════════════════════════════════════════
       SIDEBAR MOBILE
    ══════════════════════════════════════════════════════════ */
    function _sbOverlays(on) {
      ['mobOv', 'sbOverlay'].forEach(function (id) {
        var el = document.getElementById(id);
        if (!el) return;
        if (on) el.classList.add('on');
        else el.classList.remove('on');
      });
    }

    function _openSb() {
      var sb = document.getElementById('sb');
      if (!sb) return;
      sb.classList.add('mob-open');
      _sbOverlays(true);
      document.body.style.overflow = 'hidden';
    }
    function _sbClose() { _closeSb(); }
    function _closeSb() {
      var sb = document.getElementById('sb');
      if (sb) sb.classList.remove('mob-open');
      _sbOverlays(false);
      document.body.style.overflow = '';
    }
    // Unified toggle used by ham button (mobile drawer)
    function _mobToggleSb() {
      var sb = document.getElementById('sb');
      if (!sb) return;
      if (sb.classList.contains('mob-open')) _closeSb();
      else _openSb();
    }

    // Desktop: collapse / expand icon rail
    function _syncSbChrome(collapsed) {
      var ico = document.getElementById('sbToggleIco');
      if (ico) ico.className = collapsed ? 'fas fa-angles-right' : 'fas fa-angles-left';
      var btn = document.getElementById('sbToggle');
      if (btn) btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      // Inline width backup so expand always wins over conflicting CSS
      var sb = document.getElementById('sb');
      if (sb) {
        if (collapsed) {
          sb.style.setProperty('width', '72px', 'important');
          sb.style.setProperty('min-width', '72px', 'important');
          sb.style.setProperty('max-width', '72px', 'important');
        } else {
          sb.style.removeProperty('width');
          sb.style.removeProperty('min-width');
          sb.style.removeProperty('max-width');
        }
      }
    }

    function _toggleSbCollapse() {
      var app = document.getElementById('sApp');
      if (!app) return;
      // On mobile drawer mode, use open/close instead
      if (window.matchMedia('(max-width: 767px)').matches) {
        _mobToggleSb();
        return;
      }
      app.classList.toggle('sb-collapsed');
      var collapsed = app.classList.contains('sb-collapsed');
      try { localStorage.setItem('fk_sb_collapsed', collapsed ? '1' : '0'); } catch (e) { }
      _syncSbChrome(collapsed);
    }

    function _applySbCollapseState() {
      var app = document.getElementById('sApp');
      if (!app) return;
      // Never start collapsed on mobile
      if (window.matchMedia('(max-width: 767px)').matches) {
        app.classList.remove('sb-collapsed');
        _closeSb();
        var sbM = document.getElementById('sb');
        if (sbM) {
          sbM.style.removeProperty('width');
          sbM.style.removeProperty('min-width');
          sbM.style.removeProperty('max-width');
        }
        return;
      }
      var collapsed = false;
      try { collapsed = localStorage.getItem('fk_sb_collapsed') === '1'; } catch (e) { }
      if (collapsed) app.classList.add('sb-collapsed');
      else app.classList.remove('sb-collapsed');
      _syncSbChrome(collapsed);
    }

    /* ══════════════════════════════════════════════════════════
       DARK MODE
    ══════════════════════════════════════════════════════════ */
    (function _initDark() {
      if (localStorage.getItem('fk_dark') === '1') {
        _dark = true;
        document.body.classList.add('dark');
      }
    }());

    /* ══════════════════════════════════════════════════════════
       GAS BRIDGE — fetch POST
       JSONP was failing: /exec redirects to echo endpoint (302)
       fetch POST works correctly with GAS doPost
    ══════════════════════════════════════════════════════════ */
    // GAS_URL appconfig.js se aa raha hai — wahan change karo
    var GAS_URL = window.GAS_URL || '';
    var _TOKEN = '';

    var _gasActive = 0; // count of concurrent GAS calls in flight

    function _lbShow() {
      _gasActive++;
      var b = document.getElementById('fkLb');
      if (b) b.style.opacity = '1';
      var c = document.getElementById('fkBusyChip');
      if (c) {
        c.style.opacity = '1';
        c.style.transform = 'translateX(-50%) translateY(0)';
      }
    }
    function _lbHide() {
      _gasActive = Math.max(0, _gasActive - 1);
      if (!_gasActive) {
        var b = document.getElementById('fkLb');
        if (b) b.style.opacity = '0';
        var c = document.getElementById('fkBusyChip');
        if (c) {
          c.style.opacity = '0';
          c.style.transform = 'translateX(-50%) translateY(-120%)';
        }
      }
    }

    // ── RPC bridge → Vercel /api/rpc (same-origin, signed session token, no secrets in browser) ──
    // Reads (get*/validate*) are retried once on network failure. Writes are NEVER auto-retried
    // (a retry could create duplicate check-ins / tasks / payroll rows).
    // ── Browser read-cache: repeat navigation costs 0 network calls. Writes clear it. ──
    // STATIC = survives reload (localStorage). DYN = this tab only, short TTL. Key includes the user's email.
    var _RC_STATIC = {getAllAppConfigForFrontend: 600, getHolidayList: 600, getTodayCelebrations: 600, getDoerList: 300, getEmployeeDirectory: 300};
    var _RC_DYN = {getAnnouncements: 60, getAllData: 20, getBootData: 20, getDashboardStats: 20, getTodayTasks: 20, getWeeklyTasks: 20,
      getDeptTasks: 20, getTaskHistory: 30, getMyDelegations: 20, getMyDelegatedOut: 20, getAllDelegations: 20, getLeaveBalance: 30,
      getLeaveSummary: 30, getMusterGrid: 30, getMusterReport: 30, getEMDashboard: 30, getChecklistAnalyticsV2: 60,
      getDelegationAnalyticsV2: 60, getAttendanceAnalyticsV2: 60, getAnalyticsSummaryV2: 60, getTopPerformers: 60, getPerformanceReport: 60};
    var _RC_MEM = {};
    function _rcKey(fn, args) {return 'jc:' + ((_U && _U.email) || '') + ':' + fn + ':' + JSON.stringify(args || []);}
    function _rcGet(fn, args) {
      var ttl = _RC_STATIC[fn] || _RC_DYN[fn]; if (!ttl) return null;
      var k = _rcKey(fn, args), e = _RC_MEM[k];
      if (!e && _RC_STATIC[fn]) {try {e = JSON.parse(localStorage.getItem(k) || 'null'); if (e) _RC_MEM[k] = e;} catch (x) { }}
      return (e && Date.now() - e.t < ttl * 1000) ? e.j : null;
    }
    function _rcPut(fn, args, data) {
      if (!(_RC_STATIC[fn] || _RC_DYN[fn])) return;
      try {
        var j = JSON.stringify(data); if (j.length > 400000) return;
        var k = _rcKey(fn, args), e = {t: Date.now(), j: j}; _RC_MEM[k] = e;
        if (_RC_STATIC[fn]) localStorage.setItem(k, JSON.stringify(e));
      } catch (x) { }
    }
    function _rcClear(all) {
      for (var k in _RC_MEM) {var f = k.split(':')[2]; if (all || !_RC_STATIC[f]) delete _RC_MEM[k];}
      if (all) try {Object.keys(localStorage).forEach(function (k) {if (k.indexOf('jc:') === 0) localStorage.removeItem(k);});} catch (x) { }
    }
    function _rpc(fn, args, timeout, onOk, onErr, tryNo) {
      var _hit = _rcGet(fn, args);
      if (_hit !== null && onOk) {setTimeout(function () {onOk(JSON.parse(_hit));}, 0); return;}
      var _isW = !/^(get|validate)/.test(fn) && fn !== 'serverUptime';
      if (_isW) _rcClear(false);
      _lbShow();
      var isRead = /^(get|validate)/.test(fn) || fn === 'serverUptime';
      var ctl = ('AbortController' in window) ? new AbortController() : null;
      var tm = setTimeout(function () {if (ctl) ctl.abort();}, timeout || 55000);
      var fail = function (msg) {
        if (isRead && !tryNo) {return setTimeout(function () {_rpc(fn, args, timeout, onOk, onErr, 1);}, 800);}
        if (onErr) onErr({message: msg});
        else _toast(msg, 'err');
      };
      fetch('/api/rpc', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (_TOKEN || '')},
        body: JSON.stringify({fn: fn, args: (args || []).concat([_U])}),
        signal: ctl ? ctl.signal : undefined
      }).then(function (r) {return r.json();}).then(function (data) {
        clearTimeout(tm); _lbHide();
        if (data && data.error === 'NOT_AUTHENTICATED') {
          try {localStorage.removeItem('joolry_session_v1');} catch (e) { }
          location.reload(); return;
        }
        if (data && data.success === false && data.error) {
          if (onErr) onErr({message: data.error}); else _toast('Error: ' + data.error, 'err');
        } else {
          if (_isW) _rcClear(false); else _rcPut(fn, args, data);
          if (onOk) onOk(data);
        }
      }).catch(function () {
        clearTimeout(tm); _lbHide();
        fail(isRead ? 'Network error. Check connection.' : 'Network error. Pehle check kar lo ki entry save hui ya nahi (Refresh), phir dobara karo.');
      });
    }
    function _gas(fn, args, onOk, onErr) {_rpc(fn, args, 55000, onOk, onErr, 0);}
    // Custom timeout version
    function _gasX(fn, args, timeout, onOk, onErr) {_rpc(fn, args, timeout || 15000, onOk, onErr, 1);}

    /* ══════════════════════════════════════════════════════════
       CSV EXPORT
    ══════════════════════════════════════════════════════════ */

    /* ══════════════════════════════════════════════════════════
       NOTIFICATION CENTER
    ══════════════════════════════════════════════════════════ */
    function _addNtf(text, ico, bgColor, textColor, link) {
      _ntfs.unshift({
        id: Date.now(),
        text: text,
        ico: ico || 'fa-bell',
        bg: bgColor || 'var(--Pl)',
        c: textColor || 'var(--P)',
        time: 'Just now',
        ts: new Date(),
        unread: true,
        link: link || null
      });
      _ntfU++;
      _refreshNtfUI();
    }
    function _refreshNtfUI() {
      var dot = document.getElementById('ntfDot');
      var cnt = document.getElementById('ntfCnt');
      if (dot) dot.style.display = _ntfU > 0 ? '' : 'none';
      if (cnt) {cnt.textContent = _ntfU > 0 ? _ntfU : ''; cnt.style.display = _ntfU > 0 ? '' : 'none';}
      _renderNtfList();
    }
    function _ntfClick(id) {
      var n = _ntfs.find(function (x) {return x.id === id;});
      if (n) {
        n.unread = false;
        _ntfU = Math.max(0, _ntfU - 1);
        _refreshNtfUI();
        if (n.link) _loadV(n.link);
      }
    }
    function _toggleNtf() {
      var panel = document.getElementById('ntfPanel');
      panel.classList.toggle('on');
      if (panel.classList.contains('on')) {
        _markAllRead();
      }
    }
    // Close notification panel when clicking outside
    document.addEventListener('click', function (e) {
      var panel = document.getElementById('ntfPanel');
      var btn = document.getElementById('ntfBtn');
      if (!panel || !btn) return;
      if (panel.classList.contains('on') &&
        !panel.contains(e.target) &&
        !btn.contains(e.target)) {
        panel.classList.remove('on');
      }
    });

    /* ══════════════════════════════════════════════════════════
       GLOBAL SEARCH
    ══════════════════════════════════════════════════════════ */
    var _navRoutes = [
      {title: 'Dashboard', route: 'dash', ico: 'fa-chart-pie', meta: 'Home overview', cat: 'Navigation', mgr: false},
      {title: 'Announcements', route: 'ann', ico: 'fa-bullhorn', meta: 'Company news & updates', cat: 'Navigation', mgr: false},
      {title: 'Checklist', route: 'check', ico: 'fa-list-check', meta: 'Daily task management', cat: 'Navigation', mgr: false},
      {title: 'Delegation', route: 'deleg', ico: 'fa-people-arrows', meta: 'Task assignments', cat: 'Navigation', mgr: false},
      {title: 'Attendance', route: 'attend', ico: 'fa-calendar-check', meta: 'Punch records & team attendance', cat: 'Navigation', mgr: false},
      {title: 'My Profile', route: 'profile', ico: 'fa-circle-user', meta: 'Profile & password', cat: 'Navigation', mgr: false},
      {title: 'EM Dashboard', route: 'em', ico: 'fa-table-cells-large', meta: 'Checklist + Delegation + Attendance — all doers in one view', cat: 'Manager', mgr: true},
      {title: 'Employee Directory', route: 'empdir', ico: 'fa-address-book', meta: 'Team member profiles', cat: 'Manager', mgr: true},
      {title: 'Checklist Analytics', route: 'clana', ico: 'fa-list-check', meta: 'Task completion, frequency breakdown, top performers', cat: 'Manager', mgr: true},
      {title: 'Delegation Analytics', route: 'delana', ico: 'fa-diagram-project', meta: 'Delegation stats', cat: 'Manager', mgr: true},
      {title: 'Attendance Analytics', route: 'attana', ico: 'fa-user-clock', meta: 'Attendance reporting', cat: 'Manager', mgr: true},
      {title: 'Muster Report', route: 'muster', ico: 'fa-id-card-clip', meta: 'Monthly attendance muster', cat: 'Manager', mgr: true},
      {title: 'Salary Sheet', route: 'payroll', ico: 'fa-indian-rupee-sign', meta: 'Attendance-based salary with IN/OUT timing', cat: 'Manager', mgr: true}
    ];
    function _openGS() {
      var ov = document.getElementById('gsOv');
      if (!ov) return;
      ov.classList.add('on');
      setTimeout(function () {
        var inp = document.getElementById('gsInput');
        if (inp) {inp.value = ''; inp.focus();}
        _gsFocused = -1;
        if (typeof _buildSearchIndex === 'function') _buildSearchIndex();
        _renderGSResults([]);
      }, 50);
    }
    function _closeGS() {
      var ov = document.getElementById('gsOv');
      if (ov) ov.classList.remove('on');
      _gsList = []; _gsFocused = -1;
    }
    function _gsSearch(q) {
      clearTimeout(_gsTimer);
      _gsTimer = setTimeout(function () {
        q = String(q || '').trim().toLowerCase();
        if (!q) {_renderGSResults([]); return;}
        var results = (_searchIdx || []).filter(function (item) {
          return (item.title + ' ' + (item.meta || '')).toLowerCase().indexOf(q) > -1;
        }).slice(0, 12);
        _gsList = results;
        _gsFocused = -1;
        _renderGSResults(results, q);
      }, 100);
    }
    function _renderGSResults(items, q) {
      var el = document.getElementById('gsResults');
      if (!el) return;
      if (!items || !items.length) {
        el.innerHTML = q
          ? '<div class="gs-empty"><i class="fas fa-search"></i>No results for "<strong>' + _esc(q) + '</strong>"</div>'
          : '<div class="gs-empty"><i class="fas fa-search"></i>Start typing to search…</div>';
        return;
      }
      var typeLabels = {nav: 'Page', emp: 'Employee', ann: 'Announcement'};
      el.innerHTML = items.map(function (item, i) {
        return '<div class="gs-item" data-idx="' + i + '" onclick="_gsSelect(' + i + ')" ' +
          'onmouseover="_gsHover(' + i + ')">' +
          '<div class="gs-ico" style="background:' + (item.bg || 'var(--Pl)') + ';color:' + (item.c || 'var(--P)') + '">' +
          '<i class="fas ' + (item.ico || 'fa-circle') + '"></i>' +
          '</div>' +
          '<div class="gs-info">' +
          '<div class="gs-item-title">' + (q ? _highlight(item.title, q) : _esc(item.title)) + '</div>' +
          (item.meta ? '<div class="gs-item-meta">' + _esc(item.meta.slice(0, 70)) + '</div>' : '') +
          '</div>' +
          '<div class="gs-type">' + (typeLabels[item.type] || item.type) + '</div>' +
          '</div>';
      }).join('');
    }
    function _gsHover(idx) {
      _gsFocused = idx;
      document.querySelectorAll('.gs-item').forEach(function (el, i) {
        el.classList.toggle('focused', i === idx);
        if (i === idx) el.scrollIntoView({block: 'nearest'});
      });
    }
    function _gsSelect(idx) {
      var item = _gsList[idx];
      if (!item) return;
      _closeGS();
      if (item.route) {_loadV(item.route); return;}
      if (item.empId) {_loadEmpDetail(item.empId); return;}
      if (item.action) {item.action();}
    }
    function _gsKey(e) {
      var max = _gsList.length;
      if (!max) return;
      if (e.key === 'ArrowDown') {e.preventDefault(); _gsHover((_gsFocused + 1) % max);}
      else if (e.key === 'ArrowUp') {e.preventDefault(); _gsHover((_gsFocused - 1 + max) % max);}
      else if (e.key === 'Enter') {e.preventDefault(); if (_gsFocused >= 0) _gsSelect(_gsFocused); else if (max > 0) _gsSelect(0);}
      else if (e.key === 'Escape') {_closeGS();}
    }
    // Keyboard shortcut ⌘K / Ctrl+K
    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {e.preventDefault(); _openGS();}
    });

    /* ══════════════════════════════════════════════════════════
       LOGIN
    ══════════════════════════════════════════════════════════ */
    function _doLogin() {
      var email = document.getElementById('femail').value.trim();
      var pass = document.getElementById('fpass').value.trim();
      var errEl = document.getElementById('loginErr');
      errEl.classList.remove('on'); errEl.textContent = '';
      if (!email) {errEl.textContent = 'Please enter your email address'; errEl.classList.add('on'); return;}
      if (!pass) {errEl.textContent = 'Please enter your password'; errEl.classList.add('on'); return;}

      var btn = document.getElementById('btnLogin');
      btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Signing in...';
      btn.style.opacity = '.65'; btn.style.pointerEvents = 'none';

      fetch('/api/rpc', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({fn: 'processLogin', args: [email, pass]})})
        .then(function (r) {return r.json();})
        .then(function (r) {
          btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
          btn.style.opacity = '1'; btn.style.pointerEvents = 'auto';
          if (r && r.success && r.user) {
            _U = r.user;
            // Update sidebar display with real user name (was showing 'User' during load)
            try {
              var sbName = document.getElementById('sbName');
              var sbRole = document.getElementById('sbRole');
              var sbAva = document.getElementById('sbAva');
              if (sbName && _U.name) sbName.textContent = _U.name;
              if (sbRole && _U.role) sbRole.textContent = (_U.role || 'STAFF') + ' · ' + (_U.dept || '');
              if (sbAva && _U.name) {
                var ini = _initials ? _initials(_U.name) : _U.name.charAt(0);
                if (_U.photo) {sbAva.innerHTML = '<img src="' + _U.photo + '" style="border-radius:50%;width:100%;height:100%;object-fit:cover" alt="">';} else if (ini) {sbAva.innerHTML = ini;}
                else sbAva.innerHTML = ini;
              }
            } catch (e2) { }
            _TOKEN = r.token || '';
            // Save session so page refresh doesn't log out
            _saveSession(_U, _TOKEN);
            _bootApp();
          } else {
            errEl.textContent = (r && r.error) || 'Invalid email or password';
            errEl.classList.add('on');
          }
        })
        .catch(function (e) {
          btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
          btn.style.opacity = '1'; btn.style.pointerEvents = 'auto';
          errEl.textContent = 'Network error. Check connection.';
          errEl.classList.add('on');
        });
    }

    /* ══════════════════════════════════════════════════════════
       APP BOOTSTRAP
    ══════════════════════════════════════════════════════════ */

    function _safeU() {
      _U = (_U && typeof _U === 'object') ? _U : {};
      if (!_U['name'] || _U['name'] === 'User' || _U['name'] === 'Staff') _U['name'] = _U['full_name'] || _U['Name'] || '';
      if (!_U['emp_code']) _U['emp_code'] = ''; if (!_U['email']) _U['email'] = '';
      if (!_U['role']) _U['role'] = 'STAFF'; if (!_U['dept']) _U['dept'] = ''; if (!_U['photo']) _U['photo'] = '';
      if (_U['need_attendance'] === undefined) _U['need_attendance'] = true;
      if (_U['need_location'] === undefined) _U['need_location'] = true;
      return _U;
    }


    window._fkBootFailed = false;
    window._fkLoaded = true;
    if (window._fkSplashHardTimer) {clearTimeout(window._fkSplashHardTimer); window._fkSplashHardTimer = null;}


    window._fkLoaded = false;
    window._fkBootFailed = false;


    function _bootApp() {
      _safeU();
      // Clear any leftover timers from a previous failed boot
      if (window._fkSplashHardTimer) {clearTimeout(window._fkSplashHardTimer); window._fkSplashHardTimer = null;}
      if (window._fkTipTimer) {clearInterval(window._fkTipTimer); window._fkTipTimer = null;}

      // Switch screens
      var _sL = document.getElementById('sLogin'), _sA = document.getElementById('sApp');
      if (_sL) {_sL.classList.remove('on'); _sL.style.display = 'none';}
      if (_sA) _sA.classList.add('on');
      document.documentElement.classList.remove('has-session');
      window._fkLoaded = false;

      var _mn = document.getElementById('mobNav');
      if (_mn) _mn.style.display = '';

      // Immediate skeleton so user sees activity
      var c0 = document.getElementById('content');
      if (c0 && typeof _skelKpi === 'function') {
        c0.innerHTML = _skelKpi(4) + _skel(3);
      }

      // Show splash
      var splash = document.getElementById('fkSplash');
      if (splash) {
        splash.style.display = 'flex';
        splash.style.animation = '';
      }

      // Cycle splash messages
      var msgs = ['Loading your workspace…', 'Fetching your tasks…', 'Almost there…'];
      var mi = 0;
      var msgEl = document.getElementById('fkSplashMsg');
      var splashMsgTimer = setInterval(function () {
        mi = (mi + 1) % msgs.length;
        if (msgEl) msgEl.textContent = msgs[mi];
      }, 1800);

      function _hideSplash() {
        clearInterval(splashMsgTimer);
        // Hard-timeout timer yahan CLEAR MAT karo (race fix)
        if (!splash) return;
        splash.style.animation = 'splashHide .35s cubic-bezier(.4,0,.2,1) forwards';
        setTimeout(function () {
          splash.style.display = 'none';
          // Soft tip only while still loading AND no error UI yet
          if (!window._fkLoaded && !window._fkBootFailed) {
            var ct = document.getElementById('content');
            if (!ct) return;
            if (ct.innerHTML.indexOf('Connection Error') > -1 ||
              ct.innerHTML.indexOf('Loading is taking longer') > -1) return;

            var tips = [
              'Daily KRA/KPI tasks Checklist mein track karo',
              'GPS se attendance punch karo',
              'Team ko tasks assign karo',
              'Analytics se performance dekho'
            ];
            var ti = 0;
            ct.innerHTML =
              '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:65vh;padding:24px;text-align:center">' +
              '<div style="position:relative;width:88px;height:88px;margin-bottom:22px">' +
              '<div style="position:absolute;inset:0;border-radius:50%;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.12)"></div>' +
              '<div style="position:absolute;inset:-5px;border-radius:50%;border:3.5px solid transparent;border-top-color:#111111;border-right-color:#B76E79;animation:fkLogoSpin .9s linear infinite"></div>' +
              '<img src="https://joolry.in/cdn/shop/files/Joolry_Logo_160x.png?v=1661766461" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:13px;border-radius:50%" onerror="this.style.display=\'none\'">' +
              '</div>' +
              '<div style="font-size:16px;font-weight:800;color:var(--tx);margin-bottom:6px">Loading your workspace...</div>' +
              '<div id="_fkTip" style="font-size:13px;color:var(--tx2);min-height:18px;transition:opacity .3s;padding:0 16px;line-height:1.5">' + tips[0] + '</div>' +
              '<div style="width:200px;height:3px;background:var(--bdr);border-radius:3px;overflow:hidden;margin-top:28px">' +
              '<div style="height:100%;width:45%;background:linear-gradient(90deg,var(--P),var(--Pd));border-radius:3px;animation:fkBarSlide 1.6s ease-in-out infinite"></div>' +
              '</div></div>';
            if (window._fkTipTimer) clearInterval(window._fkTipTimer);
            window._fkTipTimer = setInterval(function () {
              ti = (ti + 1) % tips.length;
              var el = document.getElementById('_fkTip');
              if (!el) {clearInterval(window._fkTipTimer); return;}
              el.style.opacity = '0';
              setTimeout(function () {el.textContent = tips[ti]; el.style.opacity = '1';}, 300);
            }, 2000);
          }
        }, 340);
      }

      window._fkSplashHardTimer = setTimeout(function () {
        if (window._fkLoaded) return;
        console.warn('[Joolry] Splash hard-timeout 32s — forcing retry UI');
        window._fkBootFailed = true;          // soft tip ko block karo
        if (window._fkTipTimer) {clearInterval(window._fkTipTimer); window._fkTipTimer = null;}

        // Splash hide WITHOUT triggering soft tip
        clearInterval(splashMsgTimer);
        if (splash) {
          splash.style.animation = 'none';
          splash.style.display = 'none';
        }

        var ct = document.getElementById('content');
        if (ct) {
          ct.innerHTML =
            '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:65vh;padding:24px;text-align:center">' +
            '<div style="font-size:48px;margin-bottom:16px">⏳</div>' +
            '<div style="font-size:18px;font-weight:900;color:var(--tx);margin-bottom:8px">Loading is taking longer</div>' +
            '<div style="font-size:13px;color:var(--tx2);line-height:1.6;margin-bottom:24px;max-width:300px">' +
            'Server respond nahi kar raha.<br>Internet check karo ya Retry dabao.</div>' +
            '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">' +
            '<button class="btn" style="min-height:48px;padding:0 28px;font-size:15px" onclick="window._fkBootFailed=false;_bootApp()">' +
            '<i class="fas fa-rotate-right"></i> Retry</button>' +
            '<button class="btn" style="min-height:48px;padding:0 22px;font-size:14px;background:var(--sur2);color:var(--tx2);border:1.5px solid var(--bdr)" onclick="_logout()">' +
            '<i class="fas fa-right-from-bracket"></i> Logout</button>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--tx3);margin-top:16px">GAS cold start kabhi 20–30s le sakta hai</div>' +
            '</div>';
        }
      }, 32000);

      // Sidebar avatar + name
      var _su = _safeU();
      var initials = _initials(_su.name);
      var avaEl = document.getElementById('sbAva');
      var initEl = document.getElementById('sbAvaInitials');
      if (_U.photo && avaEl) {
        avaEl.innerHTML = '<img src="' + _su.photo + '" alt="' + _esc(_su.name) + '" onerror="this.outerHTML=\'' + initials + '\'">' +
          '<div class="online-dot"></div>';
      } else {
        if (initEl) initEl.textContent = initials || '?';
      }
      var sbNEl = document.getElementById('sbName');
      var sbREl = document.getElementById('sbRole');
      if (sbNEl) sbNEl.textContent = _su.name || 'Staff';
      if (sbREl) sbREl.textContent = (_su.role || 'STAFF') + ' · ' + (_su.dept || '');

      var _mA = document.getElementById('mbn-attend'), _nA = document.getElementById('nv-attend');
      if (_su.need_attendance === false) {
        if (_mA) _mA.style.display = 'none';
        if (_nA) _nA.style.display = 'none';
      } else {
        if (_mA) _mA.style.display = '';
        if (_nA) _nA.style.display = '';
      }

      if (_isManager()) {
        var mgrNav = document.getElementById('mgrNav');
        if (mgrNav) mgrNav.style.display = '';
      }
      if (_dark) {
        var darkIco = document.getElementById('darkIco');
        if (darkIco) darkIco.className = 'fas fa-sun';
      }
      _applySbCollapseState();
      _bootNtfs();



      window._fkLoaded = false;
      window._fkBootFailed = false;

      // ── SWR: pehle cache se turant dikhao ──────────────────────────────
      var hadCache = _lcLoad();
      if (hadCache && _D.dashStats) {
        // Cache mila → splash jaldi hatao aur dashboard dikhao
        window._fkLoaded = true;
        if (window._fkSplashHardTimer) {
          clearTimeout(window._fkSplashHardTimer);
          window._fkSplashHardTimer = null;
        }
        _hideSplash();
        _loadV(window._pwaStartRoute || 'dash');
        window._pwaStartRoute = null;
        if (_updateMobNav) _updateMobNav('home');
        _startAutoRefresh();
        // Note: network call ab bhi background mein chalega
      }

      // ── Network call (always) ──────────────────────────────────────────
      _gasX('getBootData', [], 30000, function (d) {
        if (!d) {
          if (!hadCache) {
            _hideSplash();
            _showBootError('Empty response from server');
          }
          return;
        }

        if (d.dashStats) _D.dashStats = d.dashStats;
        if (d.todayAtt) _D.todayAtt = d.todayAtt;
        if (d.announcements) _D.announcements = d.announcements;
        if (d.myDelegations) _D.myDelegations = d.myDelegations;
        if (d.appConfig) {
          _D.appConfig = d.appConfig;
          if (d.appConfig.SESSION_HOURS) {
            try {
              localStorage.setItem('joolry_session_hours', String(parseInt(d.appConfig.SESSION_HOURS, 10) || 12));
            } catch (e) { }
          }
          if (_U && _TOKEN) _saveSession(_U, _TOKEN);
        }
        _D.lastFetch = Date.now();
        _lcSave();   // ← cache update

        var badge = document.getElementById('annBadge');
        if (badge && d.announcements && d.announcements.length > 0) {
          badge.textContent = d.announcements.length;
          badge.style.display = '';
        }

        // Agar pehle se cache se load ho chuka hai to sirf silent re-render
        if (hadCache && window._fkLoaded) {
          var cur = window._curView || 'dash';
          if (cur === 'dash') {
            _loadV('dash');          // soft refresh of current view
          }
        } else {
          // Pehli baar network se aaya
          window._fkBootFailed = false;
          window._fkLoaded = true;
          if (window._fkSplashHardTimer) {
            clearTimeout(window._fkSplashHardTimer);
            window._fkSplashHardTimer = null;
          }
          _hideSplash();
          _loadV(window._pwaStartRoute || 'dash');
          window._pwaStartRoute = null;
          if (_updateMobNav) _updateMobNav('home');
          _startAutoRefresh();
        }

        _bootLoadBackground();

      }, function (err) {
        // existing error / fallback logic yahan same rahega
        // bas ek cheez add karo:
        if (hadCache && window._fkLoaded) {
          // Cache se already chal raha hai → silent fail, user ko disturb mat karo
          return;
        }
        // baaki purana error handling...
        // Fallback: agar getBootData unknown ho (purana deploy) to light path try
        var msg = (err && err.message) ? err.message : '';
        if (msg.indexOf('Unknown action') > -1) {
          _gasX('getDashboardStatsFresh', [], 30000, function (d2) {
            if (!d2) {_hideSplash(); _showBootError('Empty response'); return;}
            if (d2.dashStats) _D.dashStats = d2.dashStats;
            if (d2.todayAtt) _D.todayAtt = d2.todayAtt;
            if (d2.announcements) _D.announcements = d2.announcements;
            if (d2.myDelegations) _D.myDelegations = d2.myDelegations;
            _D.lastFetch = Date.now();
            window._fkLoaded = true;
            window._fkBootFailed = false;
            if (window._fkSplashHardTimer) {
              clearTimeout(window._fkSplashHardTimer);
              window._fkSplashHardTimer = null;
            }
            _hideSplash();
            _loadV(window._pwaStartRoute || 'dash');
            window._pwaStartRoute = null;
            if (_updateMobNav) _updateMobNav('home');
            _startAutoRefresh();
            _bootLoadBackground();
          }, function (e2) {
            _hideSplash();
            _showBootError((e2 && e2.message) ? e2.message : 'Server se connect nahi ho pa raha');
          });
          return;
        }
        _hideSplash();
        _showBootError(msg || 'Server se connect nahi ho pa raha');
      });

    }

    /**
     * After fast boot, load remaining data in background.
     * Failures are silent — user already sees dashboard.
     */
    function _bootLoadBackground() {
      // 1) AppConfig (session hours, GPS flags, etc.)
      _gas('getAllAppConfigForFrontend', [], function (cfg) {
        if (!cfg) return;
        _D.appConfig = cfg;
        if (cfg.SESSION_HOURS) {
          try {
            localStorage.setItem('joolry_session_hours', String(parseInt(cfg.SESSION_HOURS, 10) || 12));
          } catch (e) { }
        }
        if (_U && _TOKEN) _saveSession(_U, _TOKEN);
      }, function () { });

      // 2) Today's checklist tasks
      _gas('getTodayTasks', [null, null], function (tasks) {
        if (tasks) {
          _D.todayTasks = tasks;
          _D._ckTodayKey = String((_U && _U.emp_code) || '') + '|' + _today();
        }
      }, function () { });

      // 3) Leave balance
      _gas('getLeaveBalance', [], function (lb) {
        if (lb) _D.leaveBalance = lb;
      }, function () { });

      // 4) Holidays (current year)
      _gas('getHolidayList', [new Date().getFullYear()], function (h) {
        if (h) _D.holidays = h;
      }, function () { });

      // 5) My attendance this month
      var ym = (new Date()).toISOString().slice(0, 7);
      _gas('getMyAttendance', [null, ym], function (att) {
        if (att) _D.myAttendance = att;
      }, function () { });

      // 6) Celebrations
      _gas('getTodayCelebrations', [], function (c) {
        if (c) _D.celebrations = c;
      }, function () { });

      // // 7) Manager-only: directory + analytics (delayed)
      // if (_isManager && _isManager()) {
      //   _gas('getEmployeeDirectory', [], function (dir) {
      //     if (dir) _D.empDir = dir;
      //   }, function () { });
      //   setTimeout(function () {
      //     _gas('getAnalyticsSummary', [null], function (s) {
      //       _D.analyticsSummary = s;
      //     }, function () { });
      //   }, 2500);
      // }
    }


    /** Shared retry / logout error screen used by timeout + hard-timeout */
    function _showBootError(msg) {

      window._fkBootFailed = true;
      if (window._fkTipTimer) {clearInterval(window._fkTipTimer); window._fkTipTimer = null;}
      if (window._fkSplashHardTimer) {clearTimeout(window._fkSplashHardTimer); window._fkSplashHardTimer = null;}

      var ct = document.getElementById('content');
      if (!ct) return;
      ct.innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:65vh;padding:24px;text-align:center">' +
        '<div style="font-size:48px;margin-bottom:16px">📡</div>' +
        '<div style="font-size:18px;font-weight:900;color:var(--tx);margin-bottom:8px">Connection Error</div>' +
        '<div style="font-size:13px;color:var(--tx2);line-height:1.6;margin-bottom:24px;max-width:300px">' +
        _esc(msg || 'Server se connect nahi ho pa raha.') + '<br>Internet check karo aur retry karo.</div>' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">' +
        '<button class="btn" style="min-height:48px;padding:0 28px;font-size:15px" onclick="_bootApp()">' +
        '<i class="fas fa-rotate-right"></i> Retry</button>' +
        '<button class="btn" style="min-height:48px;padding:0 22px;font-size:14px;background:var(--sur2);color:var(--tx2);border:1.5px solid var(--bdr)" onclick="_logout()">' +
        '<i class="fas fa-right-from-bracket"></i> Logout</button>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--tx3);margin-top:16px">GAS server cold start mein 20–30s lag sakta hai</div>' +
        '</div>';
      if (_updateMobNav) _updateMobNav('home');
    }


    function _bootNtfs() {
      var hr = new Date().getHours();
      var greet = hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening';
      _addNtf('Good ' + greet + ', ' + ((_U && _U.name ? _U.name.split(' ')[0] : '') || '') + '! Have a productive day.', 'fa-sun', 'var(--Ol)', 'var(--O)');
    }
    function _loadAnnBadge() {
      _gas('getAnnouncements', [], function (anns) {
        var badge = document.getElementById('annBadge');
        if (badge && anns && anns.length > 0) {
          badge.textContent = anns.length;
          badge.style.display = '';
        }
      });
    }

    /* ══════════════════════════════════════════════════════════
       VIEW ROUTER — single dispatcher (sidebar .nv, session, charts)
    ══════════════════════════════════════════════════════════ */
    function _loadV(view, subTab) {
      window._fkLoaded = true;
      if (window._fkTipTimer) {clearInterval(window._fkTipTimer); window._fkTipTimer = null;}
      _V = view; _ST = subTab || null; window._curView = view;
      _closeSb();
      var ct = document.getElementById('content'); if (ct) ct.scrollTop = 0;

      document.querySelectorAll('.nv').forEach(function (n) {n.classList.remove('on');});
      var nvEl = document.getElementById('nv-' + view);
      if (nvEl) nvEl.classList.add('on');

      var route = null;
      for (var ri = 0; ri < _navRoutes.length; ri++) {
        if (_navRoutes[ri].route === view) {route = _navRoutes[ri]; break;}
      }
      var title = route ? route.title : (view === 'empdetail' ? 'Employee Detail' : view);
      var tbTitleEl = document.getElementById('tbTitle');
      if (tbTitleEl) tbTitleEl.textContent = title;

      var tbCrumb = document.getElementById('tbDate');
      if (tbCrumb) {
        var shortD = new Date().toLocaleDateString('en-IN', {day: 'numeric', month: 'short', year: 'numeric'});
        tbCrumb.textContent = 'Portal / ' + title + ' · ' + shortD;
      }

      _saveNavState();

      Object.keys(_charts).forEach(function (k) {
        try {_charts[k].destroy();} catch (e) { }
      });
      _charts = {};

      var cont = document.getElementById('content');
      if (cont) {
        cont.scrollTop = 0;
        cont.innerHTML = _skelKpi(4) + _skel(3);
        // content always visible - no opacity tricks
      }

      var views = {
        dash: _vDash,
        feed: _vFeed,
        ann: _vAnn,
        check: _vCheck,
        deleg: _vDeleg,
        attend: _vAttend,
        leave: function(){ _loadV('attend'); },
        holcal: function(){ _loadV('dash'); },
        feed: function(){ _loadV('dash'); },
        profile: _vProfile,
        em: _vEM,
        empdir: _vEmpDir,
        clana: _vClAna,
        delana: _vDelAna,
        attana: _vAttAna,
        muster: _vMuster,
        payroll: _vPayroll
      };

      // IMPORTANT: ensure content is always visible
      if (cont) {cont.style.opacity = '1'; cont.style.visibility = 'visible';}

      if (views[view]) {
        views[view]();
      } else {
        if (cont) cont.innerHTML =
          '<div class="empty-state"><i class="fas fa-hammer"></i><h4>Coming Soon</h4><p>This section is under construction.</p></div>';
      }
      // Auto-convert all <select> elements rendered by this view to searchable dropdowns.
      // 50ms delay ensures the view function's innerHTML has been fully set first.
      setTimeout(function () {
        _initSearchSelects(document.getElementById('content'));
        _debouncedPostRender();
      }, 80);
    }

    // MutationObserver: fires _initSearchSelects whenever new <select> elements
    // appear anywhere in the content area — covers async loads (analytics tabs,
    // delegation lists, leave history, etc.) automatically.
    (function () {
      var observer = new MutationObserver(function (mutations) {
        var hasSelect = false;
        for (var i = 0; i < mutations.length; i++) {
          var nodes = mutations[i].addedNodes;
          for (var j = 0; j < nodes.length; j++) {
            var n = nodes[j];
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'SELECT' || (n.querySelector && n.querySelector('select'))) {
              hasSelect = true; break;
            }
          }
          if (hasSelect) break;
        }
        if (hasSelect) {
          // Debounce: wait for the full DOM update before scanning
          clearTimeout(observer._t);
          observer._t = setTimeout(function () {
            _initSearchSelects(document.getElementById('content'));
          }, 30);
        }
      });
      // Start observing once the content div exists (after login)
      function startObserver() {
        var ct = document.getElementById('content');
        if (ct) {
          observer.observe(ct, {childList: true, subtree: true});
        } else {
          setTimeout(startObserver, 500);
        }
      }
      startObserver();
    })();

    function _refresh() {
      _forceRefresh();
    }


    /* ══════════════════════════════════════════════════════════
       CHECK IN / CHECK OUT — Dashboard Punch Card
    ══════════════════════════════════════════════════════════ */
    var _punchState = 'not_checked_in'; // 'not_checked_in' | 'checked_in' | 'checked_out'

    // GPS gating state — checked proactively once the punch card loads, so
    // the button reflects reality (can I actually mark attendance right
    // now?) instead of only failing after the user taps it.
    // 'unchecked' = not yet determined (treated as BLOCKING, never as
    // permissive — we never assume GPS is fine just because we haven't
    // checked yet) | 'disabled' = AppConfig confirms GPS_ATTENDANCE is Off,
    // no gating needed | 'checking' = a check is in progress | 'ok' =
    // confirmed within a registered location | 'blocked' = GPS worked but
    // user is too far | 'error' = location unavailable/denied/unsupported.
    var _gpsState = 'unchecked';
    var _gpsMsg = '';
    var _gpsRetries = 0;

    // Best-effort attempt to jump straight to the device's location
    // settings. Only Android supports this (via an intent: URL — iOS and
    // desktop browsers have no equivalent and will simply ignore it, which
    // is why this is always paired with the guide modal below as the
    // reliable fallback rather than relying on this alone.
    function _tryOpenLocationSettings() {
      var ua = navigator.userAgent || '';
      if (/Android/i.test(ua)) {
        try {window.location.href = 'intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end';}
        catch (e) { }
      }
    }

    // Shows clear, platform-specific steps to turn location on, since most
    // browsers (iOS Safari, desktop) can't be sent straight to the OS
    // settings screen the way Android sometimes can. Only shows the
    // "enable permission" steps when permission was actually denied —
    // otherwise (location allowed, but the fix just failed/timed out) it
    // shows accurate troubleshooting instead of telling the user to redo
    // something they've already done.
    function _showLocationGuide() {
      if (_gpsErrCode !== 1) {
        _openModal(
          '<i class="fas fa-location-dot" style="color:var(--P)"></i> Couldn\'t Get Your Location',
          '<div style="font-size:13px;color:var(--tx2);margin-bottom:10px">Location permission looks fine — the device just couldn\'t get a location fix this time. This is common on desktops/laptops without GPS. Try:</div>' +
          '<ol style="margin:0;padding-left:20px;line-height:1.9;font-size:13.5px">' +
          '<li>Make sure you\'re connected to WiFi or mobile internet</li>' +
          '<li>If on a desktop/laptop, try using your phone instead — it has GPS</li>' +
          '<li>Move near a window or step outside, then tap <b>Retry</b> below</li>' +
          '</ol>',
          function () {_closeModal(); _initGpsGate();},
          '<i class="fas fa-rotate-right"></i> Retry'
        );
        return;
      }

      _tryOpenLocationSettings();
      var ua = navigator.userAgent || '';
      var steps;
      if (/Android/i.test(ua)) {
        steps = [
          'Swipe down from the top of your screen to open Quick Settings',
          'Tap and hold the <b>Location</b> icon (or tap the arrow next to it)',
          'Turn <b>Location</b> ON',
          'Come back here and tap <b>Retry</b> below'
        ];
      } else if (/iPhone|iPad|iPod/i.test(ua)) {
        steps = [
          'Open the <b>Settings</b> app',
          'Go to <b>Privacy &amp; Security → Location Services</b> and turn it ON',
          'Scroll down, find your browser (Safari/Chrome) and set it to <b>While Using the App</b>',
          'Come back here and tap <b>Retry</b> below'
        ];
      } else {
        steps = [
          'Click the location/lock icon in your browser\'s address bar',
          'Set <b>Location</b> permission to <b>Allow</b> for this site',
          'Reload the page and tap <b>Retry</b> below'
        ];
      }
      _openModal(
        '<i class="fas fa-location-dot" style="color:var(--P)"></i> Turn On Location',
        '<div style="font-size:13px;color:var(--tx2);margin-bottom:10px">Attendance can only be marked from a registered office location, so location access needs to be on.</div>' +
        '<ol style="margin:0;padding-left:20px;line-height:1.9;font-size:13.5px">' +
        steps.map(function (s) {return '<li>' + s + '</li>';}).join('') +
        '</ol>',
        function () {_closeModal(); _initGpsGate();},
        '<i class="fas fa-rotate-right"></i> Retry'
      );
    }

    var _gpsErrCode = null; // last geolocation error code, drives which guide (if any) makes sense

    function _initGpsGate() {
      // AppConfig loads asynchronously at login — if it hasn't arrived yet,
      // give the normal bulk load a short head start, then fetch it directly.
      if (!_D.appConfig) {
        _gpsState = 'checking'; _gpsMsg = 'Verifying location…';
        _applyGpsGate();
        if (_gpsRetries < 5) {
          _gpsRetries++; setTimeout(_initGpsGate, 300);
        } else {
          _gas('getAllAppConfigForFrontend', [], function (cfg) {
            _D.appConfig = cfg || {};
            _gpsRetries = 0;
            _initGpsGate();
          }, function () {
            // AppConfig failed — fall through to server-side validation.
            // Backend always re-checks GPS on check-in/out regardless.
            _gpsState = 'disabled'; _gpsMsg = '';
            _applyGpsGate();
            _toast('⚠️ Location settings unavailable. Server will validate.', 'warn');
          });
        }
        return;
      }
      _gpsRetries = 0;

      var gpsEnabled = (_D.appConfig.GPS_ATTENDANCE || '').toLowerCase() === 'yes';
      if (!gpsEnabled) {_gpsState = 'disabled'; _gpsMsg = ''; _applyGpsGate(); return;}

      _gpsState = 'checking'; _gpsMsg = 'Checking your location…';
      _applyGpsGate();

      if (!navigator.geolocation) {
        // Geolocation unavailable (unsupported browser, or iframe without
        // allow="geolocation" — e.g. Google Sites embedding). Don't block.
        _gpsState = 'disabled'; _gpsMsg = '';
        _applyGpsGate();
        return;
      }

      // ── Cached-first GPS strategy ──────────────────────────────────────────
      // Most mobile devices have a recent GPS fix cached by Maps/other apps.
      // Trying cached first gives an instant result on the common path,
      // instead of the old approach (high-accuracy-first) which always waited
      // 12+ seconds even when a perfectly good cached fix was available.
      //
      // Stage 1: any cached position (no age limit), 2s timeout → instant
      // Stage 2: low-accuracy fresh (WiFi/cell), 10s timeout
      // Stage 3: high-accuracy fresh (GPS chip), 15s timeout  
      // Stage 4: server-side only validation (never block permanently)
      //
      // For already-checked-in users (about to check OUT), allow a 10-minute-
      // old cached position — we already validated at check-in so no need for
      // another fresh GPS fix.
      var isCheckingOut = (_punchState === 'checked_in');
      var cacheMaxAge = isCheckingOut ? 600000 : 0; // 10min for checkout, fresh for check-in

      function onPos(pos) {
        _gas('validateGpsForAttendance', [pos.coords.latitude, pos.coords.longitude], function (res) {
          if (res && res.allowed) {
            _gpsState = 'ok';
            _gpsMsg = res.nearest_location
              ? 'At ' + res.nearest_location + (res.distance_km ? ' (' + res.distance_km + ' away)' : '')
              : '';
          } else {
            _gpsState = 'blocked';
            _gpsMsg = (res && res.message) || 'You are not within a registered attendance location.';
          }
          _applyGpsGate();
        }, function () {
          // Server validation call failed (network blip) — don't hard-block.
          _gpsState = 'disabled'; _gpsMsg = '';
          _applyGpsGate();
          _toast('⚠️ Could not verify location. Server will validate.', 'warn');
        });
      }

      function permDenied() {
        _gpsState = 'error'; _gpsErrCode = 1;
        _gpsMsg = 'Location permission denied. Allow location access to mark attendance.';
        _applyGpsGate();
      }

      function allFailed() {
        // All stages failed — never leave user permanently blocked.
        _gpsState = 'disabled'; _gpsMsg = '';
        _applyGpsGate();
        _toast('⚠️ Could not get location. Server will validate at check-in.', 'warn');
      }

      // Stage 3: high-accuracy (GPS chip), 15s
      function tryStage3() {
        navigator.geolocation.getCurrentPosition(onPos, function (e3) {
          if (e3.code === 1) {permDenied(); return;}
          allFailed();
        }, {timeout: 15000, maximumAge: 0, enableHighAccuracy: true});
      }

      // Stage 2: low-accuracy (WiFi/cell), 10s, accept 30s-old cache
      function tryStage2() {
        navigator.geolocation.getCurrentPosition(onPos, function (e2) {
          if (e2.code === 1) {permDenied(); return;}
          tryStage3();
        }, {timeout: 10000, maximumAge: 30000, enableHighAccuracy: false});
      }

      // Stage 1: any cached position, 2s — instant on most devices
      navigator.geolocation.getCurrentPosition(onPos, function (e1) {
        if (e1.code === 1) {permDenied(); return;}
        // No usable cache — proceed to fresh attempts
        tryStage2();
      }, {timeout: 2000, maximumAge: isCheckingOut ? 600000 : 300000, enableHighAccuracy: false});
    }

    // Combines the GPS gate with the current punch state to decide the
    // button's final enabled/disabled state — this is the ONLY place that
    // sets btn.disabled for the not_checked_in/checked_in cases, so there's
    // a single source of truth instead of _renderPunchCard pre-enabling it
    // and this function "correcting" it after a delay.
    function _applyGpsGate() {
      var btn = document.getElementById('dashPunchBtn');
      var gpsEl = document.getElementById('dashPunchGps');
      if (!btn || !gpsEl) return;

      // Already checked out today — nothing left to gate, hide GPS message.
      if (_punchState === 'checked_out') {gpsEl.style.display = 'none'; return;}
      // Still figuring out check-in/check-out status — let that settle first.
      if (btn.innerHTML.indexOf('Checking...') !== -1) return;

      // NeedLocation = No → no GPS check, enable immediately
      if (_U && _U.need_location === false) {
        btn.disabled = false;
        gpsEl.style.display = 'none';
        return;
      }

      if (_gpsState === 'disabled') {
        btn.disabled = false;
        gpsEl.style.display = 'none';
        return;
      }
      if (_gpsState === 'ok') {
        btn.disabled = false;
        gpsEl.style.display = _gpsMsg ? '' : 'none';
        gpsEl.style.color = 'var(--G)';
        gpsEl.innerHTML = '<i class="fas fa-location-dot"></i> ' + _esc(_gpsMsg);
        return;
      }
      if (_gpsState === 'checking' || _gpsState === 'unchecked') {
        btn.disabled = true;
        gpsEl.style.display = '';
        gpsEl.style.color = 'var(--tx3)';
        gpsEl.innerHTML = '<i class="fas fa-location-crosshairs fa-beat"></i> ' + _esc(_gpsMsg || 'Verifying location…');
        return;
      }
      // 'blocked' or 'error' — hard-gate the button, this is the actual fix:
      // attendance can only be marked from a registered location, and any
      // uncertainty (denied permission, GPS off, network failure) blocks
      // by default rather than letting the action through.
      btn.disabled = true;
      gpsEl.style.display = '';
      gpsEl.style.color = 'var(--R)';
      var retryAction = _gpsState === 'error' ? '_showLocationGuide()' : '_initGpsGate()';
      gpsEl.innerHTML = '<i class="fas fa-location-dot"></i> Cannot mark attendance — ' + _esc(_gpsMsg) +
        ' <a href="#" onclick="' + retryAction + ';return false;" style="color:var(--P);font-weight:700">Retry</a>';
    }

    function _loadPunchStatus() {
      // Show cached data instantly if available (avoids a blank "Checking
      // status..." flash on mobile), but ALWAYS fetch fresh data right
      // after — attendance status/timing changes through the day, so
      // relying solely on the cached value showed stale info indefinitely
      // until the user manually reloaded.
      if (_D.todayAtt) {
        _punchState = _D.todayAtt.status || 'not_checked_in';
        _renderPunchCard(_D.todayAtt);
      } else {
        _punchState = 'not_checked_in';
        _renderPunchCard({status: 'not_checked_in'});
      }
      _gas('getTodayAttendanceStatus', [], function (res) {
        _D.todayAtt = res;
        _punchState = res.status || 'not_checked_in';
        _renderPunchCard(res);
      });
    }

    function _renderPunchCard(res) {
      var btn = document.getElementById('dashPunchBtn');
      var st = document.getElementById('dashPunchStatus');
      var tm = document.getElementById('dashPunchTimes');
      var gpsEl = document.getElementById('dashPunchGps');
      if (!btn || !st) return;

      var status = res.status || 'not_checked_in';

      // Show location-exempt badge for NeedLocation=No employees
      if (_U && _U.need_location === false && gpsEl) {
        gpsEl.style.display = '';
        gpsEl.style.color = 'var(--I)';
        gpsEl.innerHTML = '<i class="fas fa-location-dot-slash"></i> No location restriction — punch from anywhere';
      }

      // Format datetime for display: "16 May 2026, 04:25:08 PM"
      function _fmtAttTime(hhmm, fullTs) {
        // fullTs format: "16-05-2026 16:25:08"
        if (fullTs && fullTs.length >= 19) {
          var parts = fullTs.split(' ');
          if (parts.length === 2) {
            var dateParts = parts[0].split('-'); // dd-MM-yyyy
            var timePart = parts[1];            // HH:mm:ss
            var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            var mo = months[parseInt(dateParts[1], 10) - 1] || dateParts[1];
            return dateParts[0] + ' ' + mo + ' ' + dateParts[2] + ', ' + timePart + ' IST';
          }
        }
        return hhmm || '—';
      }

      if (status === 'not_checked_in') {
        st.innerHTML = '<span style="color:var(--tx3)"><i class="fas fa-circle-xmark"></i> Not Checked In Yet</span>';
        tm.innerHTML = '';
        btn.className = 'btn-checkin checkin-in';
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Check IN';

      } else if (status === 'checked_in') {
        st.innerHTML = '<span style="color:var(--G)"><i class="fas fa-circle-check"></i> Checked In</span>';
        tm.innerHTML = '<div class="att-punch-time-item"><i class="fas fa-sign-in-alt" style="color:var(--G)"></i>&nbsp;In:&nbsp;<b>' + _esc(_fmtAttTime(res.check_in, res.check_in_ts)) + '</b></div>';
        btn.className = 'btn-checkin checkin-out';
        btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Check OUT';

      } else if (status === 'checked_out') {
        st.innerHTML = '<span style="color:var(--P)"><i class="fas fa-circle-check"></i> Checked Out</span>';
        tm.innerHTML =
          '<div class="att-punch-time-item"><i class="fas fa-sign-in-alt" style="color:var(--G)"></i>&nbsp;In:&nbsp;<b>' + _esc(_fmtAttTime(res.check_in, res.check_in_ts)) + '</b></div>' +
          '<div class="att-punch-time-item"><i class="fas fa-sign-out-alt" style="color:var(--O)"></i>&nbsp;Out:&nbsp;<b>' + _esc(_fmtAttTime(res.check_out, res.check_out_ts)) + '</b></div>' +
          (res.total_hours && res.total_hours !== '-' ? '<div class="att-punch-time-item"><i class="fas fa-hourglass-end" style="color:var(--P)"></i>&nbsp;Total:&nbsp;<b>' + _esc(res.total_hours) + '</b></div>' : '');
        btn.className = 'btn-checkin checkin-done';
        btn.innerHTML = '<i class="fas fa-check-double"></i> Checked Out Today';
        btn.disabled = true;
      }

      _applyGpsGate();
    }

    // GPS-aware check-in call — payload can be {ts,lat,lng} or plain timestamp string
    function _doCheckInCall(btn, payload) {
      // Optimistic: turant UI update
      var nowStr = new Date().toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit', hour12: true});
      var prevState = _punchState;
      _punchState = 'checked_in';
      _renderPunchCard({
        status: 'checked_in',
        check_in: nowStr,
        check_in_ts: (typeof payload === 'object' ? payload.ts : payload) || new Date().toISOString()
      });
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving...';
      }

      _gas('recordCheckIn', [payload], function (res) {
        if (res && res.success) {
          _punchState = 'checked_in';
          _toast('✓ Checked in at ' + (res.check_in || nowStr), 'ok');
          _addNtf('Check IN at ' + (res.check_in || nowStr), 'fa-sign-in-alt', 'var(--Gl)', 'var(--G)');
          _renderPunchCard({
            status: 'checked_in',
            check_in: res.check_in || nowStr,
            check_in_ts: res.timestamp || ''
          });
          if (_D.todayAtt) {
            _D.todayAtt.status = 'checked_in';
            _D.todayAtt.check_in = res.check_in || nowStr;
          }
          _lcSave();
          _gpsState = 'unchecked';
          _initGpsGate();
        } else {
          // Rollback
          _punchState = prevState;
          var errMsg = (res && res.error) ? res.error : 'Unknown error';
          if (errMsg.indexOf('GPS_BLOCKED:') === 0) {
            errMsg = errMsg.replace('GPS_BLOCKED:', '');
            _toast('📍 ' + errMsg, 'err');
          } else {
            _toast('Check-in failed: ' + errMsg, 'err');
          }
          _loadPunchStatus(); // server se sahi state lao
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Check IN';
          }
        }
      }, function (e) {
        // Rollback on network error
        _punchState = prevState;
        var msg = (e && e.message) ? e.message : 'Network error';
        if (msg.indexOf('GPS_BLOCKED:') === 0) {
          _toast('📍 ' + msg.replace('GPS_BLOCKED:', ''), 'err');
        } else {
          _toast('Check-in failed: ' + msg, 'err');
        }
        _loadPunchStatus();
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Check IN';
        }
      });
    }

    function _doCheckOutCall(btn, payload) {
      // Optimistic
      var nowStr = new Date().toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit', hour12: true});
      var prevState = _punchState;
      var prevAtt = _D.todayAtt ? JSON.parse(JSON.stringify(_D.todayAtt)) : null;

      _punchState = 'checked_out';
      _renderPunchCard({
        status: 'checked_out',
        check_in: (_D.todayAtt && _D.todayAtt.check_in) || '',
        check_out: nowStr,
        check_out_ts: (typeof payload === 'object' ? payload.ts : payload) || new Date().toISOString(),
        total_hours: '…'
      });
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving...';
      }

      _gas('recordCheckOut', [payload], function (res) {
        if (res && res.success) {
          _punchState = 'checked_out';
          _toast('✓ Checked out at ' + (res.check_out || nowStr) + (res.total_hours ? ' · ' + res.total_hours : ''), 'ok');
          _addNtf('Check OUT at ' + (res.check_out || nowStr), 'fa-sign-out-alt', 'var(--Ol)', 'var(--O)');
          _renderPunchCard({
            status: 'checked_out',
            check_in: res.check_in || (_D.todayAtt && _D.todayAtt.check_in) || '',
            check_out: res.check_out || nowStr,
            check_in_ts: '',
            check_out_ts: res.timestamp || '',
            total_hours: res.total_hours || ''
          });
          if (_D.todayAtt) {
            _D.todayAtt.status = 'checked_out';
            _D.todayAtt.check_out = res.check_out || nowStr;
            _D.todayAtt.total_hours = res.total_hours || '';
          }
          _lcSave();
        } else {
          // Rollback
          _punchState = prevState;
          if (prevAtt) _D.todayAtt = prevAtt;
          var errMsg = (res && res.error) ? res.error : 'Unknown error';
          if (errMsg.indexOf('GPS_BLOCKED:') === 0) {
            errMsg = errMsg.replace('GPS_BLOCKED:', '');
            _toast('📍 ' + errMsg, 'err');
          } else {
            _toast('Check-out failed: ' + errMsg, 'err');
          }
          _loadPunchStatus();
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Check OUT';
          }
        }
      }, function (e) {
        _punchState = prevState;
        if (prevAtt) _D.todayAtt = prevAtt;
        var msg = (e && e.message) ? e.message : 'Network error';
        if (msg.indexOf('GPS_BLOCKED:') === 0) {
          _toast('📍 ' + msg.replace('GPS_BLOCKED:', ''), 'err');
        } else {
          _toast('Check-out failed: ' + msg, 'err');
        }
        _loadPunchStatus();
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Check OUT';
        }
      });
    }


    function _doPunch() {
      var btn = document.getElementById('dashPunchBtn');
      if (!btn) return;
      if (btn.innerHTML.indexOf('Processing') !== -1) return;

      var deviceTs = new Date().toISOString();

      if (_punchState === 'not_checked_in') {
        _withGpsLocation(btn, 'Check IN', 'fa-sign-in-alt', deviceTs, function (payload) {
          _doCheckInCall(btn, payload);
        });

      } else if (_punchState === 'checked_in') {
        _withGpsLocation(btn, 'Check OUT', 'fa-sign-out-alt', deviceTs, function (payload) {
          _doCheckOutCall(btn, payload);
        });
      }
    }

    // Shared GPS-fetch wrapper for both check-in and check-out — only calls
    // onReady() once we actually have a location (or GPS isn't required by
    // AppConfig or NeedLocation=No for this employee).
    function _withGpsLocation(btn, label, icon, deviceTs, onReady) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing...';

      // NeedLocation = No → skip GPS entirely, punch straight away
      if (_U && _U.need_location === false) {
        onReady(deviceTs);
        return;
      }

      var gpsEnabled = _D.appConfig && (_D.appConfig.GPS_ATTENDANCE || '').toLowerCase() === 'yes';
      if (!gpsEnabled) {onReady(deviceTs); return;}

      if (!navigator.geolocation) {
        // Geolocation unavailable (unsupported or iframe restriction) —
        // let server validate instead of blocking the user entirely.
        onReady(deviceTs);
        return;
      }

      btn.innerHTML = '<i class="fas fa-location-dot fa-beat"></i> Getting location...';

      var isCheckOut = (_punchState === 'checked_in');

      function gotPos(pos) {
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing...';
        onReady({ts: deviceTs, lat: pos.coords.latitude, lng: pos.coords.longitude});
      }

      function errFresh(err) {
        if (err.code === 1) {
          _toast('📍 Location permission denied. Please allow location access to ' + label.toLowerCase() + '.', 'err');
          btn.disabled = false; btn.innerHTML = '<i class="fas ' + icon + '"></i> ' + label;
          return;
        }
        // High-accuracy fresh failed too — proceed with server-side validation
        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Processing...';
        onReady(deviceTs);
      }

      function errLow(err) {
        if (err.code === 1) {
          _toast('📍 Location permission denied. Please allow location access to ' + label.toLowerCase() + '.', 'err');
          btn.disabled = false; btn.innerHTML = '<i class="fas ' + icon + '"></i> ' + label;
          return;
        }
        // Stage 3: high-accuracy fresh, 15s
        navigator.geolocation.getCurrentPosition(gotPos, errFresh,
          {timeout: 15000, maximumAge: 0, enableHighAccuracy: true});
      }

      // Stage 1: cached position — instant. For check-out allow 10min old cache.
      navigator.geolocation.getCurrentPosition(gotPos, function (e1) {
        if (e1.code === 1) {
          _toast('📍 Location permission denied. Please allow location access to ' + label.toLowerCase() + '.', 'err');
          btn.disabled = false; btn.innerHTML = '<i class="fas ' + icon + '"></i> ' + label;
          return;
        }
        // Stage 2: low-accuracy fresh, 10s
        navigator.geolocation.getCurrentPosition(gotPos, errLow,
          {timeout: 10000, maximumAge: 30000, enableHighAccuracy: false});
      }, {timeout: 2000, maximumAge: isCheckOut ? 600000 : 300000, enableHighAccuracy: false});
    }

    /* ══════════════════════════════════════════════════════════
       ██████  ██████  ███████ ██   ██ ██████   ██████   █████  ██████  ██████
       ██   ██ ██   ██ ██      ██   ██ ██   ██ ██    ██ ██   ██ ██   ██ ██   ██
       ██   ██ ██████  ███████ ███████ ██████  ██    ██ ███████ ██████  ██   ██
       ██   ██ ██   ██      ██ ██   ██ ██   ██ ██    ██ ██   ██ ██   ██ ██   ██
       ██████  ██████  ███████ ██   ██ ██████   ██████  ██   ██ ██   ██ ██████
    ══════════════════════════════════════════════════════════ */
    function _renderDashCelebrations() {
      var el = document.getElementById('dashCelebrations');
      if (!el) return;
      var cels = _D.celebrations || [];
      if (!cels.length) {el.style.display = 'none'; return;}
      el.style.display = '';
      el.innerHTML = '<div style="background:linear-gradient(135deg,#7c3aed22,#db277722);border:1.5px solid #7c3aed44;border-radius:18px;padding:14px 18px;display:flex;flex-wrap:wrap;gap:12px;align-items:center">' +
        '<div style="font-size:20px">🎊</div>' +
        '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:800;font-size:14px;color:var(--tx)">Today&#39;s Celebrations</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">' +
        cels.map(function (cel) {
          var yrs = cel.years > 0 ? ' · ' + cel.years + ' yr' + (cel.years > 1 ? 's' : '') : '';
          var color = cel.type === 'birthday' ? '#7c3aed' : '#0891b2';
          var bg = cel.type === 'birthday' ? '#7c3aed18' : '#0891b218';
          return '<div style="display:flex;align-items:center;gap:6px;background:' + bg + ';border:1px solid ' + color + '44;border-radius:10px;padding:5px 12px">' +
            '<span style="font-size:16px">' + cel.icon + '</span>' +
            '<div>' +
            '<div style="font-size:12px;font-weight:800;color:var(--tx)">' + _esc(cel.name) + '</div>' +
            '<div style="font-size:10px;color:' + color + ';font-weight:700">' + cel.label + yrs + '</div>' +
            '</div></div>';
        }).join('') +
        '</div></div></div>';
    }

    function _vDash() {
      var _su = _safeU();
      try {
        var hr = new Date().getHours();
        var greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
        var mob = _isMobile();
        var today = new Date().toLocaleDateString('en-IN', {weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'});

        document.getElementById('content').innerHTML =
          // ── Hero greeting ──
          (mob
            ? (function () {
              var firstName = _esc((_U && _U.name ? _U.name.split(' ')[0] : 'There'));
              var role = ((_U && _U.role) || 'STAFF');
              var dept = (_U && _U.dept) || '';
              var greetIco = hr < 12 ? '🌤️' : hr < 17 ? '☀️' : '🌙';
              return '<div style="background:linear-gradient(140deg,#004D5F 0%,var(--P) 40%,var(--Pd) 75%,#0BBFBF 100%);margin:-14px -12px 0;padding:22px 20px 46px;position:relative;overflow:hidden;border-radius:0 0 32px 32px">' +
                '<div style="position:absolute;top:-50px;right:-50px;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,.06)"></div>' +
                '<div style="position:absolute;top:30px;right:20px;width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.04)"></div>' +
                '<div style="position:absolute;bottom:-30px;left:-20px;width:110px;height:110px;border-radius:50%;background:rgba(255,255,255,.05)"></div>' +
                '<div style="position:relative;z-index:1">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
                '<div style="display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.14);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.18);border-radius:30px;padding:5px 13px">' +
                '<span style="width:7px;height:7px;border-radius:50%;background:#4ade80;display:inline-block;box-shadow:0 0 8px #4ade80;flex-shrink:0"></span>' +
                '<span style="color:rgba(255,255,255,.92);font-size:11px;font-weight:700;letter-spacing:.4px;white-space:nowrap">' + today + '</span>' +
                '</div>' +
                '<span style="font-size:22px;line-height:1">' + greetIco + '</span>' +
                '</div>' +
                '<div style="font-size:12px;font-weight:500;color:rgba(255,255,255,.65);letter-spacing:.3px;margin-bottom:2px">' + greet + '</div>' +
                '<div style="color:#fff;font-size:30px;font-weight:900;letter-spacing:-1px;line-height:1.1;margin-bottom:12px;text-shadow:0 2px 12px rgba(0,0,0,.15)">' + firstName + ' 👋</div>' +
                '<div style="display:flex;align-items:center;gap:8px">' +
                '<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.13);border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:5px 11px">' +
                '<i class="fas fa-briefcase" style="color:rgba(255,255,255,.75);font-size:10px"></i>' +
                '<span style="color:rgba(255,255,255,.9);font-size:11.5px;font-weight:800;letter-spacing:.4px">' + role + '</span>' +
                '</div>' +
                (dept ? '<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:5px 11px"><i class="fas fa-building" style="color:rgba(255,255,255,.65);font-size:10px"></i><span style="color:rgba(255,255,255,.8);font-size:11.5px;font-weight:700;letter-spacing:.3px">' + _esc(dept) + '</span></div>' : '') +
                '</div>' +
                '</div>' +
                '</div>';
            })()
            : '<div class="mod-head">' +
            '<div><div class="mod-title">' + greet + ', ' + _esc((_U && _U.name ? _U.name.split(' ')[0] : 'There')) + ' 👋</div>' +
            '<div class="mod-sub">' + today + '</div></div>' +
            '<div class="mod-head-right">' +
            '<button class="btn btn-outline btn-sm" onclick="_loadV(\'feed\')"><i class="fas fa-bolt"></i> Activity</button>' +
            '<button class="btn btn-sm" onclick="_loadV(\'check\')"><i class="fas fa-list-check"></i> My Tasks</button>' +
            '</div></div>'
          ) +

          // ── anim-item wrapper for animated section entrance
          // ── Check In/Out card (only for staff who need attendance) ──
          ((_U && _U.need_attendance === false) ? '' :
            (mob
              ? '<div style="margin:0 -14px;padding:0 14px 16px;margin-top:-2px">' +
              '<div class="att-punch-card" id="dashPunchCard" style="margin-top:32px;z-index:2;position:relative;box-shadow:0 8px 32px rgba(0,0,0,.15)">' +
              '<div class="att-punch-info">' +
              '<div class="att-punch-title"><i class="fas fa-fingerprint" style="color:var(--P);margin-right:6px"></i>TODAY\'S ATTENDANCE</div>' +
              '<div class="att-punch-status" id="dashPunchStatus">Checking status...</div>' +
              '<div class="att-punch-times" id="dashPunchTimes"></div>' +
              '<div id="dashPunchGps" style="display:none;font-size:11.5px;margin-top:6px;font-weight:600"></div>' +
              '</div>' +
              '<button class="btn-checkin" id="dashPunchBtn" onclick="_doPunch()" disabled>' +
              '<i class="fas fa-circle-notch ci-spinner"></i> Checking...</button>' +
              '</div></div>'
              : '<div class="att-punch-card" id="dashPunchCard">' +
              '<div class="att-punch-info">' +
              '<div class="att-punch-title"><i class="fas fa-fingerprint" style="color:var(--P);margin-right:6px"></i>Today\'s Attendance</div>' +
              '<div class="att-punch-status" id="dashPunchStatus">Checking status...</div>' +
              '<div class="att-punch-times" id="dashPunchTimes"></div>' +
              '<div id="dashPunchGps" style="display:none;font-size:11.5px;margin-top:6px;font-weight:600"></div>' +
              '</div>' +
              '<button class="btn-checkin" id="dashPunchBtn" onclick="_doPunch()" disabled>' +
              '<i class="fas fa-circle-notch ci-spinner"></i> Checking...' +
              '</button></div>'
            )) +

          // ── Celebrations ──
          '<div id="dashCelebrations" style="display:none;margin-bottom:14px"></div>' +

          // ── KPI grid ──
          '<div class="krow" id="dashKrow">' +
          [1, 2, 3, 4].map(function () {return '<div class="sk sk-h6" style="border-radius:14px"></div>';}).join('') +
          '</div>' +

          // ── Quick action tiles — role-aware (staff vs manager)
          (function () {
            var isMgr = (typeof _isManager === 'function' && _isManager());
            var tiles = [
              {ico: 'fa-list-check', lbl: 'Tasks', view: 'check', c1: '#0F766E', c2: '#14B8A6', all: true},
              {ico: 'fa-diagram-project', lbl: 'Delegate', view: 'deleg', c1: '#7C3AED', c2: '#A78BFA', all: true},
              {ico: 'fa-user-clock', lbl: 'Attend', view: 'attend', c1: '#1D4ED8', c2: '#60A5FA', all: true},
              {ico: 'fa-user', lbl: 'Profile', view: 'profile', c1: '#475569', c2: '#94A3B8', all: true},
              {ico: 'fa-bullhorn', lbl: 'Announce', view: 'ann', c1: '#D97706', c2: '#FCD34D', all: true},
              {ico: 'fa-chart-line', lbl: 'Analytics', view: 'clana', c1: '#9D174D', c2: '#F472B6', mgr: true},
              {ico: 'fa-address-card', lbl: 'Directory', view: 'empdir', c1: '#92400E', c2: '#F59E0B', mgr: true},
              {ico: 'fa-file-invoice-dollar', lbl: 'Salary', view: 'payroll', c1: '#111111', c2: '#4A4A4A', mgr: true},
              {ico: 'fa-table-columns', lbl: 'EM Board', view: 'em', c1: '#0E7490', c2: '#22D3EE', mgr: true}
            ].filter(function (a) { return a.all || (a.mgr && isMgr); });
            return '<div class="dash-qa-grid" id="dashQuickAct">' +
              tiles.map(function (a) {
                return '<button class="qa-tile" onclick="_loadV(\'' + a.view + '\')">' +
                  '<div class="qa-icon" style="background:linear-gradient(135deg,' + a.c1 + ',' + a.c2 + ')">' +
                  '<i class="fas ' + a.ico + '"></i></div>' +
                  '<span class="qa-lbl">' + a.lbl + '</span>' +
                  '</button>';
              }).join('') +
              '</div>';
          })() +

                    // ── Charts row (desktop only; mobile shows list-style cards instead) ──
          (mob ? '' :
            '<div class="dash-charts-row" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px">' +
            '<div class="chart-wrap"><div class="chart-head"><div class="chart-title">Task Completion — Last 7 Days</div><div class="chart-sub">Daily tasks marked as done</div></div><div class="chart-inner"><canvas id="dashBarChart"></canvas></div></div>' +
            '<div class="chart-wrap"><div class="chart-head" style="display:flex;align-items:center;justify-content:space-between"><div><div class="chart-title">Task Status</div><div class="chart-sub">Today\'s breakdown</div></div></div><div class="chart-inner"><canvas id="dashDoughChart"></canvas></div></div>' +
            '</div>'
          ) +

          // ── Lower cards ──
          '<div style="display:grid;grid-template-columns:' + (mob ? '1fr' : '1fr 1fr 1fr') + ';gap:' + (mob ? '12px' : '16px') + '">' +
          '<div class="card card-nohover"><div class="sec-head"><div class="sec-title"><i class="fas fa-bullhorn" style="color:var(--O)"></i> Announcements</div><button class="btn btn-ghost btn-xs" onclick="_loadV(\'ann\')">View all <i class="fas fa-arrow-right"></i></button></div><div id="dashAnnList">' + _skel(2, 'sk-h5') + '</div></div>' +
          '<div class="card card-nohover"><div class="sec-head"><div class="sec-title"><i class="fas fa-inbox" style="color:var(--P)"></i> My Delegations</div><button class="btn btn-ghost btn-xs" onclick="_loadV(\'deleg\')">View all <i class="fas fa-arrow-right"></i></button></div><div id="dashDelList">' + _skel(2, 'sk-h5') + '</div></div>' +
          (!_U || _U.need_attendance !== false
            ? '<div class="card card-nohover"><div class="sec-head"><div class="sec-title"><i class="fas fa-calendar-check" style="color:var(--T)"></i> This Month</div><button class="btn btn-ghost btn-xs" onclick="_loadV(\'attend\')">Details <i class="fas fa-arrow-right"></i></button></div><div id="dashAttSum">' + _skel(1, 'sk-h6') + '</div></div>'
            : '') +
          '</div>';

      } catch (e) {
        console.error('[dash]', e);
        var c = document.getElementById('content');
        if (c) c.innerHTML = '<div style="padding:32px;text-align:center">'
          + '<div style="font-size:36px;margin-bottom:12px">⚠️</div>'
          + '<b style="color:var(--tx)">Dashboard Error</b><br>'
          + '<small style="color:var(--tx3)">' + e.message + '</small><br><br>'
          + '<button class="btn" onclick="location.reload()">🔄 Reload App</button>'
          + '</div>';
      }
      /* ── Load Dashboard Data ── */
      _loadPunchStatus();
      _initGpsGate();
      _gas('getDashboardStats', [], function (s) {
        // Subtitle
        var d = new Date();
        var el = document.getElementById('dashSubtitle');
        if (el) el.textContent = d.toLocaleDateString('en-IN', {weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'});

        var pct = (s.totalTasks || 0) > 0 ? Math.round((s.doneTasks || 0) / s.totalTasks * 100) : 0;

        // KPIs
        var kpiEl = document.getElementById('dashKrow');
        if (kpiEl) {
          kpiEl.innerHTML = [
            {lbl: 'Tasks Done Today', val: s.doneTasks || 0, c: 'var(--G)', ib: 'var(--Gl)', ico: 'fa-check-circle', extra: '<div class="kpi-bar-wrap"><div class="kpi-bar" style="width:' + pct + '%"></div></div><div style="font-size:11px;color:var(--tx2);font-weight:600;margin-top:4px">' + pct + '% of ' + (s.totalTasks || 0) + ' tasks</div>'},
            {lbl: 'Pending Tasks', val: s.pendingTasks || 0, c: 'var(--O)', ib: 'var(--Ol)', ico: 'fa-hourglass-half', extra: ''},
            {lbl: 'Overdue Delegations', val: s.overdueDelegations || 0, c: 'var(--R)', ib: 'var(--Rl)', ico: 'fa-triangle-exclamation', extra: ''},
            {lbl: 'Attendance This Month', val: s.myAttendanceToday || '—', c: 'var(--P)', ib: 'var(--Pl)', ico: 'fa-user-clock', extra: ''}
          ].map(function (k, i) {
            return '<div class="kpi kpi-anim" style="--kc:' + k.c + ';--kib:' + k.ib + ';animation-delay:' + (i * .08) + 's">' +
              '<div class="kpi-ico"><i class="fas ' + k.ico + '"></i></div>' +
              '<div class="kpi-val">' + _esc(String(k.val)) + '</div>' +
              '<div class="kpi-lbl">' + k.lbl + '</div>' +
              k.extra +
              '</div>';
          }).join('');
        }

        /* Bar chart: Last 7 days trend (simulated from today's data) */
        setTimeout(function () {
          var barEl = document.getElementById('dashBarChart');
          if (!barEl) return;
          var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          var today = new Date().getDay();
          var lbls = [];
          var vals = [];
          for (var i = 6; i >= 0; i--) {
            lbls.push(days[(today - i + 7) % 7]);
            // Simulate last 7 days using a decay from today's value
            var rand = Math.max(0, (s.doneTasks || 0) + Math.floor(Math.random() * 3 - 1));
            vals.push(i === 0 ? (s.doneTasks || 0) : rand);
          }
          if (_charts['dashBar']) {_charts['dashBar'].destroy();}
          _charts['dashBar'] = new Chart(barEl.getContext('2d'), {
            type: 'bar',
            data: {
              labels: lbls,
              datasets: [{
                data: vals,
                backgroundColor: vals.map(function (v, i) {
                  return i === vals.length - 1 ? 'rgba(17,17,17,.9)' : 'rgba(17,17,17,.35)';
                }),
                borderRadius: 7,
                borderSkipped: false
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {legend: {display: false}},
              scales: {
                y: {beginAtZero: true, grid: {color: 'rgba(0,0,0,.05)'}, ticks: {color: '#94a3b8', font: {size: 11}}},
                x: {grid: {display: false}, ticks: {color: '#94a3b8', font: {size: 11}}}
              }
            }
          });

          /* Doughnut chart */
          var dEl = document.getElementById('dashDoughChart');
          if (!dEl) return;
          var done = s.doneTasks || 0;
          var pending = s.pendingTasks || 0;
          var total = s.totalTasks || 0;
          if (_charts['dashDough']) {_charts['dashDough'].destroy();}
          _charts['dashDough'] = new Chart(dEl.getContext('2d'), {
            type: 'doughnut',
            data: {
              labels: ['Done', 'Pending', 'Overdue'],
              datasets: [{
                data: [done, pending, Math.max(0, (s.overdueDelegations || 0))],
                backgroundColor: ['rgba(47,158,68,.85)', 'rgba(217,119,6,.85)', 'rgba(224,49,49,.85)'],
                borderWidth: 0,
                hoverOffset: 8
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              cutout: '64%',
              plugins: {
                legend: {position: 'bottom', labels: {color: '#94a3b8', padding: 16, font: {size: 12}}}
              }
            }
          });
        }, 150);
      });

      /* Announcements */
      _gas('getAnnouncements', [], function (anns) {
        var el = document.getElementById('dashAnnList');
        if (!el) return;
        if (!anns || !anns.length) {el.innerHTML = '<div class="te" style="padding:20px"><i class="fas fa-bullhorn" style="font-size:24px;opacity:.3"></i>No announcements</div>'; return;}
        el.innerHTML = anns.slice(0, 4).map(function (a) {
          return '<div class="anim-item" style="padding:10px 12px;border-radius:9px;background:var(--bg);margin-bottom:8px;border-left:3px solid ' + (a.priority === 'High' ? 'var(--R)' : 'var(--P)') + ';transition:background .15s;cursor:default" ' +
            'onmouseover="this.style.background=\'var(--Pl)\'" onmouseout="this.style.background=\'var(--bg)\'">' +
            '<div style="font-size:13px;font-weight:600;color:var(--tx);line-height:1.5;margin-bottom:4px">' + _esc(a.text.length > 90 ? a.text.slice(0, 87) + '…' : a.text) + '</div>' +
            '<div style="font-size:10.5px;color:var(--tx3);font-weight:600;display:flex;align-items:center;gap:8px">' +
            _statusBadge(a.priority) +
            '<span>' + _esc(a.posted_by || 'Management') + '</span>' +
            '<span>' + _fmtTimestamp(a.posted_at) + '</span>' +
            '</div>' +
            '</div>';
        }).join('');
      });

      /* Delegations */
      _gas('getMyDelegations', ['All'], function (dels) {
        var el = document.getElementById('dashDelList');
        if (!el) return;
        var active = (dels || []).filter(function (d) {return d.status !== 'Completed' && d.status !== 'Cancelled';}).slice(0, 4);
        if (!active.length) {el.innerHTML = '<div class="te" style="padding:20px"><i class="fas fa-inbox" style="font-size:24px;opacity:.3"></i>No active delegations</div>'; return;}
        el.innerHTML = active.map(function (d) {
          var dl = _dl(d.final_date);
          var dlTxt = dl === null ? '' : dl < 0 ? '<span style="color:var(--R);font-size:10px;font-weight:800">Overdue ' + Math.abs(dl) + 'd</span>' : dl === 0 ? '<span style="color:var(--O);font-size:10px;font-weight:800">Due Today</span>' : '<span style="color:var(--tx3);font-size:10px;font-weight:600">Due ' + dl + 'd</span>';
          return '<div class="anim-item" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--bdr)">' +
            '<div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:' + _colorForStatus(d.is_overdue && d.status !== 'Completed' ? 'Overdue' : d.status) + '"></div>' +
            '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(d.task_desc) + '</div>' +
            '<div style="font-size:11px;color:var(--tx3);display:flex;gap:8px;margin-top:2px">' +
            '<span>by ' + _esc(d.delegated_by_name || '—') + '</span>' + dlTxt +
            '</div>' +
            '</div>' +
            _statusBadge(d.is_overdue && d.status !== 'Completed' ? 'Overdue' : d.status) +
            '</div>';
        }).join('');
      });

      /* ── Celebrations (Birthday / Anniversary) ── */
      if (_D.celebrations && _D.celebrations.length) {
        _renderDashCelebrations();
      } else {
        // Fetch fresh if not in cache
        _gas('getTodayCelebrations', [], function (cels) {
          _D.celebrations = cels || [];
          _renderDashCelebrations();
        }, function () { });
      }

      /* Attendance */
      _gas('getMyAttendance', [_U.emp_code, _currMonth()], function (data) {
        var el = document.getElementById('dashAttSum');
        if (!el) return;
        var s = data.summary || {};
        var total = (s.full_days || 0) + (s.half_days || 0) + (s.absent || 0);
        var pres = (s.full_days || 0) + (s.half_days || 0) * 0.5;
        var pct = total > 0 ? Math.round(pres / total * 100) : 0;
        el.innerHTML =
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">' +
          [['Full Days', s.full_days || 0, 'var(--G)'], ['Half Days', s.half_days || 0, 'var(--O)'], ['Absent', s.absent || 0, 'var(--R)']].map(function (k) {
            return '<div style="text-align:center;padding:10px;background:var(--bg);border-radius:9px;border:1px solid var(--bdr)">' +
              '<div style="font-size:20px;font-weight:900;color:' + k[2] + '">' + k[1] + '</div>' +
              '<div style="font-size:9.5px;color:var(--tx2);font-weight:700;margin-top:2px;text-transform:uppercase;letter-spacing:0;line-height:1.2;word-break:keep-all">' + k[0] + '</div>' +
              '</div>';
          }).join('') +
          '</div>' +
          '<div style="margin-bottom:6px;display:flex;justify-content:space-between">' +
          '<span style="font-size:12px;font-weight:700;color:var(--tx2)">Attendance Rate</span>' +
          '<span style="font-size:12px;font-weight:900;color:var(--P)">' + pct + '%</span>' +
          '</div>' +
          '<div class="pbar-wrap"><div class="pbar" style="width:' + pct + '%;background:' + (pct >= 80 ? 'var(--G)' : pct >= 60 ? 'var(--O)' : 'var(--R)') + '"></div></div>' +
          '<div style="font-size:10.5px;color:var(--tx3);margin-top:6px;font-weight:600">' + new Date().toLocaleDateString('en-IN', {month: 'long', year: 'numeric'}) + '</div>';
      });
    }

    /* ══════════════════════════════════════════════════════════
       ACTIVITY FEED
    ══════════════════════════════════════════════════════════ */

    /* ══════════════════════════════════════════════════════════
       ANNOUNCEMENTS
    ══════════════════════════════════════════════════════════ */




    function _renderAnns(anns) {
      var el = document.getElementById('annContent') || document.getElementById('annList');
      if (!el) return;
      if (!anns || !anns.length) {
        el.innerHTML = '<div class="empty-state"><i class="fas fa-bullhorn"></i><h4>No Announcements</h4><p>Nothing to display right now.</p></div>';
        return;
      }
      el.innerHTML =
        '<div class="export-bar"><i class="fas fa-bullhorn"></i><span>' + anns.length + ' announcement' + (anns.length !== 1 ? 's' : '') + '</span>' +
        '<div class="fbar-spacer"></div>' +
        '<button class="btn btn-xs btn-outline" onclick="_D.announcements=null;_loadAnns()"><i class="fas fa-rotate-right"></i> Refresh</button>' +
        '</div>' +
        '<div class="ann-list">' +
        anns.map(function (a) {
          var priorityCls = a.priority === 'High' ? 'high' : a.priority === 'Low' ? 'low' : 'normal';
          return '<div class="ann-card ' + priorityCls + '">' +
            '<div class="ann-text">' + _esc(a.text) + '</div>' +
            '<div class="ann-meta">' +
            '<div class="ann-info">' +
            _statusBadge(a.priority) +
            '<span><i class="fas fa-user"></i> ' + _esc(a.posted_by_name || a.posted_by || 'Management') + '</span>' +
            '<span><i class="fas fa-clock"></i> ' + _fmtDateTime(a.posted_at) + '</span>' +
            '</div>' +
            (_isManager() ? '<button class="btn btn-red btn-xs" data-id="' + _esc(a.ann_id) + '" onclick="_deleteAnn(this)"><i class="fas fa-trash"></i></button>' : '') +
            '</div>' +
            '</div>';
        }).join('') +
        '</div>';
    }


    function _deleteAnn(btn) {
      var id = btn.getAttribute('data-id');
      _openModal(
        '<i class="fas fa-trash" style="color:var(--R)"></i> Delete Announcement',
        '<p style="font-size:14px;color:var(--tx2);line-height:1.6">Remove this announcement? It will no longer be visible to any staff member.</p>',
        function () {
          _closeModal();
          _gas('deleteAnnouncement', [id], function () {
            _toast('Announcement deleted', 'ok');
            _loadAnns();
            _loadAnnBadge();
          }, function (e) {_toast('Error: ' + e.message, 'err');});
        },
        '<i class="fas fa-trash"></i> Delete'
      );
    }

    /* ══════════════════════════════════════════════════════════
       CHECKLIST MODULE
    ══════════════════════════════════════════════════════════ */
    var TABS_CHECK = [
      {id: 'ctoday', lbl: '<i class="fas fa-calendar-day"></i> Today'},
      {id: 'cweek', lbl: '<i class="fas fa-calendar-week"></i> Week View'},
      {id: 'chist', lbl: '<i class="fas fa-history"></i> History'},
      {id: 'csetup', lbl: '<i class="fas fa-gear"></i> Task Setup'}
    ];

    function _vCheck() {
      var at = _ST || 'ctoday';
      var tabs = [], panes = [];

      tabs.push({id: 'ctoday', lbl: '<i class="fas fa-calendar-day"></i> Today'});
      panes.push('<div id="ctodayPane">' + _ctodayForm() + '</div>');
      tabs.push({id: 'cweek', lbl: '<i class="fas fa-calendar-week"></i> Week View'});
      panes.push('<div id="cweekPane">' + _cweekForm() + '</div>');
      tabs.push({id: 'chist', lbl: '<i class="fas fa-history"></i> History'});
      panes.push('<div id="chistPane">' + _chistForm() + '</div>');
      if (_isManager()) {
        tabs.push({id: 'csetup', lbl: '<i class="fas fa-gear"></i> Task Setup'});
        panes.push('<div id="csetupPane">' + _csetupForm() + '</div>');
      }
      if (_isMarkAttendanceAllowed()) {
        tabs.push({id: 'cmteam', lbl: '<i class="fas fa-list-check"></i> Mark Team Checklist'});
        panes.push('<div id="cmteamPane">' + _cmTeamForm() + '</div>');
      }

      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div><div class="mod-title">Checklist</div><div class="mod-sub">KRA / KPI daily task tracker</div></div>' +
        '<div class="mod-head-right">' +
        '<div class="search-inp" style="flex:1;min-width:0"><i class="fas fa-search"></i>' +
        '<input type="text" id="ckSearchInp" placeholder="Filter tasks..." oninput="_filterTaskCards(this.value)" style="padding:7px 7px 7px 30px;border:1.5px solid var(--bdr);border-radius:8px;font-size:12px;background:var(--bg);color:var(--tx);outline:none;width:100%"></div>' +
        (_isManager() ? '<button class="btn btn-outline btn-sm" onclick="_loadV(\'check\',\'csetup\')"><i class="fas fa-gear"></i> Setup</button>' : '') +
        '</div></div>' +
        _mkTabs(tabs, at) + _mkPanes(tabs, at, panes);

      if (at === 'ctoday') _loadToday();
      else if (at === 'cweek') _loadWeek();
      else if (at === 'chist') _loadHist();
      else if (at === 'csetup' && _isManager()) _loadSetupTasks();
      else if (at === 'cmteam' && _isMarkAttendanceAllowed()) _loadTeamChecklist();
      if (_ST) setTimeout(function () {_switchTab(_ST);}, 30);
    }

    /* ══════════════════════════════════════════════════════════════════
       MARK TEAM CHECKLIST — OWNER / MANAGER / COORDINATOR
       Shows all staff's today's pending checklist tasks.
       Grouped by employee with expand/collapse.
       Manager can mark done or shift to tomorrow per task.
    ══════════════════════════════════════════════════════════════════ */
    function _cmTeamForm() {
      return '<div id="cmteamRoot"><div style="padding:28px;text-align:center;color:var(--tx3)"><i class="fas fa-spinner fa-spin" style="font-size:22px;opacity:.25"></i></div></div>';
    }

    var _cmtData = [];  // loaded tasks
    var _cmtDate = '';
    var _cmtSort = {key: 'name', dir: 1};

    function _loadTeamChecklist() {
      var root = document.getElementById('cmteamRoot');
      if (!root) return;
      _cmtDate = _today();

      root.innerHTML =
        // ── Filter bar ─────────────────────────────────────────────────
        '<div id="cmtFilters" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;background:var(--sur2);border-radius:12px;border:1px solid var(--bdr)">' +
        // Single date
        '<div style="display:flex;align-items:center;gap:5px">' +
        '<span style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;white-space:nowrap">Date</span>' +
        '<input type="date" id="cmtDate" class="ana-sel" style="min-width:132px" value="' + _cmtDate + '">' +
        '</div>' +
        '<div style="width:1px;height:24px;background:var(--bdr);flex-shrink:0"></div>' +
        // Dept + Employee + Status
        '<select id="cmtDept" class="ana-sel" style="min-width:130px"><option value="all">All Departments</option></select>' +
        '<select id="cmtEmpFilter" class="ana-sel" style="min-width:140px"><option value="all">All Employees</option>' + _getEmpOptions() + '</select>' +
        '<select id="cmtStatus" class="ana-sel" style="min-width:120px">' +
        '<option value="all" selected>All Tasks</option>' +
        '<option value="pending">Pending Only</option>' +
        '<option value="Done">Done</option>' +
        '</select>' +
        '<input type="text" id="cmtSearch" class="ana-sel" placeholder="Search name / task…" style="min-width:140px">' +
        '<div style="flex:1"></div>' +
        '<button class="btn btn-sm" onclick="_cmtReload()" style="white-space:nowrap"><i class="fas fa-rotate-right"></i> Reload</button>' +
        '</div>' +

        // ── Sort + expand/collapse toolbar ──────────────────────────────
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
        '<span style="font-size:10.5px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px;white-space:nowrap">Sort:</span>' +
        '<button id="ctsb_name"  onclick="_cmtSort(\'name\')"  class="ctsb ctsb-a" style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--P);background:var(--Pl);color:var(--P)">Name ↑</button>' +
        '<button id="ctsb_dept"  onclick="_cmtSort(\'dept\')"  class="ctsb"        style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx2)"><i class="fas fa-building" style="font-size:10px"></i> Dept</button>' +
        '<button id="ctsb_pend"  onclick="_cmtSort(\'pend\')"  class="ctsb"        style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx2)"><i class="fas fa-clock" style="font-size:10px"></i> Pending Count</button>' +
        '<div style="width:1px;height:22px;background:var(--bdr);flex-shrink:0;margin:0 2px"></div>' +
        '<button onclick="_cmtExpandAll(true)"  style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx2)"><i class="fas fa-angles-down" style="font-size:10px"></i> Expand All</button>' +
        '<button onclick="_cmtExpandAll(false)" style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx2)"><i class="fas fa-angles-right" style="font-size:10px"></i> Collapse All</button>' +
        '</div>' +

        '<div id="cmtStats" style="display:flex;gap:8px;margin-bottom:12px"></div>' +
        '<div id="cmtList">' + _skel(3) + '</div>';

      _gas('getTeamChecklistToday', [_cmtDate, 'all'], function (rows) {
        _cmtData = rows || [];
        // Populate dept filter
        var depts = _cmtData.reduce(function (a, r) {if (r.dept && a.indexOf(r.dept) < 0) a.push(r.dept); return a;}, []).sort();
        var dsel = document.getElementById('cmtDept');
        if (dsel) {
          dsel.innerHTML = '<option value="all">All Departments</option>' +
            depts.map(function (d) {return '<option value="' + _esc(d) + '">' + _esc(d) + '</option>';}).join('');
        }
        // Wire up event listeners AFTER render
        // cmtDate → full reload (new backend call needed for new date)
        // dept/status/search → client-side filter only
        var dateEl = document.getElementById('cmtDate');
        if (dateEl) dateEl.addEventListener('change', _cmtReload);

        ['cmtDept', 'cmtStatus', 'cmtSearch', 'cmtEmpFilter'].forEach(function (id) {
          var el = document.getElementById(id);
          if (!el) return;
          el.addEventListener('change', _renderCmtList);
          el.addEventListener('input', _renderCmtList);
        });

        // Pre-load empDir so Transfer button is instant (no wait on click)
        if (!_D.empDir || !_D.empDir.length) {
          _gas('getEmployeeDirectory', [], function (dir) {
            _D.empDir = dir || [];
          }, function () { }); // silent fail — will retry on Transfer click
        }

        _renderCmtList();
      }, function (e) {
        var l = document.getElementById('cmtList');
        if (l) l.innerHTML = '<div class="te"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) + '</div>';
      });
    }

    function _renderCmtList() {
      var list = document.getElementById('cmtList');
      if (!list) return;

      var dept = (document.getElementById('cmtDept') || {}).value || 'all';
      var empFlt = (document.getElementById('cmtEmpFilter') || {}).value || 'all';
      var stFlt = (document.getElementById('cmtStatus') || {}).value || 'all';
      var q = ((document.getElementById('cmtSearch') || {}).value || '').toLowerCase().trim();

      var rows = _cmtData.filter(function (r) {
        if (dept !== 'all' && r.dept !== dept) return false;
        if (empFlt !== 'all' && r.emp_id !== empFlt) return false;
        if (stFlt === 'pending' && r.status === 'Done') return false;
        if (stFlt === 'Done' && r.status !== 'Done') return false;
        if (q && (r.emp_name + ' ' + r.task_name + ' ' + r.dept).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });

      var totPend = rows.filter(function (r) {return r.status !== 'Done';}).length;
      var totDone = rows.filter(function (r) {return r.status === 'Done';}).length;
      var statsEl = document.getElementById('cmtStats');
      if (statsEl) {
        statsEl.innerHTML =
          '<div style="flex:1;padding:10px;background:var(--Rl);border-radius:10px;text-align:center"><div style="font-size:20px;font-weight:900;color:var(--R)">' + totPend + '</div><div style="font-size:10px;font-weight:800;color:var(--R);text-transform:uppercase">Pending</div></div>' +
          '<div style="flex:1;padding:10px;background:var(--Gl);border-radius:10px;text-align:center"><div style="font-size:20px;font-weight:900;color:var(--G)">' + totDone + '</div><div style="font-size:10px;font-weight:800;color:var(--G);text-transform:uppercase">Done</div></div>' +
          '<div style="flex:1;padding:10px;background:var(--Pl);border-radius:10px;text-align:center"><div style="font-size:20px;font-weight:900;color:var(--P)">' + rows.length + '</div><div style="font-size:10px;font-weight:800;color:var(--P);text-transform:uppercase">Total</div></div>';
      }

      if (!rows.length) {
        list.innerHTML = '<div class="empty-state" style="padding:28px;text-align:center">' +
          '<i class="fas fa-list-check" style="font-size:32px;opacity:.15;color:var(--G)"></i>' +
          '<div style="margin-top:10px;font-size:14px;color:var(--tx3);font-weight:600">' +
          (stFlt === 'pending' ? 'All tasks done for today ✓' : 'No tasks match this filter') + '</div></div>';
        return;
      }

      // Group by employee
      var byEmp = {}, eOrder = [];
      rows.forEach(function (r) {
        var key = r.emp_id + '|' + r.emp_name;
        if (!byEmp[key]) {byEmp[key] = {emp_id: r.emp_id, name: r.emp_name, dept: r.dept, role: r.role, tasks: []}; eOrder.push(key);}
        byEmp[key].tasks.push(r);
      });

      // Sort employees
      var empKeys = eOrder.filter(function (k, i, a) {return a.indexOf(k) === i;});
      empKeys.sort(function (a, b) {
        var ea = byEmp[a], eb = byEmp[b];
        if (_cmtSort.key === 'dept') {var va = ea.dept.toLowerCase(), vb = eb.dept.toLowerCase(); return va < vb ? -_cmtSort.dir : va > vb ? _cmtSort.dir : 0;}
        if (_cmtSort.key === 'pend') {var pa = ea.tasks.filter(function (t) {return t.status !== 'Done';}).length, pb = eb.tasks.filter(function (t) {return t.status !== 'Done';}).length; return (pb - pa) * _cmtSort.dir;}
        return ea.name.toLowerCase() < eb.name.toLowerCase() ? -_cmtSort.dir : ea.name.toLowerCase() > eb.name.toLowerCase() ? _cmtSort.dir : 0;
      });

      var html = empKeys.map(function (k, ki) {
        var emp = byEmp[k];
        var pend = emp.tasks.filter(function (t) {return t.status !== 'Done';}).length;
        var done = emp.tasks.length - pend;
        var uid = 'cmt_e' + ki;
        var initials = (emp.name || '?').split(' ').map(function (w) {return w[0] || '';}).slice(0, 2).join('').toUpperCase();

        var eHtml = '<div style="margin-bottom:8px;border-radius:12px;overflow:hidden;border:1px solid var(--bdr2)">' +
          '<div id="cmth_' + uid + '" onclick="_cmtToggle(\'' + uid + '\')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--sur2);cursor:pointer;user-select:none">' +
          '<i id="cmti_' + uid + '" class="fas fa-chevron-down fa-fw" style="color:var(--P);font-size:11px"></i>' +
          '<div style="width:34px;height:34px;border-radius:50%;background:var(--Pl);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:var(--P);flex-shrink:0">' + _esc(initials) + '</div>' +
          '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:800;font-size:13.5px">' + _esc(emp.name) + '</div>' +
          '<div style="font-size:11px;color:var(--tx3)">' + _esc(emp.dept) + ' · ' + _esc(emp.role) + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:center">' +
          (pend ? '<span style="padding:2px 8px;border-radius:12px;background:var(--Rl);color:var(--R);font-size:10.5px;font-weight:800">' + pend + ' Pending</span>' : '') +
          (done ? '<span style="padding:2px 8px;border-radius:12px;background:var(--Gl);color:var(--G);font-size:10.5px;font-weight:800">' + done + ' Done</span>' : '') +
          '</div></div>' +
          '<div id="' + uid + '" class="adm-body adm-open">';

        eHtml += emp.tasks.map(function (t, ti) {
          var isDone = t.status === 'Done';
          var isTransOut = t.is_transferred;
          var rowBg = ti % 2 === 0 ? 'var(--bg)' : 'var(--sur2)';
          var actualFmt = t.actual ? _tsShort(t.actual) : '';
          // Plan = planned date + scheduled_time combined: "8 Aug 2026 11:00 AM"
          var planFmt = '';
          if (t.scheduled_time && t.planned) {
            planFmt = _fmtDate(t.planned) + ' ' + t.scheduled_time;
          } else if (t.scheduled_time) {
            planFmt = t.scheduled_time;
          }
          var transFmt = t.transferred_at ? _tsShort(t.transferred_at) : '';
          var rowId = 'cmtrow_' + t.row_num + '_' + Math.random().toString(36).slice(2, 7);
          return '<div id="' + rowId + '" data-row="' + t.row_num + '" data-occ="' + t.occ + '" data-uid="' + _esc(t.task_uid || '') + '" data-planned="' + _esc(t.planned || '') + '" data-name="' + _esc(t.task_name || '') + '" data-emp="' + _esc(emp.emp_id) + '" data-empname="' + _esc(emp.name) + '" data-dt="' + _cmtDate + '" style="display:flex;align-items:center;gap:10px;padding:9px 14px 9px 60px;background:' + rowBg + ';border-top:' + (ti > 0 ? '1px solid var(--bdr)' : 'none') + '">' +
            '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;font-weight:700;' + (isDone || isTransOut ? 'text-decoration:line-through;color:var(--tx3)' : '') + '">' + _esc(t.task_name) + '</div>' +
            '<div style="font-size:10.5px;color:var(--tx3);margin-top:3px;display:flex;flex-wrap:wrap;gap:5px;align-items:center">' +
            (t.frequency ? '<span style="padding:1px 6px;border-radius:4px;background:var(--sur2);border:1px solid var(--bdr);font-size:10px">' + _esc(t.frequency) + '</span>' : '') +
            (isTransOut
              ? '<span style="padding:2px 7px;border-radius:8px;background:var(--Vl);color:var(--V);font-weight:700;font-size:10px"><i class="fas fa-arrow-right-arrow-left"></i> Transferred to: ' +
              _esc(t.transferred_to || '?') + '</span>' +
              (transFmt ? '<span style="color:var(--tx3)">' + transFmt + '</span>' : '') +
              (t.transfer_reason ? '<span style="color:var(--tx3);font-style:italic">"' + _esc(t.transfer_reason) + '"</span>' : '')
              : isDone
                ? '<span style="color:var(--G);font-weight:700"><i class="fas fa-circle-check"></i> Done</span>'
                : '<span style="color:var(--R);font-weight:700"><i class="fas fa-circle-xmark"></i> Pending</span>'
            ) +
            // ── Fix 5: Plan vs Actual time with clear headers ─────────────────
            (planFmt || actualFmt
              ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:6px;background:var(--Pl);color:var(--P);font-weight:700;font-size:10px">' +
              '<i class="fas fa-calendar-clock" style="font-size:9px"></i> Plan: <strong>' + _esc(planFmt || '—') + '</strong></span>'
              : '') +
            (actualFmt
              ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:6px;background:var(--Gl);color:var(--G);font-weight:700;font-size:10px">' +
              '<i class="fas fa-check-circle" style="font-size:9px"></i> Actual: <strong>' + actualFmt + '</strong></span>'
              : (isDone && planFmt
                ? '<span style="padding:1px 7px;border-radius:6px;background:var(--Gl);color:var(--G);font-size:10px;font-weight:700"><i class="fas fa-check-circle"></i> Actual: recorded</span>'
                : (planFmt ? '<span style="padding:1px 7px;border-radius:6px;background:var(--sur3);color:var(--tx3);font-size:10px">Actual: pending</span>' : ''))) +
            // ── Fix 4: Remark — show everywhere (Done + Pending) ─────────────
            (t.remark ? '<span style="padding:1px 7px;border-radius:6px;background:var(--Il);color:var(--I);font-size:10px;font-weight:600"><i class="fas fa-comment-dots"></i> ' + _esc(t.remark) + '</span>' : '') +
            '</div></div>' +
            (isDone || isTransOut ? '' :
              '<div class="cmt-actions" style="display:flex;gap:5px;align-items:center;flex-shrink:0">' +
              '<button class="cmt-done-btn" onclick="_cmtMarkDone(this)" style="padding:4px 10px;border-radius:7px;background:var(--G);color:#fff;font-size:11.5px;font-weight:800;border:none;cursor:pointer;white-space:nowrap"><i class="fas fa-check"></i> Done</button>' +
              '<button onclick="_cmtTransfer(this)" style="padding:4px 10px;border-radius:7px;background:var(--Vl);color:var(--V);font-size:11.5px;font-weight:800;border:1.5px solid var(--V);cursor:pointer;white-space:nowrap"><i class="fas fa-arrow-right-arrow-left"></i> Transfer</button>' +
              '</div>'
            ) +
            '</div>';
        }).join('');

        eHtml += '</div></div>'; return eHtml;
      }).join('');

      list.innerHTML = html;
    }

    /* ── Smart timestamp formatter: "Today 10:30 AM", "Yesterday 2:05 PM", "27 Jun 9:00 AM" ──
       Uses _parseAnyDate so ALL formats work: ISO, dd/MM/yyyy, "Apr 01 2026 GMT+0530", etc. */
    function _tsShort(ts) {
      if (!ts) return '';
      var s = String(ts).trim();
      if (s === '-' || s === 'undefined' || s === 'null' || s === '') return '—';

      var d = _parseAnyDate(s);
      if (!d || isNaN(d.getTime())) return s.substring(0, 16);

      // Extract time from original string
      var hhmm = '';
      // "dd/MM/yyyy HH:mm" or "yyyy-MM-dd HH:mm"
      var spaceIdx = s.search(/\s+\d{2}:\d{2}/);
      if (spaceIdx > -1) hhmm = s.substring(spaceIdx).trim().substring(0, 5);
      // ISO "T14:30"
      var tIdx = s.indexOf('T');
      if (!hhmm && tIdx > 0) hhmm = s.substring(tIdx + 1, tIdx + 6);
      // "Apr 01 2026 14:30:00 GMT..." or "Sat Dec 30 1899 13:00:00..."
      if (!hhmm) {var gm2 = s.match(/\d{4}\s+(\d{2}):(\d{2})/); if (gm2) hhmm = gm2[1] + ':' + gm2[2];}
      // Last resort: use hours from parsed Date object
      if (!hhmm) {var hd = d.getHours(), md = d.getMinutes(); if (hd || md) hhmm = ('0' + hd).slice(-2) + ':' + ('0' + md).slice(-2);}

      function _to12(hm) {
        if (!hm || hm === '00:00') return '';
        var p = hm.split(':'), h = parseInt(p[0], 10), m = parseInt(p[1], 10);
        return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h >= 12 ? ' PM' : ' AM');
      }
      var timeStr = _to12(hhmm);

      var today0 = new Date(); today0.setHours(0, 0, 0, 0);
      var yest0 = new Date(today0); yest0.setDate(today0.getDate() - 1);
      var d0 = new Date(d); d0.setHours(0, 0, 0, 0);

      var prefix;
      // "Sat Dec 30 1899" = time-only (no date) — show just time
      if (d.getFullYear() === 1899) return timeStr || s.substring(0, 16);
      if (d0.getTime() === today0.getTime()) prefix = 'Today';
      else if (d0.getTime() === yest0.getTime()) prefix = 'Yesterday';
      else prefix = d.getDate() + ' ' + _MN[d.getMonth()] + ' ' + d.getFullYear();

      return timeStr ? prefix + ' ' + timeStr : prefix;
    }

    // ── IST date-time display: dd/MMM/yyyy HH:mm:ss  (e.g. 10/Oct/2026 17:00:00) ──
    // Strings without timezone are treated as IST wall-clock; ISO "Z"/offset/GMT strings are converted to IST.
    function _fmtDTIST(v) {
      if (v === null || v === undefined) return '';
      var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      function p2(n) {return ('0' + n).slice(-2);}
      function out(y, mo, d, h, mi, sec, hasT) {
        var r = p2(d) + '/' + M[mo - 1] + '/' + y;
        return hasT ? r + ' ' + p2(h) + ':' + p2(mi) + ':' + p2(sec) : r;
      }
      var s = String(v).trim(), m;
      if (!s || s === '-' || s === 'undefined' || s === 'null') return '';
      if (/^\d{1,2}\/[A-Za-z]{3}\/\d{4}/.test(s)) return s;
      if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/)))
        return out(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), m[4] !== undefined);
      if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*$/)))
        return out(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), m[4] !== undefined);
      var d = new Date(s);
      if (isNaN(d.getTime())) return s;
      var f = {};
      new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).formatToParts(d)
        .forEach(function (x) {f[x.type] = x.value;});
      return f.day + '/' + f.month + '/' + f.year + ' ' + (f.hour === '24' ? '00' : f.hour) + ':' + f.minute + ':' + f.second;
    }

    // Plan time of ONE history row = that row's own planned date + the task's time-of-day.
    function _histPlanTime(l, planMap) {
      if (l.plan_time) return _fmtDTIST(l.plan_time);
      var lbl = planMap[l.task_uid] || planMap[l._taskName] || l.scheduled_time || '';
      var m = String(lbl).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
      if (!m || !l._planDate) return '';
      var h = +m[1];
      if (m[4]) {var pm = m[4].toUpperCase() === 'PM'; h = (h % 12) + (pm ? 12 : 0);}
      return _fmtDTIST(l._planDate + ' ' + ('0' + h).slice(-2) + ':' + m[2] + ':' + (m[3] || '00'));
    }

    function _cmtTransfer(el) {
      var row = el.closest('[data-row]');
      if (!row) return;
      var rowNum = row.dataset.row || '';
      var occ = row.dataset.occ || '0';
      var taskUid = row.dataset.uid || '';   // Task ID for reliable Checklist lookup
      var taskPlanned = row.dataset.planned || ''; // Task's OWN planned date (not today)
      var taskName = row.dataset.name || '';
      var empId = row.dataset.emp || '';
      var empName = row.dataset.empname || '';
      var date = row.dataset.dt || '';

      // If empDir not loaded yet, fetch it first then show modal
      if (!_D.empDir || !_D.empDir.length) {
        _toast('⏳ Loading employee list…', 'info');
        _gas('getEmployeeDirectory', [], function (dir) {
          _D.empDir = dir || [];
          _cmtTransfer(el);
        }, function (e) {_toast('Could not load employees: ' + e.message, 'err');});
        return;
      }

      var doers = (_D.empDir || [])
        .filter(function (e) {return e.emp_id !== empId;})
        .sort(function (a, b) {return (a.dept + a.name).localeCompare(b.dept + b.name);});

      if (!doers.length) {_toast('No other employees found', 'warn'); return;}

      var depts = doers.reduce(function (acc, e) {
        if (!acc[e.dept]) acc[e.dept] = [];
        acc[e.dept].push(e);
        return acc;
      }, {});

      var opts = '<option value="">— Select employee —</option>' +
        Object.keys(depts).sort().map(function (dept) {
          return '<optgroup label="' + _esc(dept) + '">' +
            depts[dept].map(function (e) {
              return '<option value="' + _esc(e.emp_id) + '">' + _esc(e.name) + '</option>';
            }).join('') + '</optgroup>';
        }).join('');

      var taskDisplay = taskName || taskId || 'Task';

      _openModal(
        '<i class="fas fa-arrow-right-arrow-left" style="color:var(--V)"></i> Transfer Task',
        '<div style="display:flex;flex-direction:column;gap:12px">' +
        '<div style="padding:10px;background:var(--sur2);border-radius:10px;border-left:3px solid var(--V)">' +
        '<div style="font-size:10.5px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Task</div>' +
        '<div style="font-size:13px;font-weight:700;color:var(--tx)">' + _esc(taskDisplay) + '</div>' +
        '<div style="font-size:11px;color:var(--tx3);margin-top:2px"><i class="fas fa-user"></i> ' + _esc(empName) + ' → scoring nayi employee ko milegi</div>' +
        '</div>' +
        '<div><label style="font-size:12px;font-weight:800;color:var(--tx2);display:block;margin-bottom:5px">Transfer to <span style="color:var(--R)">★</span></label>' +
        '<select id="cmtTransTo" class="ana-sel" style="width:100%;min-height:44px">' + opts + '</select></div>' +
        '<div><label style="font-size:12px;font-weight:800;color:var(--tx2);display:block;margin-bottom:5px">Reason (optional)</label>' +
        '<input type="text" id="cmtTransReason" class="ana-sel" placeholder="e.g. Staff on leave, Other duty…" style="width:100%"></div>' +
        '<div style="font-size:11px;color:var(--tx3);background:var(--sur2);border-radius:8px;padding:8px 10px">' +
        '<i class="fas fa-info-circle"></i> Task dono sheets (Checklist + Checklist_Today) mein update hoga. Pehla update 5-10 seconds mein hoga.' +
        '</div></div>',
        function () {
          var toEmpId = (document.getElementById('cmtTransTo') || {}).value || '';
          if (!toEmpId) {_toast('Pehle employee select karo', 'warn'); return;}
          var reason = (document.getElementById('cmtTransReason') || {}).value || '';
          var confirmBtn = document.getElementById('mConfirmBtn');
          if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Transferring…';
          }
          // Use 30s timeout — row_num based write is instant, this just covers GAS cold start
          _gasX('transferChecklistTask', [rowNum, occ, taskUid, taskName, taskPlanned, empId, toEmpId, reason], 60000,
            function (res) {
              _closeModal();
              _cmtData.forEach(function (r) {
                if (r.row_num == rowNum && r.emp_id === empId) {
                  r.is_transferred = true; r.transferred_to = toEmpId;
                  r.transfer_by = res.transferred_by || '';
                  r.transferred_at = res.transferred_at || '';
                  r.status = 'Transferred';
                }
              });
              _toast('✅ ' + (res.to_emp_name || toEmpId) + ' ko task transfer ho gaya!', 'ok');
              _renderCmtList();
            },
            function (e) {
              // Show error prominently INSIDE the modal
              var bEl = document.getElementById('mBody');
              if (bEl) {
                var errDiv = document.createElement('div');
                errDiv.style.cssText = 'margin-top:10px;padding:10px 12px;background:var(--Rl);border:1px solid var(--R);border-radius:8px;color:var(--R);font-size:12.5px;font-weight:600';
                errDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message);
                bEl.appendChild(errDiv);
              }
              if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '<i class="fas fa-arrow-right-arrow-left"></i> Transfer Task';
              }
            }
          );
        },
        '<i class="fas fa-arrow-right-arrow-left"></i> Transfer Task'
      );
    }

    function _cmtToggle(uid) {
      var b = document.getElementById(uid), ic = document.getElementById('cmti_' + uid);
      if (!b) return;
      var open = b.classList.toggle('adm-open');
      b.style.display = open ? 'block' : 'none';
      if (ic) ic.className = 'fas fa-chevron-' + (open ? 'down' : 'right') + ' fa-fw';
    }
    function _cmtExpandAll(exp) {
      document.querySelectorAll('#cmtList .adm-body').forEach(function (b) {
        if (exp) { b.classList.add('adm-open'); b.style.display = 'block'; }
        else { b.classList.remove('adm-open'); b.style.display = 'none'; }
      });
      document.querySelectorAll('#cmtList [id^="cmti_"]').forEach(function (i) {
        i.className = 'fas fa-chevron-' + (exp ? 'down' : 'right') + ' fa-fw';
      });
    }
    function _cmtSort(key) {
      if (_cmtSort.key === key) {_cmtSort.dir *= -1;} else {_cmtSort.key = key; _cmtSort.dir = 1;}
      document.querySelectorAll('.ctsb').forEach(function (b) {
        var active = b.id === 'ctsb_' + key;
        b.style.border = '1.5px solid ' + (active ? 'var(--P)' : 'var(--bdr)');
        b.style.background = active ? 'var(--Pl)' : 'var(--bg)';
        b.style.color = active ? 'var(--P)' : 'var(--tx2)';
        if (active) {var lbls = {name: 'Name', dept: 'Dept', pend: 'Pending Count'}; b.textContent = lbls[key] + (_cmtSort.dir === 1 ? ' ↑' : ' ↓');}
      });
      _renderCmtList();
    }
    function _cmtReload() {
      var root = document.getElementById('cmteamRoot'); if (!root) return;
      _cmtDate = (document.getElementById('cmtDate') || {}).value || _today();
      if (!_cmtDate) {
        _cmtDate = _today();
        var de = document.getElementById('cmtDate');
        if (de) de.value = _cmtDate;
      }
      var dept = (document.getElementById('cmtDept') || {}).value || 'all';
      var l = document.getElementById('cmtList');
      var cKey = String(_cmtDate) + '|' + String(dept);
      var hasCCache = _D.teamChecklist && _D._ckTeamKey === cKey && Array.isArray(_D.teamChecklist);
      if (hasCCache) {
        _cmtData = _D.teamChecklist;
        _renderCmtList();
      } else if (l) {
        l.innerHTML = _skel(3);
      }
      _gas('getTeamChecklistToday', [_cmtDate, dept], function (rows) {
        _cmtData = rows || [];
        _D.teamChecklist = _cmtData;
        _D._ckTeamKey = cKey;
        _renderCmtList();
      }, function (e) {
        if (hasCCache) return;
        if (l) l.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';
      });
    }
    function _cmtMarkDone(el) {
      var row = el.closest('[data-row]');
      if (!row) return;
      var rowNum = row.dataset.row || '';
      var occ = row.dataset.occ || '0';
      var taskName = row.dataset.name || '';
      var empId = row.dataset.emp || '';
      var empName = row.dataset.empname || '';

      _openModal(
        '<i class="fas fa-check-circle" style="color:var(--G)"></i> Mark as Done',
        '<div style="font-size:13px;font-weight:700;color:var(--tx2);margin-bottom:4px">' + _esc(empName) + '</div>' +
        '<div style="font-size:12px;color:var(--tx3);margin-bottom:14px">' + _esc(taskName) + '</div>' +
        '<label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:6px">Completion Remark <span style="font-weight:400;color:var(--tx3)">(optional)</span></label>' +
        '<textarea id="cmtDoneRemark" rows="3" placeholder="e.g. Task completed, report submitted…" ' +
        'style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;' +
        'background:var(--bg);color:var(--tx);outline:none;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea>',
        function () {
          var remark = ((document.getElementById('cmtDoneRemark') || {}).value || '').trim();
          _closeModal();
          var btn = row.querySelector('.cmt-done-btn');
          if (btn) {btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';}
          _gas('markTeamTaskDone', [rowNum, occ, taskName, empId, _cmtDate, remark], function () {
            _cmtData.forEach(function (r) {if (r.row_num == rowNum && r.emp_id === empId) {r.status = 'Done'; r.remark = remark;} });
            _toast('✓ ' + empName + ' ka task done!', 'ok');
            _renderCmtList();
          }, function (e) {
            _toast(e.message, 'err');
            if (btn) {btn.disabled = false; btn.innerHTML = '<i class="fas fa-check"></i> Done';}
          });
        },
        '<i class="fas fa-check"></i> Mark Done'
      );
      setTimeout(function () {var el2 = document.getElementById('cmtDoneRemark'); if (el2) el2.focus();}, 150);
    }
    function _cmtShiftTask(taskId, empId) {
      _openModal('<i class="fas fa-forward" style="color:var(--O)"></i> Shift Task',
        '<div style="display:flex;flex-direction:column;gap:12px">' +
        '<div><label style="font-size:12px;font-weight:800;color:var(--tx2);display:block;margin-bottom:4px">Shift to Date</label>' +
        '<input type="date" id="cmtShiftTo" class="ana-sel" value="' + _tomorrow() + '" style="width:100%"></div>' +
        '<div><label style="font-size:12px;font-weight:800;color:var(--tx2);display:block;margin-bottom:4px">Reason (optional)</label>' +
        '<input type="text" id="cmtShiftReason" class="ana-sel" placeholder="Why shifting?" style="width:100%"></div>' +
        '</div>',
        function () {
          var to = (document.getElementById('cmtShiftTo') || {}).value || _tomorrow();
          var rsn = (document.getElementById('cmtShiftReason') || {}).value || '';
          _gas('managerShiftTask', [taskId, empId, _cmtDate, to], function () {
            _cmtData = _cmtData.filter(function (r) {return !(r.task_id === taskId && r.emp_id === empId);});
            _closeModal(); _toast('✓ Task shifted to ' + to, 'ok'); _renderCmtList();
          }, function (e) {_toast(e.message, 'err');});
        }, '<i class="fas fa-forward"></i> Shift');
    }
    function _tomorrow() {
      return _daysLater(1);
    }

    function _ctodayForm() {
      return '<div class="fbar" style="margin-bottom:12px">' +
        '<label>Employee</label>' +
        '<select id="ckEmp" onchange="_loadToday()" style="min-width:180px">' +
        '<option value="' + _U.emp_code + '">' + _esc((_U && _U.name) || 'Me') + ' (Me)</option>' +
        '</select>' +
        '<label>Date</label>' + '<span style="font-size:11px;color:var(--tx3)">Past date select karke pending tasks complete kar sakte ho</span>' +
        '<input type="date" id="ckDate" value="' + _today() + '" onchange="_loadToday()">' +
        '<button class="btn btn-sm" onclick="_loadToday()"><i class="fas fa-search"></i> Load</button>' +
        '</div>' +
        '<div id="ckProgress" style="margin-bottom:14px"></div>' +
        '<div id="ckList"></div>';
    }
    function _cweekForm() {
      var opts = [];
      for (var w = 1; w <= 53; w++) opts.push('<option value="' + w + '"' + (w === _currentWeek() ? ' selected' : '') + '>Week ' + w + '</option>');
      return '<div class="fbar">' +
        '<label>Week:</label><select id="ckWeek">' + opts.join('') + '</select>' +
        '<label>Year:</label><input type="number" id="ckWYear" value="' + new Date().getFullYear() + '" min="2020" max="2030" >' +
        '<label>Employee:</label><select id="ckWEmp" ><option value="' + (_U && _U.emp_code || '') + '">' + _esc((_U && _U.name) || 'Me') + ' (Me)</option></select>' +
        '<button class="btn btn-sm" onclick="_loadWeek()"><i class="fas fa-search"></i> Load</button>' +
        '</div>' +
        '<div id="ckWGrid">' + _skel(2, 'sk-h8') + '</div>';
    }
    function _chistForm() {
      return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
        '<span style="font-size:12px;font-weight:700;color:var(--tx2)">From:</span>' +
        '<input type="date" id="histFrom" class="ana-sel" style="max-width:130px" value="' + _daysAgo(30) + '">' +
        '<span style="font-size:12px;font-weight:700;color:var(--tx2)">To:</span>' +
        '<input type="date" id="histTo" class="ana-sel" style="max-width:130px" value="' + _today() + '">' +
        '<select id="histSt" class="ana-sel" style="min-width:110px"><option value="">All Status</option><option>Done</option><option>Pending</option></select>' +
        '<select id="histFreq" class="ana-sel" style="min-width:120px"><option value="">All Freq</option><option value="D">Daily</option><option value="W">Weekly</option><option value="F">Fortnightly</option><option value="M">Monthly</option><option value="2M">Every 2 Months</option><option value="Q">Quarterly</option><option value="4M">Every 4 Months</option><option value="H">Half Yearly</option><option value="Y">Yearly</option><option value="E1st">1st Weekday</option><option value="E2nd">2nd Weekday</option><option value="E3rd">3rd Weekday</option><option value="E4th">4th Weekday</option><option value="ELast">Last Weekday</option></select>' +
        '<button class="btn btn-sm" onclick="_loadHist()" style="white-space:nowrap"><i class="fas fa-search"></i> Search</button>' +
        '</div>' +
        '<div id="histTable"></div>';
    }
    function _csetupForm() {
      var todayDt = _today();
      return '<div class="csetup-grid">' +
        '<div class="card card-nohover card-sm">' +
        '<div class="sec-title" style="margin-bottom:14px"><i class="fas fa-plus-circle" style="color:var(--P)"></i> Add New Task</div>' +
        '<div class="form-g">' +
        '<div class="fgrp"><label>Employee <span class="req">★</span></label>' +
        '<select id="csEmp" onchange="_csEmpChg(this)"><option value="">-- Select Employee --</option></select></div>' +
        '<div class="fgrp"><label>Task Name <span class="req">★</span></label>' +
        '<input type="text" id="csTask" placeholder="e.g. Daily Report Submission" maxlength="120"></div>' +
        '<div class="fgrp"><label>Frequency <span class="req">★</span></label>' +
        '<select id="csFreq" onchange="_csFreqChg()">' +
        '<option value="D">D — Daily</option>' +
        '<option value="W">W — Weekly</option>' +
        '<option value="F">F — Fortnightly (every 2 weeks)</option>' +
        '<option value="M">M — Monthly</option>' +
        '<option value="2M">2M — Every 2 Months</option>' +
        '<option value="Q">Q — Quarterly (every 3 months)</option>' +
        '<option value="4M">4M — Every 4 Months</option>' +
        '<option value="H">H — Half Yearly</option>' +
        '<option value="Y">Y — Yearly</option>' +
        '<optgroup label="── nth Weekday of Month ──">' +
        '<option value="E1st">E1st — 1st Weekday of Month</option>' +
        '<option value="E2nd">E2nd — 2nd Weekday of Month</option>' +
        '<option value="E3rd">E3rd — 3rd Weekday of Month</option>' +
        '<option value="E4th">E4th — 4th Weekday of Month</option>' +
        '<option value="ELast">ELast — Last Weekday of Month</option>' +
        '</optgroup>' +
        '</select></div>' +
        // Start date + time — stack-friendly for mobile
        '<div class="fgrp cs-date-time-row"><label>Start Date <span class="req">★</span></label>' +
        '<div class="cs-dt-wrap" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">' +
        '<input type="date" id="csStartDate" value="' + todayDt + '" style="flex:1;min-width:140px">' +
        '<div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:120px">' +
        '<label style="font-size:10px;font-weight:700;color:var(--tx3);text-transform:uppercase;margin:0">Task Time <span style="color:var(--R)">★</span></label>' +
        '<input type="time" id="csTime" placeholder="--:--" required style="width:100%;min-width:110px">' +
        '</div></div></div>' +
        '</div>' +
        '<div id="csFreqX"></div>' +
        '<div style="margin-top:8px;padding:10px 14px;background:var(--sur2);border-radius:8px;font-size:12px;color:var(--tx2)">' +
        '<i class="fas fa-info-circle" style="color:var(--P)"></i> ' +
        'Task will be saved to Task List and recurring checklist rows will be auto-generated in ChecklistMaster.' +
        '</div>' +
        '<button class="btn btn-wide" id="btnSaveTask" onclick="_saveTask()" style="margin-top:14px;touch-action:manipulation;-webkit-tap-highlight-color:transparent;position:relative;z-index:1"><i class="fas fa-plus"></i> Add Task & Generate Checklist</button>' +
        '</div>' +
        '<div class="card card-nohover card-sm">' +
        '<div class="sec-title" style="margin-bottom:14px"><i class="fas fa-list" style="color:var(--tx2)"></i> Active Tasks</div>' +
        '<div id="setupTaskList">' + _skel(4, 'sk-h4') + '</div>' +
        '</div>' +
        '</div>';
    }



    // _markDone — implemented below

    function _loadWeek() {
      var wk = document.getElementById('ckWeek') ? Number(document.getElementById('ckWeek').value) : _currentWeek();
      var yr = document.getElementById('ckWYear') ? Number(document.getElementById('ckWYear').value) : new Date().getFullYear();
      var empId = document.getElementById('ckWEmp') ? document.getElementById('ckWEmp').value : _U.emp_code;
      var grid = document.getElementById('ckWGrid');
      if (!grid) return;
      var wKey = String(empId || '') + '|' + wk + '|' + yr;
      var hasWCache = _D.weekTasks && _D._ckWeekKey === wKey && Array.isArray(_D.weekTasks);
      if (!hasWCache) grid.innerHTML = _skel(2, 'sk-h8');

      if (_isManager() && document.getElementById('ckWEmp') && document.getElementById('ckWEmp').options.length <= 1) {
        _gas('getDoerList', [], function (doers) {
          var sel = document.getElementById('ckWEmp');
          if (sel) sel.innerHTML = doers.map(function (d) {return '<option value="' + _esc(d.emp_id) + '"' + (d.emp_id === _U.emp_code ? ' selected' : '') + '>' + _esc(d.name) + '</option>';}).join('');
        }, function () { });
      }

      _gas('getWeeklyTasks', [empId, wk, yr], function (days) {
        days = days || [];
        _D.weekTasks = days;
        _D._ckWeekKey = wKey;
        if (!days.length) {
          grid.innerHTML = '<div class="te"><i class="fas fa-calendar-xmark"></i> No tasks found for Week ' + wk + ', ' + yr + '</div>';
          return;
        }
        var todayStr = _today();
        // Check if fallback (no checklist rows — any task has status "Planned")
        var isPlanned = days.some(function (d) {return d.tasks.some(function (t) {return t.status === 'Planned';});});

        grid.innerHTML =
          (isPlanned ? '<div style="padding:8px 12px;background:var(--Ol);color:var(--O);border-radius:8px;font-size:12px;margin-bottom:10px"><i class="fas fa-info-circle"></i> Showing planned tasks from Task List (no checklist records generated yet for this week)</div>' : '') +
          '<div class="wkgrid">' +
          days.map(function (day) {
            var isToday = day.date === todayStr;
            var isWkend = day.day === 'Sat' || day.day === 'Sun';
            var isHol = day.isHol || false;
            var done = day.tasks.filter(function (t) {return t.status === 'Done';}).length;
            var planned = day.tasks.filter(function (t) {return t.status === 'Planned';}).length;
            var total = day.tasks.length;
            var pct = total > 0 ? Math.round(done / total * 100) : 0;
            var hdrBg = isHol ? 'background:var(--Vl);' : isToday ? 'background:var(--Pl);' : isWkend ? 'background:var(--sur2);' : '';
            return '<div class="wkday' + (isToday ? ' today' : '') + (isWkend ? ' weekend' : '') + '">' +
              '<div class="wkday-hd" style="' + hdrBg + '">' +
              _esc(day.day) + '<br>' +
              '<span style="font-size:9px;font-weight:500">' + _fmtDateShort(day.date) + '</span>' +
              (isHol ? '<br><span style="font-size:8px;color:#7c3aed;font-weight:800">HOLIDAY</span>' : '') +
              '</div>' +
              (isHol
                ? '<div style="font-size:10px;color:#7c3aed;font-weight:700;margin:4px 0">Holiday</div>'
                : total > 0
                  ? '<div style="font-size:10px;font-weight:800;color:' + (pct === 100 ? 'var(--G)' : planned > 0 ? 'var(--O)' : 'var(--P)') + ';margin-bottom:4px">' +
                  (planned > 0 ? planned + ' planned' : done + '/' + total) + '</div>'
                  : '<div style="font-size:10px;color:var(--tx4);margin-bottom:4px">—</div>'
              ) +
              '<div class="wkday-tasks">' +
              day.tasks.slice(0, 4).map(function (t) {
                var cls = t.status === 'Done' ? 'wkt-d'
                  : t.status === 'Holiday' ? 'wkt-h'
                    : t.status === 'Planned' ? 'wkt-pl'
                      : 'wkt-p';
                return '<div class="wkt ' + cls + '" title="' + _esc(t.task_name) + '">' + _esc(t.task_name) + '</div>';
              }).join('') +
              (total > 4 ? '<div class="wkt wkt-more">+' + (total - 4) + ' more</div>' : '') +
              '</div></div>';
          }).join('') +
          '</div>';
      }, function (e) {
        grid.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';
      });
    }

    function _loadHist() {
      var from = document.getElementById('histFrom') ? document.getElementById('histFrom').value : _daysAgo(30);
      var to = document.getElementById('histTo') ? document.getElementById('histTo').value : _today();
      var st = document.getElementById('histSt') ? document.getElementById('histSt').value : '';
      var freq = document.getElementById('histFreq') ? document.getElementById('histFreq').value : '';
      var tblEl = document.getElementById('histTable');
      if (!tblEl) return;
      tblEl.innerHTML = _skel(3);

      var empCode = (_U && (_U.emp_code || _U.emp_id || _U.user_id)) || '';

      function renderHist(logs, planMap) {
        planMap = planMap || {};
        if (logs && !Array.isArray(logs)) {
          logs = logs.logs || logs.rows || logs.data || logs.tasks || logs.history || [];
        }
        logs = logs || [];

        logs.forEach(function (l) {
          var rawDate = l.date || l.planned || l.plan_date || '';
          l._planDate = String(rawDate).slice(0, 10);
          l._taskName = l.task_name || l.task || l.name || '';
          l._freq = l.frequency || l.freq || '';
          l._planTime = _histPlanTime(l, planMap);
          var rawAct = l.actual_time || l.actual_dt || l.actual || l.completed_at || '';
          l._actual = rawAct ? String(rawAct) : '';
          l._remark = l.remark || l.remarks || '';
          l._emp = l.emp_name || '';
          l._dept = l.dept || '';
          var stRaw = (l.status || '').toString().toLowerCase();
          var hasActual = !!(l._actual && l._actual !== '-' && l._actual.slice(0, 10) !== '1899-12-30');
          if (stRaw === 'done' || stRaw === 'completed') l.computed_status = 'Done';
          else if (hasActual) l.computed_status = 'Done';
          else l.computed_status = 'Pending';
        });

        // Deduplicate same task+date
        var seenKey = {};
        logs = logs.filter(function (l) {
          var k = (l._planDate || '') + '|' + (l._taskName || '') + '|' + (l.task_uid || l.log_id || '');
          if (seenKey[k]) return false;
          seenKey[k] = true;
          return true;
        });
        _D.histLogs = logs;

        var filtered = logs.slice();
        if (st === 'Done') filtered = filtered.filter(function (l) { return l.computed_status === 'Done'; });
        if (st === 'Pending') filtered = filtered.filter(function (l) { return l.computed_status === 'Pending'; });
        if (freq) filtered = filtered.filter(function (l) {
          var f = String(l._freq || '').toUpperCase();
          return f === freq.toUpperCase() || f.charAt(0) === freq.charAt(0).toUpperCase();
        });

        if (!filtered.length) {
          tblEl.innerHTML = '<div class="te"><i class="fas fa-search"></i>No records found matching your filters</div>';
          return;
        }

        tblEl.innerHTML =
          '<div class="export-bar"><i class="fas fa-table"></i>' +
          '<span>' + filtered.length + ' records</span>' +
          '<button class="btn btn-outline btn-xs" onclick="_exportHistory()"><i class="fas fa-download"></i> Export CSV</button>' +
          '</div>' +
          '<div class="table-card hist-desk"><div class="tw"><table><thead><tr>' +
          '<th>Plan Date</th><th>Task</th><th>Freq</th><th>Status</th>' +
          '<th style="color:var(--P)"><i class="fas fa-calendar-clock"></i> Plan Time</th>' +
          '<th style="color:var(--G)"><i class="fas fa-check-circle"></i> Actual Time</th>' +
          '<th>Remark</th>' +
          '</tr></thead><tbody>' +
          filtered.map(function (l) {
            var isDone = l.computed_status === 'Done';
            var actTime = l._actual ? _esc(_fmtDTIST(l._actual)) : '';
            var planTimeDisp = l._planTime || '';
            return '<tr>' +
              '<td style="font-weight:700;white-space:nowrap">' + _fmtDate(l._planDate) + '</td>' +
              '<td style="min-width:140px">' + _esc(l._taskName) +
              (l._emp ? '<div style="font-size:10px;color:var(--tx3);margin-top:2px">' + _esc(l._emp) + (l._dept ? ' · ' + _esc(l._dept) : '') + '</div>' : '') +
              '</td>' +
              '<td>' + _freqBadge(l._freq) + '</td>' +
              '<td>' + _statusBadge(isDone ? 'Done' : 'Pending') + '</td>' +
              '<td style="color:var(--P);font-weight:600">' + (planTimeDisp ? '<i class="fas fa-calendar-clock"></i> ' + _esc(planTimeDisp) : '<span style="color:var(--tx3)">—</span>') + '</td>' +
              '<td style="color:var(--G);font-weight:600">' + (actTime ? '<i class="fas fa-check-circle"></i> ' + actTime : '<span style="color:var(--tx3)">—</span>') + '</td>' +
              '<td style="max-width:180px;font-size:12px;color:var(--tx2)">' + (l._remark ? _esc(l._remark) : '<span style="color:var(--tx3)">—</span>') + '</td>' +
              '</tr>';
          }).join('') +
          '</tbody></table></div></div>' +
          '<div class="hist-mob">' +
          filtered.map(function (l) {
            var isDone = l.computed_status === 'Done';
            var planTime = l._planTime || '';
            var actTime = l._actual ? _esc(_fmtDTIST(l._actual)) : '';
            return '<div class="card card-nohover" style="padding:12px 14px;margin-bottom:8px">' +
              '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">' +
              '<div style="font-weight:700;font-size:13px;flex:1;min-width:0;word-break:break-word">' + _esc(l._taskName) + '</div>' +
              _statusBadge(isDone ? 'Done' : 'Pending') +
              '</div>' +
              '<div style="display:flex;flex-wrap:wrap;gap:6px;font-size:11px;color:var(--tx3);margin-bottom:4px">' +
              '<span><i class="fas fa-calendar"></i> ' + _fmtDate(l._planDate) + '</span>' +
              (l._freq ? '<span>' + _freqBadge(l._freq) + '</span>' : '') +
              (l._emp ? '<span><i class="fas fa-user"></i> ' + _esc(l._emp) + '</span>' : '') +
              '</div>' +
              '<div style="display:flex;flex-wrap:wrap;gap:8px;font-size:11px;margin-top:4px">' +
              (planTime ? '<span style="color:var(--P);font-weight:600"><i class="fas fa-calendar-clock"></i> Plan: ' + _esc(planTime) + '</span>' : '') +
              (actTime ? '<span style="color:var(--G);font-weight:600"><i class="fas fa-check-circle"></i> Actual: ' + actTime + '</span>' : '') +
              '</div>' +
              (l._remark ? '<div style="margin-top:6px;padding:6px 8px;background:var(--Il);border-radius:8px;font-size:11px;color:var(--I)"><i class="fas fa-comment-dots"></i> ' + _esc(l._remark) + '</div>' : '') +
              '</div>';
          }).join('') +
          '</div>';
      }

      function fetchHist(planMap) {
        _gas('getTaskHistory', [empCode, from, to], function (logs) {
          renderHist(logs, planMap);
        }, function (e) {
          tblEl.innerHTML = (e && e.message && e.message.indexOf('Network') > -1)
            ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>'
            : '<div class="te">' + _esc(e.message) + '</div>';
        });
      }

      // Load plan times from Task List then history
      if (window._histPlanMap && Object.keys(window._histPlanMap).length) {
        fetchHist(window._histPlanMap);
      } else {
        _gas('getDeptTasks', ['All', _today()], function (tasks) {
          var map = {};
          (tasks || []).forEach(function (t) {
            var label = t.day_label || t.day_date || t.day_val || '';
            if (t.task_uid && label) map[t.task_uid] = label;
            if (t.task_name && label) map[t.task_name] = label;
          });
          window._histPlanMap = map;
          fetchHist(map);
        }, function () {
          fetchHist({});
        });
      }
    }

    function _exportHistory() {
      var logs = _D.histLogs || [];
      if (!logs.length) {_toast('No history to export', 'err'); return;}
      var rows = [['Date', 'Task Name', 'Frequency', 'Status', 'Plan Time', 'Completed On']];
      logs.forEach(function (l) {rows.push([l.date, l.task_name, l.frequency, l.status, l._planTime || '', _fmtDTIST(l._actual || l.actual_dt || '')]);});
      _downloadCSV('task_history_' + _today() + '.csv', rows);
    }

    function _ckInvalidateCaches() {
      delete _D.todayTasks; delete _D._ckTodayKey;
      delete _D.weekTasks; delete _D._ckWeekKey;
      delete _D.teamChecklist; delete _D._ckTeamKey;
      delete _D.histLogs; delete _D._ckHistKey;
      window._tsAllTasks = null;
    }

    function _loadSetupTasks(silent) {
      silent = (silent === true);          // true = refresh behind the screen, never blank the list
      var el = document.getElementById('setupTaskList');
      if (!el) return;
      if (!silent) {
        if (window._tsAllTasks && window._tsAllTasks.length) {
          // Instant paint from memory; fresh data replaces it a moment later
          el.innerHTML = ''; _tsRenderBar(el); _tsApplyFilter();
          setTimeout(function () {_initSearchSelects(el);}, 60);
        } else {
          el.innerHTML = _skel(3, 'sk-h4');
        }
      }

      // ── Employee dropdown — hamesha fresh load ──
      if (_isManager()) {
        var sel = document.getElementById('csEmp');
        if (sel) {
          sel.innerHTML = '<option value="">⏳ Loading...</option>';
          _gas('getDoerList', [], function (doers) {
            _D.doers = doers;
            var s = document.getElementById('csEmp');
            if (!s) return;
            s.innerHTML = '<option value="">-- Select Employee --</option>' +
              doers.map(function (d) {
                return '<option value="' + _esc(d.emp_id) + '" ' +
                  'data-dept="' + _esc(d.department) + '" ' +
                  'data-email="' + _esc(d.email || '') + '">' +
                  _esc(d.name) + ' (' + _esc(d.department) + ')' +
                  '</option>';
              }).join('');
          }, function (e) {
            var s = document.getElementById('csEmp');
            if (s) s.innerHTML = '<option value="">-- Select Employee --</option>';
            _toast('Employee load failed: ' + e.message, 'err');
          });
        }
      }

      // ── Active Tasks — try master list (no date lock), fallback to today ──
      function _setupRenderTasks(tasks) {
        var el2 = document.getElementById('setupTaskList');
        if (!el2) return;
        if (tasks && !Array.isArray(tasks)) {
          if (Array.isArray(tasks.tasks)) tasks = tasks.tasks;
          else if (Array.isArray(tasks.data)) tasks = tasks.data;
          else if (Array.isArray(tasks.rows)) tasks = tasks.rows;
          else tasks = [];
        }
        tasks = tasks || [];
        var seen = {}; var allList = [];
        tasks.forEach(function (t, idx) {
          // Accept every shape the backend can send (Code.gs, Vercel snapshot, legacy)
          t.task_name = t.task_name || t.Task_Name || t.task || t.Task || t.name || '';
          t.task_uid = String(t.task_uid || t.setup_id || t.setupId || t['Setup Task ID'] || t.Task_UID || t.uid || t.UID || t.id || t.task_id || '').trim();
          t.emp_id = String(t.emp_id || t.doer_id || t.doerId || t['Doer ID'] || t.Emp_ID || t.empId || '').trim();
          t.emp_name = t.emp_name || t.doer_name || t.doerName || t['Doer Name'] || t.Emp_Name || t.employee_name || t.Doer || '';
          t.dept = t.dept || t.department || t.Department || t.Dept || '';
          t.frequency = t.frequency || t.Frequency || t.freq || 'D';
          t.day_date = t.day_date || t.dayDate || t['Day/Date'] || t.day_val || '';
          t.day_label = t.day_label || t.day_date || '';
          t.week_day = t.week_day || t.weekDay || t['Week Day'] || '';
          t.month_day = t.month_day || t.monthDay || t['Month Day'] || '';
          t.sheet_status = t.sheet_status || t.status || t.Status || '';
          t.delete_repeated = t.delete_repeated || t.deleteRepeated || t['Delete Repeated Task'] || '';
          // Deduplicate only on real Setup Task ID; keep rows with empty uid separately
          var uid = t.task_uid || ('__row_' + idx);
          if (!seen[uid]) { seen[uid] = true; t._i = allList.length; allList.push(t); }
        });
        if (!allList.length) {
          window._tsAllTasks = [];
          el2.innerHTML = '<div class="empty-state"><i class="fas fa-tasks"></i><h4>No Active Tasks</h4><p>Add a task using the form above.</p></div>';
          return;
        }
        window._tsAllTasks = allList;
        _tsRenderBar(el2);
        _tsApplyFilter();
        setTimeout(function () {_initSearchSelects(el2);}, 60);
      }
      function _setupLoadErr(e) {
        var el2 = document.getElementById('setupTaskList');
        if (el2) el2.innerHTML = (e && e.message && e.message.indexOf('Network') > -1)
          ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><button class="btn btn-sm" onclick="_loadSetupTasks()"><i class="fas fa-rotate-right"></i> Retry</button></div>'
          : '<div class="te">' + _esc((e && e.message) || 'Error') + '</div>';
      }
      // Match working dailyapp: getDeptTasks from Task List (full fields + day_label)
      _gas('getDeptTasks', ['All', _today()], function (tasks) {
        _setupRenderTasks(tasks);
      }, function (e1) {
        _gas('getTaskSetup', [''], function (t2) {
          _setupRenderTasks(t2);
        }, function (e2) {
          _setupLoadErr(e1 || e2);
        });
      });
    }

    // ── Task Setup: render filter bar once, apply filter to task groups only ──
    function _tsRenderBar(el2) {
      // Only render filter bar if it doesn't exist yet
      if (el2.querySelector('#tsSearch')) return;
      var barHtml =
        '<div id="tsFilterBar" style="background:var(--sur2);border:1px solid var(--bdr);border-radius:10px;' +
        'padding:10px 12px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
        '<div style="position:relative;flex:1;min-width:140px">' +
        '<i class="fas fa-search" style="position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--tx3);font-size:11px;pointer-events:none"></i>' +
        '<input type="text" id="tsSearch" placeholder="Search task name…" oninput="_tsApplyFilter()" ' +
        'style="width:100%;padding:6px 10px 6px 28px;border:1.5px solid var(--bdr);border-radius:8px;' +
        'font-size:12px;background:var(--bg);color:var(--tx);outline:none;box-sizing:border-box"></div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;white-space:nowrap">Person</span>' +
        '<select id="tsEmp" class="ana-sel" onchange="_tsApplyFilter()" style="min-width:130px">' +
        '<option value="all">All Employees</option>' + _getEmpOptions() + '</select></div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;white-space:nowrap">Freq</span>' +
        '<select id="tsFreq" class="ana-sel" onchange="_tsApplyFilter()" style="min-width:90px">' +
        '<option value="all">All</option><option value="D">Daily</option>' +
        '<option value="W">Weekly</option><option value="F">Fortnightly</option>' +
        '<option value="M">Monthly</option></select></div>' +
        '<button class="btn btn-sm btn-outline" onclick="_tsClearFilter()" title="Clear">' +
        '<i class="fas fa-filter-circle-xmark"></i></button>' +
        '</div>' +
        '<div id="tsHeaderRow" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
        '<span id="tsCountLabel" style="font-size:11px;font-weight:700;color:var(--tx2)"></span>' +
        '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-xs btn-outline" onclick="_setupExpandAll(true)" style="min-width:44px;min-height:36px;touch-action:manipulation"><i class="fas fa-expand-alt"></i> All</button>' +
        '<button class="btn btn-xs btn-outline" onclick="_setupExpandAll(false)" style="min-width:44px;min-height:36px;touch-action:manipulation"><i class="fas fa-compress-alt"></i> None</button>' +
        '</div></div>' +
        '<div id="tsTaskGroups"></div>';
      el2.innerHTML = barHtml;
    }

    // ── Task Setup · Active Tasks (all Task List columns, expand/collapse, deactivate) ──
    var _TS_FREQ = {D: 'Daily', W: 'Weekly', F: 'Fortnightly', M: 'Monthly', '2M': 'Every 2 Months', Q: 'Quarterly', '4M': 'Every 4 Months', H: 'Half-yearly', Y: 'Yearly'};
    var _TS_FCLR = {D: 'var(--P)', W: 'var(--V)', F: 'var(--V)', M: 'var(--O)', '2M': 'var(--O)', Q: 'var(--O)', '4M': 'var(--O)', H: 'var(--R)', Y: 'var(--R)'};

    function _tsOrd(n) {
      n = parseInt(n, 10); if (isNaN(n)) return '';
      var v = n % 100, sfx = (v >= 11 && v <= 13) ? 'th' : ({1: 'st', 2: 'nd', 3: 'rd'}[n % 10] || 'th');
      return n + sfx;
    }

    // "Plan" chip = when the task repeats + time of day, built from the Task List columns
    function _tsPlanChip(t, planDt) {
      var tm = (String(planDt || '').match(/(\d{2}:\d{2}:\d{2})$/) || [])[1] || '';
      var f = String(t.frequency || 'D').toUpperCase(), when = '';
      if (t.week_day) when = 'Every ' + t.week_day;
      else if (t.month_day) when = _tsOrd(t.month_day) + ' of month';
      else if (f === 'D') when = 'Daily';
      return (when && tm) ? when + ' · ' + tm : (tm || when);
    }

    function _tsApplyFilter() {
      var el2 = document.getElementById('setupTaskList');
      if (!el2) return;
      var list = window._tsAllTasks || [];
      var q = ((document.getElementById('tsSearch') || {}).value || '').toLowerCase().trim();
      var emp = (document.getElementById('tsEmp') || {}).value || 'all';
      var freq = (document.getElementById('tsFreq') || {}).value || 'all';

      var filtered = list.filter(function (t) {
        if (q && (t.task_name + ' ' + t.emp_name + ' ' + t.dept).toLowerCase().indexOf(q) < 0) return false;
        if (emp !== 'all' && t.emp_id !== emp) return false;
        if (freq !== 'all' && (t.frequency || '').charAt(0).toUpperCase() !== freq) return false;
        return true;
      });

      var deptMap = {};
      filtered.forEach(function (t) {
        var d = t.dept || 'Other';
        if (!deptMap[d]) deptMap[d] = [];
        deptMap[d].push(t);
      });
      var depts = Object.keys(deptMap).sort();

      var lbl = document.getElementById('tsCountLabel');
      if (lbl) lbl.innerHTML = '<i class="fas fa-layer-group"></i> ' + filtered.length + ' tasks · ' + depts.length + ' depts' +
        (filtered.length < list.length ? ' <span style="color:var(--tx3)">(filtered from ' + list.length + ')</span>' : '');

      var grpEl = document.getElementById('tsTaskGroups');
      if (!grpEl) return;
      if (!filtered.length) {
        grpEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--tx3)"><i class="fas fa-filter-circle-xmark" style="font-size:24px;margin-bottom:8px;display:block"></i>No tasks match filters</div>';
        return;
      }

      function cell(label, val, extra) {
        var v = (val === null || val === undefined || String(val).trim() === '') ? '—' : String(val);
        return '<div><span style="color:var(--tx3);font-weight:700">' + label + '</span>' +
          '<div style="font-weight:700;color:var(--tx);word-break:break-word;' + (extra || '') + '">' + _esc(v) + '</div></div>';
      }

      grpEl.innerHTML = depts.map(function (dept, di) {
        var items = deptMap[dept];
        var gid = 'stg_' + di + '_' + dept.replace(/[^a-zA-Z0-9]/g, '_');
        return '<div style="margin-bottom:10px">' +
          '<div class="ts-dept-hd" data-gid="' + _esc(gid) + '" style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--sur2);border-radius:8px;margin-bottom:6px;cursor:pointer">' +
          '<i class="fas fa-building" style="color:var(--P);font-size:11px"></i>' +
          '<span style="font-size:11px;font-weight:800;color:var(--tx)">' + _esc(dept) + '</span>' +
          '<span style="font-size:10px;color:var(--tx3)">(' + items.length + ')</span>' +
          '<i class="fas fa-chevron-down gc" style="margin-left:auto;font-size:10px;color:var(--tx3);transition:transform .2s;transform:rotate(180deg)"></i>' +
          '</div>' +
          '<div id="' + _esc(gid) + '">' +
          items.map(function (t) {
            var f = String(t.frequency || 'D');
            var fClr = _TS_FCLR[f] || 'var(--tx3)';
            var fLbl = _TS_FREQ[f] ? _TS_FREQ[f] + ' (' + f + ')' : f;
            var planDt = _fmtDTIST(t.day_date);                // dd/MMM/yyyy HH:mm:ss (IST)
            var chip = _tsPlanChip(t, planDt);
            var tid = 'tsi_' + t._i;                           // unique per task (never empty / duplicate)
            return '<div style="border:1px solid var(--bdr);border-radius:8px;margin-bottom:4px;background:var(--bg);overflow:hidden">' +
              '<div class="ts-task-hd" data-tid="' + tid + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer">' +
              '<div style="width:3px;height:28px;background:' + fClr + ';border-radius:2px;flex-shrink:0"></div>' +
              '<div style="flex:1;min-width:0">' +
              '<div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(t.task_name) + '</div>' +
              '<div style="font-size:10px;color:var(--tx3);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
              '<span><i class="fas fa-user" style="width:10px"></i> ' + _esc(t.emp_name || t.emp_id) + '</span>' +
              (chip ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:6px;background:var(--Pl);color:var(--P);font-weight:800;font-size:10px"><i class="fas fa-clock" style="font-size:9px"></i> ' + _esc(chip) + '</span>' : '') +
              '</div></div>' +
              '<span style="padding:2px 7px;border-radius:6px;font-size:10px;font-weight:800;background:var(--sur2);color:' + fClr + '">' + _esc(f) + '</span>' +
              '<i class="fas fa-chevron-down tc" style="color:var(--tx3);font-size:10px;transition:transform .2s;flex-shrink:0"></i>' +
              '</div>' +
              '<div id="' + tid + '" style="display:none;padding:12px 14px;border-top:1px solid var(--bdr);background:var(--sur2)">' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;font-size:11.5px;color:var(--tx2);margin-bottom:10px">' +
              cell('Task', t.task_name) +
              cell('Doer Name', t.emp_name) +
              cell('Doer ID', t.emp_id) +
              cell('Department', t.dept) +
              cell('Frequency', fLbl) +
              cell('Day/Date', planDt, 'color:var(--P)') +
              cell('Week Day', t.week_day) +
              cell('Month Day', t.month_day) +
              cell('Status', t.sheet_status) +
              cell('Delete Repeated Task', t.delete_repeated) +
              cell('Setup Task ID', t.task_uid, 'font-size:10px;color:var(--tx3)') +
              '</div>' +
              '<button type="button" class="btn btn-red btn-xs ts-deact-btn" data-uid="' + _esc(t.task_uid) + '"><i class="fas fa-trash-alt"></i> Deactivate Task</button>' +
              '</div></div>';
          }).join('') +
          '</div></div>';
      }).join('');

      // One delegated handler on the stable parent (no stacked listeners, no inline onclick)
      var root = document.getElementById('setupTaskList');
      if (root && !root._tsBound) {
        root._tsBound = true;
        root.addEventListener('click', function (e) {
          var db = e.target.closest('.ts-deact-btn');
          if (db) {
            e.preventDefault(); e.stopPropagation();
            _deactivateTask(db.getAttribute('data-uid') || '');
            return;
          }
          var dh = e.target.closest('.ts-dept-hd');
          if (dh) {
            var body = document.getElementById(dh.getAttribute('data-gid'));
            if (body) {
              var open = body.style.display !== 'none';
              body.style.display = open ? 'none' : '';
              var gc = dh.querySelector('.gc');
              if (gc) gc.style.transform = open ? '' : 'rotate(180deg)';
            }
            return;
          }
          var th = e.target.closest('.ts-task-hd');
          if (th) {
            var detail = document.getElementById(th.getAttribute('data-tid'));
            if (detail) {
              var open2 = detail.style.display !== 'none';
              detail.style.display = open2 ? 'none' : '';
              var tc = th.querySelector('.tc');
              if (tc) tc.style.transform = open2 ? '' : 'rotate(180deg)';
            }
          }
        });
      }
    }

    // Single definitions (old duplicate copies removed — the last duplicate used to win and break the list)
    function _tsRenderFiltered() {
      var el2 = document.getElementById('setupTaskList');
      if (!el2) return;
      if (!el2.querySelector('#tsTaskGroups')) {el2.innerHTML = ''; _tsRenderBar(el2);}
      _tsApplyFilter();
      setTimeout(function () {_initSearchSelects(el2);}, 50);
    }

    function _tsClearFilter() {
      var s = document.getElementById('tsSearch');
      var e = document.getElementById('tsEmp');
      var f = document.getElementById('tsFreq');
      if (s) s.value = '';
      if (e) e.value = e.options[0] ? e.options[0].value : 'all';
      if (f) f.value = 'all';
      ['tsEmp', 'tsFreq'].forEach(function (id) {
        var d = document.getElementById('ssd_' + id);
        var orig = document.getElementById(id);
        if (d && orig && orig.options[0]) {d.value = orig.options[0].text; d.placeholder = d.value;}
      });
      _tsApplyFilter();
    }

    function _setupExpandAll(expand) {
      var ct = document.getElementById('content');
      var scrollY = ct ? ct.scrollTop : 0;
      // Dept groups
      document.querySelectorAll('#setupTaskList [id^="stg_"]').forEach(function (g) {
        g.style.display = expand ? '' : 'none';
      });
      document.querySelectorAll('#setupTaskList .ts-dept-hd .gc').forEach(function (c) {
        c.style.transform = expand ? 'rotate(180deg)' : '';
      });
      // Task detail panels (id starts with tsi_)
      document.querySelectorAll('#setupTaskList [id^="tsi_"]').forEach(function (d) {
        d.style.display = expand ? '' : 'none';
      });
      document.querySelectorAll('#setupTaskList .ts-task-hd .tc').forEach(function (c) {
        c.style.transform = expand ? 'rotate(180deg)' : '';
      });
      requestAnimationFrame(function () { if (ct) ct.scrollTop = scrollY; });
    }

    function _csEmpChg(sel) {
      // Auto-populate email when employee selected
    }

    function _csFreqChg() {
      var freq = (document.getElementById('csFreq') || {}).value || 'D';
      var ex = document.getElementById('csFreqX');
      if (!ex) return;

      // Helper to get current time value
      function tRef() {
        var t = (document.getElementById('csTime') || {}).value || '10:00';
        return t;
      }

      if (freq === 'D') {
        ex.innerHTML =
          '<div style="font-size:12px;color:var(--tx2);padding:6px 0 2px">' +
          '<i class="fas fa-circle-info" style="color:var(--P)"></i>' +
          ' Every working day from start date — task time: <strong id="csTimeHintD">' + tRef() + '</strong></div>';

      } else if (freq === 'W') {
        ex.innerHTML =
          '<div class="fgrp"><label>Day of Week</label>' +
          '<select id="csDow">' +
          '<option value="1">Monday</option><option value="2">Tuesday</option>' +
          '<option value="3">Wednesday</option><option value="4">Thursday</option>' +
          '<option value="5">Friday</option><option value="6">Saturday</option>' +
          '<option value="0">Sunday</option>' +
          '</select></div>' +
          '<div style="font-size:11px;color:var(--tx3);margin-top:2px">' +
          '<i class="fas fa-clock"></i> Task time from the time field above</div>';

      } else if (freq === 'F') {
        ex.innerHTML =
          '<div style="font-size:12px;color:var(--tx2);padding:6px 0 2px">' +
          '<i class="fas fa-circle-info" style="color:var(--P)"></i>' +
          ' Every 2 weeks (fortnightly) from start date — task time: <strong>' + tRef() + '</strong></div>';

      } else if (['M', '2M', 'Q', '4M', 'H', 'Y'].indexOf(freq) > -1) {
        var freqLabels = {M: 'Monthly', '2M': 'Every 2 Months', Q: 'Quarterly', '4M': 'Every 4 Months', H: 'Half Yearly', Y: 'Yearly'};
        ex.innerHTML =
          '<div class="fgrp"><label>Day of Month (1–28) <span style="font-size:11px;color:var(--tx3)">— for ' + (freqLabels[freq] || freq) + '</span></label>' +
          '<input type="number" id="csDom" min="1" max="28" value="1" placeholder="e.g. 1 = 1st of every month"></div>' +
          '<div style="font-size:11px;color:var(--tx3);margin-top:2px">' +
          '<i class="fas fa-clock"></i> Task time from the time field above</div>';

      } else if (['E1st', 'E2nd', 'E3rd', 'E4th', 'ELast'].indexOf(freq) > -1) {
        var nth = {E1st: '1st', E2nd: '2nd', E3rd: '3rd', E4th: '4th', ELast: 'Last'};
        ex.innerHTML =
          '<div class="fgrp"><label>Day of Week <span style="font-size:11px;color:var(--tx3)">— ' + nth[freq] + ' occurrence each month</span></label>' +
          '<select id="csDow">' +
          '<option value="1">Monday</option><option value="2">Tuesday</option>' +
          '<option value="3">Wednesday</option><option value="4">Thursday</option>' +
          '<option value="5">Friday</option><option value="6">Saturday</option>' +
          '<option value="0">Sunday</option>' +
          '</select></div>' +
          '<div style="font-size:11px;color:var(--tx3);margin-top:2px">' +
          '<i class="fas fa-clock"></i> Task time from the time field above' +
          ' &nbsp;·&nbsp; e.g. ' + nth[freq] + ' Monday each month</div>';

      } else {
        ex.innerHTML = '';
      }
    }

    function _saveTask() {
      if (!_startSub('btnSaveTask')) return;

      var sel = document.getElementById('csEmp');
      var taskInp = document.getElementById('csTask');
      var freqSel = document.getElementById('csFreq');
      var startInp = document.getElementById('csStartDate');
      var timeInp = document.getElementById('csTime');

      var empId = sel ? sel.value.trim() : '';
      var empOpt = sel ? sel.options[sel.selectedIndex] : null;
      var empName = empOpt ? empOpt.text : '';
      var dept = empOpt ? (empOpt.getAttribute('data-dept') || '') : '';
      var email = empOpt ? (empOpt.getAttribute('data-email') || '') : '';
      var task = taskInp ? taskInp.value.trim() : '';
      var freq = freqSel ? freqSel.value : 'D';
      var startDate = startInp ? startInp.value : _today();
      var taskTime = timeInp ? (timeInp.value || '') : '';

      if (!_req(empId, 'Employee')) {_endSub('btnSaveTask'); return;}
      if (!_req(task, 'Task Name')) {_endSub('btnSaveTask'); return;}
      if (!_req(startDate, 'Start Date')) {_endSub('btnSaveTask'); return;}
      if (!taskTime) {_toast('Task Time is required — kitne bje karna hai?', 'warn'); _endSub('btnSaveTask'); return;}

      // Send datetime-local format so backend extracts date + time together
      var obj = {
        emp_id: empId,
        emp_name: empName.split(' (')[0],
        dept: dept,
        email: email,
        task_name: task,
        frequency: freq,
        start_date: startDate + 'T' + taskTime,   // e.g. "2026-08-10T10:30"
        task_time: taskTime                       // explicit time field
      };

      // Attach extra params based on frequency
      if (freq === 'W' || ['E1st', 'E2nd', 'E3rd', 'E4th', 'ELast'].indexOf(freq) > -1) {
        var dowEl = document.getElementById('csDow');
        if (dowEl) obj.day_of_week = Number(dowEl.value);
      }
      if (['M', '2M', 'Q', '4M', 'H', 'Y'].indexOf(freq) > -1) {
        var domEl = document.getElementById('csDom');
        if (domEl) obj.day_of_month = Number(domEl.value) || 1;
      }

      _gas('saveNewTask', [obj], function (r) {
        if (r && r.success) {
          _successSub('btnSaveTask', 'Added!');
          if (r.warn) {
            _toast('Task saved but checklist failed: ' + r.warn, 'warn');
          } else {
            var n = (r.rows !== undefined) ? r.rows : '?';
            _toast('✓ Task added · ' + n + ' checklist rows · ' + r.task_uid, 'ok');
          }
          if (taskInp) taskInp.value = '';
          if (startInp) startInp.value = _today();
          if (timeInp) timeInp.value = '';
          document.getElementById('csFreqX').innerHTML = '';
          // Force fresh load of Active Tasks (bypass cache)
          _D.deptTasks = null;
          _tsAddLocal(obj, r);          // appears on screen immediately
          _ckInvalidateCaches();
          _loadSetupTasks(true);        // silent confirm from server (no skeleton)
        } else {
          _endSub('btnSaveTask');
          _toast('Error: ' + (r && r.error ? r.error : 'Unknown error'), 'err');
        }
      }, function (e) {
        _endSub('btnSaveTask');
        _toast('Error: ' + e.message, 'err');
      });
    }


    function _tsReindex() {(window._tsAllTasks || []).forEach(function (x, n) {x._i = n;});}

    // Show a just-saved task at once (same fields the server will return); silent refresh confirms it.
    function _tsAddLocal(obj, r) {
      var uid = String((r && r.task_uid) || '').trim();
      if (!uid) return;
      var DN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      var f = String(obj.frequency || 'D');
      var sd = String(obj.start_date || '').slice(0, 10).split('-');
      var tm = String(obj.task_time || '').slice(0, 5);
      var dd = (sd.length === 3 && tm.indexOf(':') > 0) ? sd[2] + '/' + sd[1] + '/' + sd[0] + ' ' + tm + ':00' : '';
      var wd = '', md = '';
      if (['W', 'E1st', 'E2nd', 'E3rd', 'E4th', 'ELast'].indexOf(f) > -1) {
        var dow = obj.day_of_week !== undefined ? Number(obj.day_of_week) : (sd.length === 3 ? new Date(+sd[0], +sd[1] - 1, +sd[2]).getDay() : -1);
        wd = DN[dow] || '';
      } else if (['M', '2M', 'Q', '4M', 'H', 'Y'].indexOf(f) > -1) {
        md = String(obj.day_of_month !== undefined ? Number(obj.day_of_month) : (sd.length === 3 ? +sd[2] : ''));
      }
      var list = window._tsAllTasks || (window._tsAllTasks = []);
      list.unshift({
        task_uid: uid, task_name: obj.task_name || '', emp_id: String(obj.emp_id || ''), emp_name: obj.emp_name || '',
        dept: obj.dept || '', frequency: f, day_date: dd, day_label: dd, week_day: wd, month_day: md,
        sheet_status: (r && r.rows > 0) ? 'Sent' : 'Active', delete_repeated: ''
      });
      _tsReindex();
      _tsRenderFiltered();
    }

    // Deactivate: the task leaves the screen the moment you confirm; the server cleanup (Task List +
    // Checklist rows) runs behind it. If the server fails, the task is put back with an error.
    function _deactivateTask(uid) {
      uid = String(uid || '').trim();
      if (!uid || uid.indexOf('__row_') === 0) {
        _toast('Task UID missing -- cannot delete this row', 'err');
        return;
      }
      window._tsBusy = window._tsBusy || {};
      if (window._tsBusy[uid]) return;                       // double-click guard
      _openModal(
        '<i class="fas fa-trash" style="color:var(--R)"></i> Deactivate Task',
        '<p style="font-size:14px;color:var(--tx2);line-height:1.6">Remove this task from the recurring list? This cannot be undone. Future checklist rows will also be deleted.</p>' +
        '<div style="margin-top:8px;font-size:11px;color:var(--tx3)">UID: <code>' + _esc(uid) + '</code></div>',
        function () {
          _closeModal();
          var list = window._tsAllTasks || [], pos = -1, removed = null;
          for (var n = 0; n < list.length; n++) {
            if (String(list[n].task_uid || '') === uid) {pos = n; removed = list[n]; break;}
          }
          if (pos >= 0) {list.splice(pos, 1); _tsReindex(); _tsApplyFilter();}   // instant
          window._tsBusy[uid] = 1;
          _toast('<i class="fas fa-circle-notch fa-spin"></i> Deactivating task...', 'info');
          _gasX('deactivateTask', [uid], 90000, function (r) {
            delete window._tsBusy[uid];
            _toast('✓ Task deactivated — ' + ((r && r.checklistRowsDeleted) || 0) + ' checklist rows removed', 'ok');
            _ckInvalidateCaches();
            _loadSetupTasks(true);                                                // silent confirm
          }, function (e) {
            delete window._tsBusy[uid];
            if (removed) {                                                         // put it back
              var cur = window._tsAllTasks || (window._tsAllTasks = []);
              cur.splice(Math.min(pos, cur.length), 0, removed); _tsReindex(); _tsRenderFiltered();
            }
            _toast('Error: ' + ((e && e.message) || 'Deactivate failed') + ' — task restored', 'err');
          });
        },
        '<i class="fas fa-trash"></i> Deactivate'
      );
    }

    /* ══════════════════════════════════════════════════════════
       DELEGATION MODULE
    ══════════════════════════════════════════════════════════ */
    var TABS_DELEG = [
      {id: 'dmine', lbl: '<i class="fas fa-inbox"></i> Assigned to Me'},
      {id: 'dout', lbl: '<i class="fas fa-paper-plane"></i> Given by Me'},
      {id: 'dcr', lbl: '<i class="fas fa-plus"></i> Create New'},
      {id: 'dall', lbl: '<i class="fas fa-table"></i> All Tasks'}
    ];

    function _vDeleg() {
      var isManager = _isManager();
      var at = _ST || 'dmine';
      // Staff sees only "Assigned to Me"; Managers see all tabs
      var tabs = isManager
        ? TABS_DELEG
        : [{id: 'dmine', lbl: '<i class="fas fa-inbox"></i> Assigned to Me'}];

      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div><div class="mod-title">Delegation</div><div class="mod-sub">Task assignments, follow-ups & escalations</div></div>' +
        (isManager ? '<button class="btn btn-sm" onclick="_goDCr()"><i class="fas fa-plus"></i> Delegate Task</button>' : '') +
        '</div>' +
        _mkTabs(tabs, at) +
        _mkPanes(tabs, at, [
          '<div id="dminePane">' + _skel(3, 'sk-h5') + '</div>',
          (isManager ? '<div id="doutPane">' + _skel(3, 'sk-h5') + '</div>' : ''),
          (isManager ? '<div id="dcrPane">' + _dcrForm() + '</div>' : ''),
          (isManager ? '<div id="dallPane">' + _skel(3) + '</div>' : '')
        ]);

      if (isManager) _loadDelegDoers();
      if (at === 'dmine') _loadDMine();
      else if (at === 'dout' && isManager) _loadDOut();
      else if (at === 'dall' && isManager) _loadDAll();
      if (_ST) setTimeout(function () {_switchTab(_ST);}, 30);
    }

    function _loadDelegDoers() {
      var doers = _D.doers || _D.empDir || [];
      if (doers.length) {
        var sel = document.getElementById('dcrTo');
        if (sel) sel.innerHTML = '<option value="">-- Select Employee --</option>' +
          doers.map(function (d) {
            return '<option value="' + _esc(d.emp_id || d.user_id) + '" data-name="' + _esc(d.name) + '">' +
              _esc(d.name) + ' (' + _esc(d.department || d.dept || '') + ')</option>';
          }).join('');
        return;
      }
      _gas('getDoerList', [], function (doers) {
        _D.doers = doers || [];
        var sel = document.getElementById('dcrTo');
        if (sel) sel.innerHTML = '<option value="">-- Select Employee --</option>' +
          doers.map(function (d) {
            return '<option value="' + _esc(d.emp_id) + '" data-name="' + _esc(d.name || d.emp_id) + '">' +
              _esc(d.name || d.emp_id) + ' (' + _esc(d.department || '') + ')</option>';
          }).join('');
      }, function () { });
    }

    // ── Shared filter bar builder for Mine / Out panes ────────────────────
    function _dFilterBar(paneId) {
      var now = new Date();
      var ym = now.getFullYear() + '-' + (now.getMonth() + 1 < 10 ? '0' : '') + (now.getMonth() + 1);
      var dfrom = ym + '-01';
      var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      var dto = ym + '-' + (lastDay < 10 ? '0' : '') + lastDay;

      return '<div style="background:var(--sur2);border:1px solid var(--bdr);border-radius:12px;' +
        'padding:12px 14px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">' +

        // Search
        '<div style="position:relative;flex:1;min-width:160px;max-width:220px">' +
        '<i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--tx3);font-size:11px;pointer-events:none"></i>' +
        '<input type="text" id="' + paneId + 'Search" placeholder="Search tasks…" ' +
        'oninput="_dFilterSearch(\'' + paneId + '\',this.value)" ' +
        'style="width:100%;padding:7px 10px 7px 30px;border:1.5px solid var(--bdr);border-radius:8px;' +
        'font-size:12px;background:var(--bg);color:var(--tx);outline:none;box-sizing:border-box">' +
        '</div>' +

        // Divider
        '<div style="width:1px;height:28px;background:var(--bdr);flex-shrink:0"></div>' +

        // Status
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;white-space:nowrap">Status</span>' +
        '<select id="' + paneId + 'St" class="ana-sel" onchange="_dApplyFilter(\'' + paneId + '\')" style="min-width:110px">' +
        '<option value="All">All</option><option>Pending</option><option>Completed</option>' +
        '<option>Shifted</option><option>Overdue</option><option>Cancelled</option>' +
        '</select></div>' +

        // Due date range
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<span style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;white-space:nowrap">Due</span>' +
        '<input type="date" id="' + paneId + 'From" class="ana-sel" value="' + dfrom + '" ' +
        'onchange="_dApplyFilter(\'' + paneId + '\')" style="min-width:130px">' +
        '<span style="font-size:11px;color:var(--tx3)">→</span>' +
        '<input type="date" id="' + paneId + 'To" class="ana-sel" value="' + dto + '" ' +
        'onchange="_dApplyFilter(\'' + paneId + '\')" style="min-width:130px">' +
        '</div>' +

        // Actions
        '<div style="display:flex;gap:6px;margin-left:auto">' +
        '<button class="btn btn-sm btn-outline" onclick="_dClearFilter(\'' + paneId + '\')" title="Clear all filters">' +
        '<i class="fas fa-filter-circle-xmark"></i></button>' +
        '<button class="btn btn-sm" onclick="_dApplyFilter(\'' + paneId + '\')" title="Refresh">' +
        '<i class="fas fa-rotate-right"></i></button>' +
        '</div>' +

        '</div>' +
        '<div style="font-size:10px;color:var(--tx3);margin:-6px 2px 10px;display:flex;align-items:center;gap:4px">' +
        '<i class="fas fa-circle-info" style="color:var(--P)"></i>' +
        '<span>Date filter by <strong>Due Date</strong> (Final Date) — not delegation date</span></div>' +
        '<div id="' + paneId + 'List"></div>';
    }

    // Apply filter on Mine / Out panes (client-side on cached data)
    function _dApplyFilter(paneId) {
      var cache = paneId === 'dmine' ? _D.myDelegationsMine : _D.myDelegatedOut;
      var list = document.getElementById(paneId + 'List');
      var isOut = (paneId === 'dout');
      if (!cache || !list) return;

      var st = (document.getElementById(paneId + 'St') || {}).value || 'All';
      var from = (document.getElementById(paneId + 'From') || {}).value || '';
      var to = (document.getElementById(paneId + 'To') || {}).value || '';

      var filtered = cache.filter(function (d) {
        // Status filter
        if (st !== 'All') {
          var effStatus = d.is_overdue && d.status !== 'Completed' ? 'Overdue' : d.status;
          if (effStatus !== st) return false;
        }
        // Due date filter (Final Date) — normalize any date format to YYYY-MM-DD
        if (from || to) {
          var dueRaw = d.final_date || d.first_date || '';
          var due = '';
          if (dueRaw) {
            var pd = (typeof _parseAnyDate === 'function') ? _parseAnyDate(dueRaw) : null;
            if (pd && !isNaN(pd.getTime())) {
              due = pd.getFullYear() + '-' + String(pd.getMonth() + 1).padStart(2, '0') + '-' + String(pd.getDate()).padStart(2, '0');
            } else {
              due = String(dueRaw).slice(0, 10);
            }
          }
          if (from && due && due < from) return false;
          if (to && due && due > to) return false;
          if ((from || to) && !due) return false;
        }
        return true;
      });

      _renderDelegCardsEl(filtered, list, isOut);
    }

    function _dClearFilter(paneId) {
      var stEl = document.getElementById(paneId + 'St');
      var fromEl = document.getElementById(paneId + 'From');
      var toEl = document.getElementById(paneId + 'To');
      var srEl = document.getElementById(paneId + 'Search');
      if (stEl) stEl.value = 'All';
      if (fromEl) fromEl.value = '';
      if (toEl) toEl.value = '';
      if (srEl) srEl.value = '';
      // Also reset cached data so fresh load gets all records
      if (paneId === 'dmine') _D.myDelegationsMine = null;
      if (paneId === 'dout') _D.myDelegatedOut = null;
      if (paneId === 'dmine') _loadDMine();
      else if (paneId === 'dout') _loadDOut();
      else _dApplyFilter(paneId);
    }

    function _dFilterSearch(paneId, q) {
      q = (q || '').toLowerCase();
      var list = document.getElementById(paneId + 'List');
      if (!list) return;
      list.querySelectorAll('.dcard').forEach(function (c) {
        c.style.display = !q || c.textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none';
      });
    }

    function _loadDMine() {
      var pane = document.getElementById('dminePane');
      if (!pane) return;

      // Render filter bar first (always, so filters are available immediately)
      if (!document.getElementById('dmineFrom')) {
        pane.innerHTML = _dFilterBar('dmine');
      }

      var list = document.getElementById('dmineList');
      if (list) list.innerHTML = _skel(3, 'sk-h5');

      // Use cache if available — just re-apply filter
      // Naya (SWR):
      if (_D.myDelegationsMine) {
        _dApplyFilter('dmine');
        // background refresh continue karega neeche
      } else {
        if (list) list.innerHTML = _skel(3, 'sk-h5');
      }

      _gas('getMyDelegations', ['All'], function (dels) {
        _D.myDelegationsMine = dels;
        _lcSave();
        _dApplyFilter('dmine');
      }, function (e) {
        if (!_D.myDelegationsMine && list) list.innerHTML = e && e.message && e.message.indexOf('Network') > -1
          ? '<div style="text-align:center;padding:32px 16px"><div style="font-size:32px;margin-bottom:10px">📡</div>' +
          '<div style="font-size:14px;font-weight:800;color:var(--tx);margin-bottom:4px">Connection Error</div>' +
          '<button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>'
          : '<div class="te">' + _esc(e.message) + '</div>';
      });
    }

    function _loadDOut() {
      var pane = document.getElementById('doutPane');
      if (!pane) return;

      if (!document.getElementById('doutFrom')) {
        pane.innerHTML = _dFilterBar('dout');
      }

      var list = document.getElementById('doutList');
      if (list) list.innerHTML = _skel(3, 'sk-h5');

      // SWR: show cache instantly, then refresh
      if (_D.myDelegatedOut) {
        _dApplyFilter('dout');
      } else {
        if (list) list.innerHTML = _skel(3, 'sk-h5');
      }

      _gas('getMyDelegatedOut', ['All'], function (dels) {
        _D.myDelegatedOut = dels || [];
        _lcSave();
        _dApplyFilter('dout');
      }, function (e) {
        if (!_D.myDelegatedOut && list) list.innerHTML = e && e.message && e.message.indexOf('Network') > -1
          ? '<div style="text-align:center;padding:32px 16px"><div style="font-size:32px;margin-bottom:10px">📡</div>' +
          '<div style="font-size:14px;font-weight:800;color:var(--tx);margin-bottom:4px">Connection Error</div>' +
          '<button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>'
          : '<div class="te">' + _esc(e.message) + '</div>';
      });
    }
    function _loadDAll() {
      var pane = document.getElementById('dallPane');
      if (!pane) return;

      // If filters already exist (tab revisited), just reload data — don't re-render filter bar
      if (document.getElementById('dallFrom')) {
        _loadDAllFilter();
        return;
      }

      // Default date range: current month
      var now = new Date();
      var ym = now.getFullYear() + '-' + (now.getMonth() + 1 < 10 ? '0' : '') + (now.getMonth() + 1);
      var dfrom = ym + '-01';
      var lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      var dto = ym + '-' + (lastDay < 10 ? '0' : '') + lastDay;

      pane.innerHTML =
        '<div style="background:var(--sur2);border:1px solid var(--bdr);border-radius:12px;' +
        'padding:12px 14px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">' +

        // Search
        '<div style="position:relative;flex:1;min-width:140px;max-width:200px">' +
        '<i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--tx3);font-size:11px;pointer-events:none"></i>' +
        '<input type="text" id="dallSearch" placeholder="Search tasks…" oninput="_filterDAll(this.value)" ' +
        'style="width:100%;padding:7px 10px 7px 30px;border:1.5px solid var(--bdr);border-radius:8px;' +
        'font-size:12px;background:var(--bg);color:var(--tx);outline:none;box-sizing:border-box"></div>' +

        // Divider
        '<div style="width:1px;height:28px;background:var(--bdr);flex-shrink:0"></div>' +

        // Employee filter
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;white-space:nowrap">Person</span>' +
        '<select id="dallEmp" class="ana-sel" onchange="_loadDAllFilter()" style="min-width:130px">' +
        '<option value="all">All People</option>' + _getEmpOptions() +
        '</select></div>' +

        // Status
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;white-space:nowrap">Status</span>' +
        '<select id="dallSt" class="ana-sel" onchange="_loadDAllFilter()" style="min-width:110px">' +
        '<option value="All">All</option><option>Pending</option><option>Completed</option>' +
        '<option>Shifted</option><option>Cancelled</option>' +
        '</select></div>' +

        // Due date range
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<span style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;white-space:nowrap">Due</span>' +
        '<input type="date" id="dallFrom" class="ana-sel" value="' + dfrom + '" onchange="_loadDAllFilter()" style="min-width:128px">' +
        '<span style="font-size:11px;color:var(--tx3)">→</span>' +
        '<input type="date" id="dallTo" class="ana-sel" value="' + dto + '" onchange="_loadDAllFilter()" style="min-width:128px">' +
        '</div>' +

        // Actions
        '<div style="display:flex;gap:6px;margin-left:auto">' +
        '<button class="btn btn-sm btn-outline" onclick="_dallClearFilters()" title="Clear filters"><i class="fas fa-filter-circle-xmark"></i></button>' +
        '<button class="btn btn-sm" onclick="_loadDAllFilter()" title="Refresh"><i class="fas fa-rotate-right"></i></button>' +
        '</div>' +
        '</div>' +
        '<div style="font-size:10px;color:var(--tx3);margin:-6px 2px 10px;display:flex;align-items:center;gap:4px">' +
        '<i class="fas fa-circle-info" style="color:var(--P)"></i>' +
        '<span>Date filter by <strong>Due Date</strong> (Final Date) — not delegation date</span></div>' +
        '<div id="dallList">' + _skel(3) + '</div>';

      _loadDAllFilter();
    }

    function _dallClearFilters() {
      var f = document.getElementById('dallFrom');
      var t = document.getElementById('dallTo');
      var s = document.getElementById('dallSt');
      var emp = document.getElementById('dallEmp');
      if (f) f.value = '';
      if (t) t.value = '';
      if (s) s.value = 'All';
      if (emp) emp.value = 'all';
      // Also reset ss-wrap display text
      ['dallSt', 'dallEmp'].forEach(function (id) {
        var d = document.getElementById('ssd_' + id);
        if (d) {d.value = id === 'dallSt' ? 'All' : 'All People'; d.placeholder = d.value;}
      });
      _loadDAllFilter();
    }
    function _filterDAll(q) {
      q = (q || '').toLowerCase();
      document.querySelectorAll('.dcard').forEach(function (c) {
        c.style.display = !q || c.textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none';
      });
    }
    function _loadDAllFilter() {
      var st = (document.getElementById('dallSt') || {}).value || 'All';
      var from = (document.getElementById('dallFrom') || {}).value || '';
      var to = (document.getElementById('dallTo') || {}).value || '';
      var emp = (document.getElementById('dallEmp') || {}).value || 'all';
      var list = document.getElementById('dallList');
      if (!list) return;
      list.innerHTML = _skel(3);
      var filters = {status: st};
      if (from) filters.from_date = from;
      if (to) filters.to_date = to;
      if (emp && emp !== 'all') filters.delegated_to = emp;
      _gas('getAllDelegations', [filters], function (dels) {
        _D.allDels = dels;
        _renderDelegCardsEl(dels, list, true);
      }, function (e) {
        list.innerHTML = e && e.message && e.message.indexOf('Network') > -1
          ? '<div style="text-align:center;padding:32px 16px"><div style="font-size:32px;margin-bottom:10px">📡</div>' +
          '<div style="font-size:14px;font-weight:800;color:var(--tx);margin-bottom:4px">Connection Error</div>' +
          '<button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>'
          : '<div class="te">' + _esc(e.message) + '</div>';
      });
    }
    function _exportDelegAll() {
      var dels = _D.allDels || [];
      if (!dels.length) {_toast('No data to export', 'err'); return;}
      var rows = [['Task', 'Delegated To', 'Delegated By', 'First Date', 'Final Date', 'Status']];
      dels.forEach(function (d) {rows.push([d.task_desc, d.delegated_to_name, d.delegated_by_name, d.first_date, d.final_date, d.status]);});
      _downloadCSV('delegations_' + _today() + '.csv', rows);
    }

    function _renderDelegCards(dels, paneId, isOut) {
      var pane = document.getElementById(paneId);
      if (pane) _renderDelegCardsEl(dels, pane, isOut);
    }

    function _renderDelegCardsEl(dels, el, isOut) {
      // Remember last args so sort buttons can re-render
      _delLastArgs = {dels: dels, el: el, isOut: isOut};

      if (!dels || !dels.length) {
        el.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><h4>No Delegation Tasks</h4><p>Nothing to display here right now.</p></div>';
        return;
      }

      // Group: Overdue → Pending → Shifted → Cancelled → Completed
      var groups = [
        {key: 'overdue', label: 'Overdue', icon: 'fa-triangle-exclamation', color: 'var(--R)', items: []},
        {key: 'pending', label: 'Pending', icon: 'fa-hourglass-half', color: 'var(--O)', items: []},
        {key: 'shifted', label: 'Shifted', icon: 'fa-calendar-days', color: 'var(--V)', items: []},
        {key: 'cancelled', label: 'Cancelled', icon: 'fa-ban', color: 'var(--tx3)', items: []},
        {key: 'completed', label: 'Completed', icon: 'fa-check-circle', color: 'var(--G)', items: []}
      ];
      dels.forEach(function (d) {
        if (d.status === 'Completed') groups[4].items.push(d);
        else if (d.status === 'Cancelled') groups[3].items.push(d);
        else if (d.status === 'Shifted') groups[2].items.push(d);
        else if (d.is_overdue && d.status !== 'Completed') groups[0].items.push(d);
        else groups[1].items.push(d);
      });

      // Sort items inside each group
      groups.forEach(function (g) {
        g.items = _delSortItems(g.items);
      });

      var totalDone = groups[4].items.length;
      var totalOvr = groups[0].items.length;
      var totalAct = groups[1].items.length + groups[2].items.length;

      el.innerHTML =
        _delSortBarHtml() +
        // Summary chips
        '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center">' +
        '<div class="chip"><i class="fas fa-list"></i> ' + dels.length + '</div>' +
        '<div class="chip" style="background:var(--Gl);color:var(--G)"><i class="fas fa-check-circle"></i> ' + totalDone + '</div>' +
        '<div class="chip" style="background:var(--Ol);color:var(--O)"><i class="fas fa-hourglass"></i> ' + totalAct + '</div>' +
        (totalOvr > 0 ? '<div class="chip" style="background:var(--Rl);color:var(--R)"><i class="fas fa-triangle-exclamation"></i> ' + totalOvr + '</div>' : '') +
        '<div style="flex:1"></div>' +
        '<button class="btn btn-xs btn-outline" onclick="_delegExpandAll(true)"><i class="fas fa-expand-alt"></i> Expand All</button>' +
        '<button class="btn btn-xs btn-outline" onclick="_delegExpandAll(false)"><i class="fas fa-compress-alt"></i> Collapse All</button>' +
        '</div>' +
        // Groups
        groups.filter(function (g) {return g.items.length > 0;}).map(function (g) {
          var gid = 'dlg_grp_' + g.key;
          var defaultCollapsed = (g.key === 'completed' || g.key === 'cancelled');
          return '<div style="margin-bottom:14px">' +
            '<div style="display:flex;align-items:center;gap:8px;padding:7px 12px;background:var(--sur2);border-radius:8px;margin-bottom:6px;cursor:pointer;user-select:none" ' +
            'onclick="_delegGrpToggle(' + JSON.stringify(gid) + ')">' +
            '<i class="fas ' + g.icon + '" style="color:' + g.color + ';font-size:12px"></i>' +
            '<span style="font-size:12px;font-weight:800;color:' + g.color + '">' + g.label + '</span>' +
            '<span style="font-size:11px;color:var(--tx3);margin-left:4px">(' + g.items.length + ')</span>' +
            '<i class="fas fa-chevron-down dgc" id="dgc_' + gid + '" style="margin-left:auto;font-size:10px;color:var(--tx3);transition:transform .2s;' +
            (defaultCollapsed ? '' : 'transform:rotate(180deg)') + '"></i>' +
            '</div>' +
            '<div id="' + gid + '" style="display:' + (defaultCollapsed ? 'none' : '') + '">' +
            g.items.map(function (d, idx) {
              var effStatus = d.is_overdue && d.status !== 'Completed' ? 'Overdue' : d.status;
              var cardId = 'dcard_' + g.key + '_' + idx;
              var dl = _dl(d.final_date);
              var dlTxt = dl === null ? '' :
                dl < 0 ? '<span style="color:var(--R);font-weight:800"><i class="fas fa-triangle-exclamation"></i> Overdue by ' + Math.abs(dl) + 'd</span>' :
                  dl === 0 ? '<span style="color:var(--O);font-weight:800"><i class="fas fa-clock"></i> Due Today</span>' :
                    '<span style="color:var(--tx3)"><i class="fas fa-calendar"></i> Due in ' + dl + 'd</span>';
              return '<div class="dcard ' + g.key + '" id="' + cardId + '" style="margin-bottom:6px">' +
                '<div class="dc-top" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between" ' +
                'onclick="_delegToggle(\'' + cardId + '\')">' +
                '<div class="dc-desc" style="flex:1;padding-right:10px">' + _esc(d.task_desc) + '</div>' +
                '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">' +
                _statusBadge(effStatus) +
                '<i class="fas fa-chevron-down dc-chev" style="font-size:11px;color:var(--tx3);transition:transform .2s"></i>' +
                '</div>' +
                '</div>' +
                '<div class="dc-body" style="display:none">' +
                '<div class="dc-meta">' +
                (isOut
                  ? '<span><i class="fas fa-user-check"></i> To: <strong>' + _esc(d.delegated_to_name || d.delegated_to) + '</strong></span>'
                  : '<span><i class="fas fa-user"></i> By: <strong>' + _esc(d.delegated_by_name || d.delegated_by) + '</strong></span>') +
                '<span style="color:var(--P);font-weight:700"><i class="fas fa-calendar-plus" style="color:var(--P)"></i> <strong>Assigned:</strong> ' +
                (d.assigned_at ? _fmtDateTime(d.assigned_at) : _fmtDate(d.first_date)) + '</span>' +
                '<span style="color:var(--O);font-weight:700"><i class="fas fa-flag-checkered" style="color:var(--O)"></i> <strong>Due:</strong> ' +
                _fmtDate(d.final_date) + '</span>' +
                (d.status === 'Completed' && d.completed_at
                  ? '<span style="color:var(--G);font-weight:700"><i class="fas fa-check-circle" style="color:var(--G)"></i> <strong>Completed:</strong> ' +
                  _fmtDate(d.completed_at) + '</span>'
                  : (d.status !== 'Completed' ? '<span>' + dlTxt + '</span>' : '')) +
                (d.revision_1 ? '<span style="color:var(--V)"><i class="fas fa-calendar-days"></i> Rev1: ' + _fmtDate(d.revision_1) + '</span>' : '') +
                (d.revision_2 ? '<span style="color:var(--V)"><i class="fas fa-calendar-days"></i> Rev2: ' + _fmtDate(d.revision_2) + '</span>' : '') +
                (d.completion_remarks || d.remarks
                  ? '<div style="margin-top:6px;padding:6px 10px;background:var(--Il);border-radius:6px;font-size:11px;color:var(--I);display:flex;align-items:flex-start;gap:6px"><i class="fas fa-comment-dots" style="margin-top:1px;flex-shrink:0"></i><span>' +
                  _esc(d.completion_remarks || d.remarks) + '</span></div>'
                  : '') +
                '</div>' +
                '<div class="dc-act">' +
                (!isOut && d.status !== 'Completed' && d.status !== 'Cancelled'
                  ? '<button class="btn btn-green btn-sm" data-tid="' + _esc(d.task_id) + '" onclick="_dComplete(this)"><i class="fas fa-check"></i> Mark Complete</button>' +
                  '<button class="btn btn-outline btn-sm" data-tid="' + _esc(d.task_id) + '" onclick="_dShift(this)"><i class="fas fa-calendar-days"></i> Request Shift</button>'
                  : '') +
                (isOut && d.status !== 'Completed' && d.status !== 'Cancelled'
                  ? '<button class="btn btn-outline btn-sm" data-tid="' + _esc(d.task_id) + '" onclick="_dCancel(this)"><i class="fas fa-times"></i> Cancel</button>'
                  : '') +
                (_isMarkAttendanceAllowed() && isOut && d.status !== 'Completed' && d.status !== 'Cancelled'
                  ? '<button class="btn btn-green btn-sm" data-tid="' + _esc(d.task_id) + '" onclick="_dMgrComplete(this)"><i class="fas fa-check-double"></i> Mark Done</button>' +
                  '<button class="btn btn-sm" style="background:var(--Ol);color:var(--O);border:none" data-tid="' + _esc(d.task_id) + '" onclick="_dMgrShift(this)"><i class="fas fa-forward"></i> Shift</button>'
                  : '') +
                '</div>' +
                '</div>' +
                '</div>';
            }).join('') +
            '</div></div>';
        }).join('');
    }

    function _delegGrpToggle(gid) {
      var b = document.getElementById(gid);
      if (!b) return;
      var isHidden = b.style.display === 'none';
      b.style.display = isHidden ? '' : 'none';
      var ic = document.getElementById('dgc_' + gid);
      if (ic) ic.style.transform = isHidden ? 'rotate(180deg)' : '';
    }

    function _delegToggle(cardId) {
      var card = document.getElementById(cardId);
      if (!card) return;
      var body = card.querySelector('.dc-body');
      var chev = card.querySelector('.dc-chev');
      if (!body) return;
      var isHidden = body.style.display === 'none' || getComputedStyle(body).display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      if (chev) chev.style.transform = isHidden ? 'rotate(180deg)' : '';
    }

    function _delegExpandAll(expand) {
      document.querySelectorAll('[id^="dlg_grp_"]').forEach(function (g) {
        g.style.display = expand ? 'block' : 'none';
        var ic = document.getElementById('dgc_' + g.id);
        if (ic) ic.style.transform = expand ? 'rotate(180deg)' : '';
      });
      document.querySelectorAll('.dcard .dc-body').forEach(function (b) {
        b.style.display = expand ? 'block' : 'none';
      });
      document.querySelectorAll('.dcard .dc-chev').forEach(function (c) {
        c.style.transform = expand ? 'rotate(180deg)' : '';
      });
    }

    function _dMgrComplete(btn) {
      var tid = btn.getAttribute('data-tid');
      _openModal('<i class="fas fa-check-double" style="color:var(--G)"></i> Manager: Mark Task Done',
        '<div style="font-size:13.5px;color:var(--tx2);line-height:1.7;margin-bottom:12px">You are marking this task as completed on behalf of the assignee.</div>' +
        '<div><label style="font-size:12px;font-weight:800;color:var(--tx2);display:block;margin-bottom:4px">Completion Notes (optional)</label>' +
        '<input type="text" id="mgrCmplNotes" class="ana-sel" placeholder="Any notes..." style="width:100%"></div>',
        function () {
          var notes = (document.getElementById('mgrCmplNotes') || {}).value || '';
          _closeModal();
          _gas('managerCompleteDelegation', [tid, notes], function () {
            _toast('✓ Task marked as Completed', 'ok');
            _loadDOut();
          }, function (e) {_toast('Error: ' + e.message, 'err');});
        }, '<i class="fas fa-check-double"></i> Confirm Complete');
    }

    function _dMgrShift(btn) {
      var tid = btn.getAttribute('data-tid');
      _openModal('<i class="fas fa-forward" style="color:var(--O)"></i> Manager: Shift Due Date',
        '<div style="display:flex;flex-direction:column;gap:12px">' +
        '<div><label style="font-size:12px;font-weight:800;color:var(--tx2);display:block;margin-bottom:4px">New Due Date <span style="color:var(--R)">★</span></label>' +
        '<input type="date" id="mgrShiftDate" class="ana-sel" value="' + _tomorrow() + '" min="' + _today() + '" style="width:100%"></div>' +
        '<div><label style="font-size:12px;font-weight:800;color:var(--tx2);display:block;margin-bottom:4px">Reason</label>' +
        '<input type="text" id="mgrShiftReason" class="ana-sel" placeholder="Why shifting?" style="width:100%"></div>' +
        '</div>',
        function () {
          var newDate = (document.getElementById('mgrShiftDate') || {}).value || '';
          var reason = (document.getElementById('mgrShiftReason') || {}).value || '';
          if (!newDate) {_toast('Please select a new date', 'warn'); return;}
          _closeModal();
          _gas('managerShiftDelegation', [tid, newDate, reason], function () {
            _toast('✓ Task shifted to ' + newDate, 'ok');
            _loadDOut();
          }, function (e) {_toast('Error: ' + e.message, 'err');});
        }, '<i class="fas fa-forward"></i> Shift Task');
    }

    function _dComplete(btn) {
      var tid = btn.getAttribute('data-tid');
      _openModal(
        '<i class="fas fa-check-circle" style="color:var(--G)"></i> Mark as Completed',
        '<p style="font-size:14px;color:var(--tx2);line-height:1.6;margin-bottom:12px">Confirm task complete. Optional remark:</p>' +
        '<textarea id="delRemarkEl" rows="3" placeholder="Optional remark..." style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;background:var(--bg);color:var(--tx);outline:none;resize:vertical;font-family:inherit"></textarea>',
        function () {
          var remark = ((document.getElementById('delRemarkEl') || {}).value || '').trim();
          _closeModal();

          // ── Optimistic UI ──────────────────────────────────────
          var card = btn.closest('.card, .del-card, [data-tid]') || btn.parentElement;
          var prevHtml = btn.innerHTML;
          if (card) card.style.opacity = '0.55';
          btn.disabled = true;
          btn.innerHTML = '<i class="fas fa-check"></i> Completed';

          _gas('updateDelegationStatus', [tid, 'Completed', remark], function () {
            _toast('Marked as Completed!', 'ok');
            _addNtf('Delegation marked complete', 'fa-check-circle', 'var(--Gl)', 'var(--G)');
            delete _D.myDelegationsMine;
            delete _D.myDelegations;
            _loadDMine();
          }, function (e) {
            // Rollback
            if (card) card.style.opacity = '';
            btn.disabled = false;
            btn.innerHTML = prevHtml || '<i class="fas fa-check"></i> Mark Complete';
            _toast('Error: ' + ((e && e.message) || 'Failed'), 'err');
          });
        },
        '<i class="fas fa-check"></i> Complete'
      );
    }

    function _dReopen(btn) {
      var tid = btn.getAttribute('data-tid');
      _openModal(
        '<i class="fas fa-rotate-left" style="color:var(--O)"></i> Reopen Task',
        '<p style="font-size:14px;color:var(--tx2);line-height:1.6">Status wapas <b>Pending</b> ho jayega. Sirf aaj complete kiye tasks ke liye allowed hai.</p>' +
        '<textarea id="delRemarkEl" rows="2" placeholder="Optional reason..." style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;background:var(--bg);color:var(--tx);outline:none;resize:vertical;font-family:inherit;margin-top:10px"></textarea>',
        function () {
          var remark = ((document.getElementById('delRemarkEl') || {}).value || '').trim();
          _closeModal();
          _gas('updateDelegationStatus', [tid, 'Pending', remark], function () {
            _toast('Task reopened (Pending)', 'ok');
            _loadDMine();
          }, function (e) {
            var msg = (e && e.message) ? e.message : 'Error';
            if (msg.indexOf('DONE_LOCKED') > -1) {
              _toast('⚠️ Sirf aaj complete kiye tasks reopen ho sakte hain', 'warn');
            } else {
              _toast('❌ ' + msg, 'err');
            }
          });
        },
        '<i class="fas fa-rotate-left"></i> Reopen'
      );
    }

    function _dCancel(btn) {
      var tid = btn.getAttribute('data-tid');
      _openModal('<i class="fas fa-times" style="color:var(--R)"></i> Cancel Delegation',
        '<p style="font-size:14px;color:var(--tx2);line-height:1.6">Cancel this delegation? The task will be marked as Cancelled.</p>',
        function () {
          _closeModal();
          _gas('updateDelegationStatus', [tid, 'Cancelled'], function () {_toast('Delegation cancelled', 'ok'); _loadDOut();}, function (e) {_toast('Error: ' + e.message, 'err');});
        }, 'Cancel Task');
    }
    function _dShift(btn) {
      var tid = btn.getAttribute('data-tid');
      _openModal('<i class="fas fa-calendar-days" style="color:var(--V)"></i> Request Date Shift',
        '<p style="font-size:13px;color:var(--tx2);margin-bottom:14px;line-height:1.6">Request a new due date (max 2 revisions allowed):</p>' +
        '<div class="fgrp"><label>New Due Date <span class="req">★</span></label><input type="date" id="mNewDate" min="' + _today() + '" value="' + _daysLater(3) + '"></div>' +
        '<div class="fgrp" style="margin-top:12px"><label>Remark <span style="font-weight:400;color:var(--tx3)">(optional)</span></label>' +
        '<textarea id="mShiftRemark" rows="3" placeholder="Why do you need this shift?" style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;background:var(--bg);color:var(--tx);outline:none;resize:vertical;font-family:inherit;box-sizing:border-box"></textarea></div>' +
        '<div class="tip" style="margin-top:10px"><i class="fas fa-info-circle"></i> This request will be noted in the delegation record.</div>',
        function () {
          var nd = document.getElementById('mNewDate') ? document.getElementById('mNewDate').value : '';
          var remark = ((document.getElementById('mShiftRemark') || {}).value || '').trim();
          if (!nd) {_toast('Please select a date', 'err'); return;}
          _closeModal();
          // IMPORTANT: only 2 args before user — 3rd positional becomes "user" on backend and triggers logout
          // Pass remark inside date payload string marker only if backend ignores extras; primary call stays 2-arg
          var payloadDate = nd;
          _gas('requestDateRevision', [tid, payloadDate], function () {
            if (remark) {
              // Best-effort: attach remark without breaking auth (status stays as backend sets)
              _gas('updateDelegationStatus', [tid, 'Shifted', remark], function () {
                _toast('Date shift requested!', 'ok');
                _loadDMine();
              }, function () {
                _toast('Date shift requested!', 'ok');
                _loadDMine();
              });
            } else {
              _toast('Date shift requested!', 'ok');
              _loadDMine();
            }
          }, function (e) {_toast('Error: ' + ((e && e.message) || 'Failed'), 'err');});
        }, 'Request Shift');
    }
    function _dcrForm() {
      return '<div style="max-width:560px">' +
        '<div class="card card-nohover card-sm">' +
        '<div class="sec-title" style="margin-bottom:16px"><i class="fas fa-plus-circle" style="color:var(--P)"></i> Create New Delegation</div>' +
        '<div class="fgrp"><label>Assign To <span class="req">★</span></label><select id="dcrTo"><option value="">Loading employees...</option></select></div>' +
        '<div class="fgrp">' +
        '<label>Task Description <span class="req">★</span></label>' +
        '<textarea id="dcrDesc" placeholder="Describe the task clearly — include what needs to be done, any deliverables, and expected outcome..." rows="4" oninput="var cc=document.getElementById(\'dcrCC\');if(cc)cc.textContent=this.value.length+\' chars\'"></textarea>' +
        '<div class="char-count" id="dcrCC">0 chars</div>' +
        '</div>' +
        '<div class="frow">' +
        '<div class="fgrp"><label>Due Date <span class="req">★</span></label><input type="date" id="dcrDate" value="' + _daysLater(3) + '" min="' + _today() + '"></div>' +
        '<div class="fgrp"><label>Priority</label><select id="dcrPrio"><option value="Normal">Normal</option><option value="High">🔴 High (Urgent)</option><option value="Low">⚫ Low</option></select></div>' +
        '</div>' +
        '<button class="btn btn-wide" id="btnSaveDel" onclick="_saveDelegation()"><i class="fas fa-paper-plane"></i> Delegate Task</button>' +
        '</div>' +
        '</div>';
    }
    function _saveDelegation() {
      if (!_startSub('btnSaveDel')) return;
      var sel = document.getElementById('dcrTo');
      var desc = document.getElementById('dcrDesc') ? document.getElementById('dcrDesc').value.trim() : '';
      var date = document.getElementById('dcrDate') ? document.getElementById('dcrDate').value : '';
      var toId = sel ? sel.value : '';
      var toOpt = sel ? sel.options[sel.selectedIndex] : null;
      var toNm = toOpt ? toOpt.text : '';
      if (!_req(toId, 'Employee') || !_req(desc, 'Task Description') || !_req(date, 'Due Date')) {_endSub('btnSaveDel'); return;}
      if (desc.length < 10) {_toast('Task description too short (min 10 chars)', 'err'); _endSub('btnSaveDel'); return;}
      _gas('createDelegation', [{delegated_to: toId, delegated_to_name: toNm, task_desc: desc, first_date: date}], function (r) {
        _successSub('btnSaveDel', 'Delegated!');
        _toast('Delegation created: ' + r.task_id, 'ok');
        _addNtf('Task delegated to ' + toNm, 'fa-paper-plane', 'var(--Vl)', 'var(--V)', 'deleg');
        var descEl = document.getElementById('dcrDesc'); if (descEl) descEl.value = '';
        var dateEl = document.getElementById('dcrDate'); if (dateEl) dateEl.value = _daysLater(3);
        var ccEl = document.getElementById('dcrCC'); if (ccEl) ccEl.textContent = '0 chars';
      }, function (e) {_endSub('btnSaveDel'); _toast('Error: ' + e.message, 'err');});
    }
    function _goDCr() {_loadV('deleg', 'dcr');}
    function _goAttend() {_loadV('attend');}
    function _goCheck() {_loadV('check');}

    /* ══════════════════════════════════════════════════════════
       ATTENDANCE MODULE
    ══════════════════════════════════════════════════════════ */
    function _vAttend() {
      var needsAtt = !_U || _U.need_attendance !== false;
      var tabs = [], panes = [];

      if (needsAtt) {
        tabs.push({id: 'amy', lbl: '<i class="fas fa-user-clock"></i> My Attendance'});
        panes.push('<div id="amyPane">' + _amyForm() + '</div>');
      }
      tabs.push({id: 'areg', lbl: '<i class="fas fa-pen-to-square"></i> Regularize'});
      panes.push('<div id="aregPane">' + _aregForm() + '</div>');

      if (_isManager()) {
        tabs.push({id: 'arega', lbl: '<i class="fas fa-clipboard-check"></i> Reg. Approvals'});
        panes.push('<div id="aregaPane">' + _aregaForm() + '</div>');
        // Muster tab removed — now available in Attendance Analytics → Muster Grid view
      }
      if (_isMarkAttendanceAllowed()) {
        tabs.push({id: 'amteam', lbl: '<i class="fas fa-user-check"></i> Mark Team Attendance'});
        panes.push('<div id="amteamPane">' + _amTeamForm() + '</div>');
      }

      var at = _ST || (needsAtt ? 'amy' : 'areg');

      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div><div class="mod-title">Attendance & Leave</div>' +
        '<div class="mod-sub">Punch records, regularization & team attendance (incl. Week Off / PTO)</div></div></div>' +
        _mkTabs(tabs, at) + _mkPanes(tabs, at, panes);

      if (at === 'amy' && needsAtt) _loadMyAtt();
      else if (at === 'areg') _loadMyRegularizations();
      else if (at === 'arega' && _isManager()) _loadRegApprovals();
      else if (at === 'amteam' && _isMarkAttendanceAllowed()) _loadTeamAtt();
      if (_ST) setTimeout(function () {_switchTab(_ST);}, 30);
    }


    // Regularize form (employee self-regularization request)
    function _aregForm() {
      return '<div class="fbar">' +
        '<label>Month:</label><input type="month" id="aregMonth" value="' + _currMonth() + '">' +
        '<button class="btn btn-sm" onclick="_loadMyRegularizations()"><i class="fas fa-search"></i> Load</button>' +
        '<div class="fbar-spacer"></div>' +
        '<button class="btn btn-teal btn-sm" onclick="_openRegModal()"><i class="fas fa-plus"></i> New Request</button>' +
        '</div>' +
        '<div id="aregList">' + _skel(3) + '</div>';
    }


    /* ══════════════════════════════════════════════════════
       ATTENDANCE DETAILED VIEW — monthly grouping with
       expand/collapse per month, daily status rows.
    ══════════════════════════════════════════════════════ */
    function _adetailForm() {
      return '<div class="card card-nohover" style="padding:14px 18px;margin-bottom:14px">' +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:11.5px;font-weight:700;color:var(--tx2);white-space:nowrap">From</span>' +
        '<input type="date" id="adFrom" class="ana-sel" value="' + (_currMonth() + '-01') + '" style="min-width:130px"></div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:11.5px;font-weight:700;color:var(--tx2);white-space:nowrap">To</span>' +
        '<input type="date" id="adTo" class="ana-sel" value="' + _today() + '" style="min-width:130px"></div>' +
        (_isManager()
          ? '<div style="display:flex;align-items:center;gap:6px;min-width:200px;flex:1;max-width:280px">' +
          '<span style="font-size:11.5px;font-weight:700;color:var(--tx2);white-space:nowrap">Emp</span>' +
          '<div style="flex:1">' + _ssHtml('adEmp', '<option value="">My Attendance</option>' + _getEmpOptions(), 'My Attendance', '_loadAttDetail') + '</div>' +
          '</div>'
          : '') +
        '<div style="display:flex;align-items:center;gap:6px">' +
        '<span style="font-size:11.5px;font-weight:700;color:var(--tx2);white-space:nowrap">Status</span>' +
        '<select id="adStatus" class="ana-sel" onchange="_adApplyFilter()">' +
        '<option value="all">All</option><option value="Present">Present</option>' +
        '<option value="Half Day">Half Day</option><option value="Absent">Absent</option>' +
        '</select></div>' +
        '<button class="btn btn-sm" onclick="_loadAttDetail()" style="white-space:nowrap"><i class="fas fa-search"></i> Load</button>' +
        '<div style="flex:1"></div>' +
        '<button class="btn btn-xs btn-outline" onclick="_adExpandAll(true)" title="Expand All"><i class="fas fa-angles-down"></i></button>' +
        '<button class="btn btn-xs btn-outline" onclick="_adExpandAll(false)" title="Collapse All"><i class="fas fa-angles-right"></i></button>' +
        '</div></div>' +
        '<div id="adRoot">' + _skel(3, 'sk-h6') + '</div>';
    }

    var _adAllRecords = []; // full dataset for client-side filtering

    function _loadAttDetail() {
      var root = document.getElementById('adRoot');
      if (!root) return;
      root.innerHTML = _skel(3, 'sk-h6');
      var from = (document.getElementById('adFrom') || {}).value || (_currMonth() + '-01');
      var to = (document.getElementById('adTo') || {}).value || _today();
      var empId = _ssVal('adEmp') || (_U && _U.emp_code) || '';
      // Load the full month range
      var monthFrom = from.slice(0, 7);
      var monthTo = to.slice(0, 7);
      // For multi-month ranges, load each month separately and merge
      var months = [];
      var d = new Date(monthFrom + '-01');
      var end = new Date(monthTo + '-01');
      while (d <= end) {
        months.push(d.toISOString().slice(0, 7));
        d.setMonth(d.getMonth() + 1);
      }
      if (!months.length) months = [monthFrom];
      var allRecs = [], pending = months.length;
      months.forEach(function (m) {
        _gas('getMyAttendance', [empId || _U.emp_code, m], function (data) {
          var recs = (data && data.records ? data.records : []).filter(function (r) {
            var dt = String(r.date || ''); return dt >= from && dt <= to;
          });
          allRecs = allRecs.concat(recs);
          pending--;
          if (pending === 0) {
            allRecs.sort(function (a, b) {return String(a.date || '').localeCompare(String(b.date || ''));});
            _adAllRecords = allRecs;
            _adApplyFilter();
          }
        }, function (e) {pending--; if (pending === 0) _adApplyFilter();});
      });
    }

    function _adApplyFilter() {
      var root = document.getElementById('adRoot');
      if (!root) return;
      var stF = (document.getElementById('adStatus') || {}).value || 'all';
      var recs = stF === 'all' ? _adAllRecords : _adAllRecords.filter(function (r) {
        var s = r.status || '';
        if (stF === 'Present') return s === 'Present' || s === 'P';
        if (stF === 'Half Day') return s === 'Half Day' || s === 'HD';
        if (stF === 'Absent') return s === 'Absent' || s === 'A';
        return true;
      });
      if (!recs.length) {
        root.innerHTML = '<div class="empty-state" style="padding:32px;text-align:center">' +
          '<i class="fas fa-calendar-xmark" style="font-size:36px;opacity:.2;color:var(--P)"></i>' +
          '<div style="margin-top:10px;font-size:13px;color:var(--tx3);font-weight:600">No records found for selected filters.</div></div>';
        return;
      }
      _renderAttDetail(root, recs);
    }

    function _renderAttDetail(root, records) {
      // Group by month
      var months = {}, mOrder = [];
      records.forEach(function (r) {
        var m = String(r.date || '').slice(0, 7);
        if (!months[m]) {months[m] = []; mOrder.push(m);}
        months[m].push(r);
      });

      // Overall summary strip
      var totP = 0, totHD = 0, totA = 0;
      records.forEach(function (r) {
        var s = r.status || '';
        if (s === 'Present' || s === 'P') totP++;
        else if (s === 'Half Day' || s === 'HD') totHD++;
        else if (s === 'Absent' || s === 'A') totA++;
      });

      var html = '<div style="display:flex;gap:0;margin-bottom:16px;border-radius:12px;overflow:hidden;border:1px solid var(--bdr)">' +
        [['var(--G)', 'var(--Gl)', 'fa-circle-check', 'Present', totP],
        ['var(--O)', 'var(--Ol)', 'fa-circle-half-stroke', 'Half Day', totHD],
        ['var(--R)', 'var(--Rl)', 'fa-circle-xmark', 'Absent', totA],
        ['var(--P)', 'var(--Pl)', 'fa-calendar-days', 'Total', records.length]]
          .map(function (p) {
            return '<div style="flex:1;padding:12px 10px;text-align:center;background:' + p[1] + ';border-right:1px solid var(--bdr)">' +
              '<div style="font-size:22px;font-weight:900;color:' + p[0] + '">' + p[4] + '</div>' +
              '<div style="font-size:10px;font-weight:800;color:' + p[0] + ';text-transform:uppercase;opacity:.8">' +
              '<i class="fas ' + p[2] + '"></i> ' + p[3] + '</div></div>';
          }).join('') + '</div>';

      mOrder.forEach(function (m, mi) {
        var rows = months[m];
        var mP = 0, mHD = 0, mA = 0;
        rows.forEach(function (r) {
          var s = r.status || '';
          if (s === 'Present' || s === 'P') mP++;
          else if (s === 'Half Day' || s === 'HD') mHD++;
          else if (s === 'Absent' || s === 'A') mA++;
        });
        var mLbl = new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', {month: 'long', year: 'numeric'});
        var uid = 'adm' + mi;
        var open = mi === 0; // first month open

        html += '<div style="margin-bottom:12px;border-radius:14px;overflow:hidden;border:1px solid var(--bdr);box-shadow:var(--shad)">' +

          // ── Month header ─────────────────────────────────────────────
          '<div id="adh_' + uid + '" onclick="_adToggle(\'' + uid + '\')"' +
          ' style="display:flex;align-items:center;gap:12px;padding:13px 16px;background:var(--sur2);cursor:pointer;user-select:none;transition:background .15s"' +
          ' onmouseover="this.style.background=\'var(--Pl)\'" onmouseout="this.style.background=\'var(--sur2)\'">' +
          '<i id="adi_' + uid + '" class="fas fa-chevron-' + (open ? 'down' : 'right') + ' fa-fw" style="color:var(--P);font-size:12px"></i>' +
          '<span style="font-weight:900;font-size:15px;flex:1">' + mLbl + '</span>' +
          '<div style="display:flex;gap:12px;align-items:center">' +
          '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:800;color:var(--G)"><i class="fas fa-circle-check"></i>' + mP + ' Present</span>' +
          (mHD ? '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:800;color:var(--O)"><i class="fas fa-circle-half-stroke"></i>' + mHD + ' Half Day</span>' : '') +
          (mA ? '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:800;color:var(--R)"><i class="fas fa-circle-xmark"></i>' + mA + ' Absent</span>' : '') +
          '<span style="font-size:11px;color:var(--tx3);font-weight:600;background:var(--sur);padding:2px 8px;border-radius:6px;border:1px solid var(--bdr)">' + rows.length + ' days</span>' +
          '</div></div>' +

          // ── Days table ───────────────────────────────────────────────
          '<div id="' + uid + '" class="adm-body' + (open ? ' adm-open' : '') + '">' +
          '<table style="width:100%;border-collapse:collapse">' +
          '<thead><tr style="background:var(--bg)">' +
          '<th style="padding:10px 16px;font-size:11px;text-align:left;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.4px;width:100px;border-bottom:1px solid var(--bdr)">Date</th>' +
          '<th style="padding:10px 12px;font-size:11px;text-align:left;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.4px;width:90px;border-bottom:1px solid var(--bdr)">Day</th>' +
          '<th style="padding:10px 12px;font-size:11px;text-align:center;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.4px;width:90px;border-bottom:1px solid var(--bdr)">Status</th>' +
          '<th style="padding:10px 12px;font-size:11px;text-align:center;font-weight:800;color:var(--G);text-transform:uppercase;letter-spacing:.4px;width:80px;border-bottom:1px solid var(--bdr)"><i class="fas fa-sign-in-alt"></i> In</th>' +
          '<th style="padding:10px 12px;font-size:11px;text-align:center;font-weight:800;color:var(--R);text-transform:uppercase;letter-spacing:.4px;width:80px;border-bottom:1px solid var(--bdr)"><i class="fas fa-sign-out-alt"></i> Out</th>' +
          '<th style="padding:10px 16px;font-size:11px;text-align:center;font-weight:800;color:var(--P);text-transform:uppercase;letter-spacing:.4px;width:80px;border-bottom:1px solid var(--bdr)"><i class="fas fa-clock"></i> Hours</th>' +
          '</tr></thead><tbody>' +
          rows.map(function (r, ri) {
            var isP = r.status === 'Present' || r.status === 'P';
            var isHD = r.status === 'Half Day' || r.status === 'HD';
            var isA = r.status === 'Absent' || r.status === 'A';
            var isWO = r.status === 'Week Off' || r.status === 'WO';
            var stBg = isP ? 'var(--Gl)' : isHD ? 'var(--Ol)' : isA ? 'var(--Rl)' : isWO ? 'var(--sur2)' : 'var(--sur2)';
            var stFc = isP ? 'var(--G)' : isHD ? 'var(--O)' : isA ? 'var(--R)' : isWO ? 'var(--tx3)' : 'var(--tx3)';
            var stLbl = isP ? 'Present' : isHD ? 'Half Day' : isA ? 'Absent' : isWO ? 'Week Off' : (r.status || '—');
            var ci = (!r.check_in || r.check_in === '-' || r.check_in === 'undefined') ? '—' : r.check_in;
            var co = (!r.check_out || r.check_out === '-' || r.check_out === 'undefined') ? '—' : r.check_out;
            var hr = (!r.total_hours || r.total_hours === '-' || r.total_hours === 'undefined') ? '—' : r.total_hours;
            var rowBg = ri % 2 === 0 ? 'var(--bg)' : 'var(--sur2)';
            return '<tr style="background:' + rowBg + ';transition:background .1s" onmouseover="this.style.background=\'var(--Pl)\'" onmouseout="this.style.background=\'' + rowBg + '\'">' +
              '<td style="padding:10px 16px;font-weight:800;font-size:13px">' + _fmtDateShort(r.date) + '</td>' +
              '<td style="padding:10px 12px;font-size:12px;color:var(--tx2);font-weight:600">' + _esc(r.day_name || r.day || '') + '</td>' +
              '<td style="padding:10px 12px;text-align:center"><span style="display:inline-block;padding:3px 10px;border-radius:7px;font-size:11px;font-weight:800;background:' + stBg + ';color:' + stFc + '">' + stLbl + '</span></td>' +
              '<td style="padding:10px 12px;text-align:center;font-weight:800;font-size:13px;color:' + (ci === '—' ? 'var(--tx3)' : 'var(--G)') + '">' + _esc(ci) + '</td>' +
              '<td style="padding:10px 12px;text-align:center;font-weight:800;font-size:13px;color:' + (co === '—' ? 'var(--tx3)' : 'var(--R)') + '">' + _esc(co) + '</td>' +
              '<td style="padding:10px 16px;text-align:center;font-weight:800;font-size:13px;color:' + (hr === '—' ? 'var(--tx3)' : 'var(--P)') + '">' + _esc(hr) + '</td>' +
              '</tr>';
          }).join('') +
          '</tbody></table></div>' +
          '</div>';
      });

      root.innerHTML = html;
    }

    function _adToggle(uid) {
      var b = document.getElementById(uid), ic = document.getElementById('adi_' + uid);
      var hd = document.getElementById('adh_' + uid);
      if (!b) return;
      var open = b.classList.toggle('adm-open');
      if (ic) ic.className = 'fas fa-chevron-' + (open ? 'down' : 'right') + ' fa-fw';
    }
    function _adExpandAll(exp) {
      document.querySelectorAll('.adm-body').forEach(function (b) {b.classList.toggle('adm-open', exp);});
      document.querySelectorAll('[id^="adi_adm"]').forEach(function (i) {i.className = 'fas fa-chevron-' + (exp ? 'down' : 'right') + ' fa-fw';});
    }

    /* ══════════════════════════════════════════════════════════════════
       MARK TEAM ATTENDANCE
       OWNER / MANAGER / COORDINATOR can mark attendance for staff who
       have NeedAttendance = Yes and haven't punched in yet today.
    ══════════════════════════════════════════════════════════════════ */
    /* ══════════════════════════════════════════════════════════════════
       MARK TEAM ATTENDANCE — OWNER / MANAGER / COORDINATOR
       Key design: filter bar is rendered ONCE and never re-rendered,
       so filter values persist. Only the staff list refreshes.
       Groups by Department with expand/collapse per dept.
       Sort by: Name | Dept | Check-in | Status.
       Each staff row: IN time + OUT time + Status + Mark button.
    ══════════════════════════════════════════════════════════════════ */
    function _amTeamForm() {
      return '<div id="amteamRoot"><div style="padding:32px;text-align:center;color:var(--tx3)"><i class="fas fa-spinner fa-spin" style="font-size:24px;opacity:.3"></i></div></div>';
    }

    var _teamAttData = [];
    var _teamAttDate = '';
    var _teamAttSort = {key: 'name', dir: 1};

    function _loadTeamAtt() {
      var root = document.getElementById('amteamRoot');
      if (!root) return;
      // Preserve selected date (Edit may set back-date); fall back to date input or today
      var existingDate = (document.getElementById('tamDate') || {}).value || _teamAttDate || _today();
      _teamAttDate = existingDate || _today();

      // Render the stable frame (filter bar + stat strip + list container)
      var curTime = _nowTime();
      root.innerHTML =
        // ── Filter bar (rendered ONCE — never re-rendered on filter change) ──
        '<div id="tamFilters" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px;padding:10px 14px;background:var(--sur2);border-radius:12px;border:1px solid var(--bdr)">' +
        '<input type="date" id="tamDate" class="ana-sel" style="max-width:132px" value="' + _teamAttDate + '">' +
        '<div style="width:1px;height:24px;background:var(--bdr);flex-shrink:0"></div>' +
        '<select id="tamDept" class="ana-sel" style="min-width:130px"><option value="all">All Departments</option></select>' +
        '<select id="tamShow" class="ana-sel" style="min-width:160px">' +
        '<option value="action">Needs Action (IN or OUT pending)</option>' +
        '<option value="unmarked">Not Marked Only</option>' +
        '<option value="noout">Marked — No Check-out</option>' +
        '<option value="complete">Fully Complete</option>' +
        '<option value="all">All Staff</option>' +
        '</select>' +
        '<input type="text" id="tamSearch" class="ana-sel" placeholder="Search name..." style="min-width:150px">' +
        '<div style="flex:1"></div>' +
        '<button class="btn btn-sm" onclick="_tamReload()" style="white-space:nowrap"><i class="fas fa-rotate-right"></i> Reload</button>' +
        '</div>' +

        // ── Sort + expand/collapse toolbar ──────────────────────────────
        '<div id="tamSortBar" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">' +
        '<span style="font-size:10.5px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px;white-space:nowrap">Sort:</span>' +
        '<button id="tsb_name"   onclick="_tamSort(\'name\')"   class="tsb tsb-active" style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--P);background:var(--Pl);color:var(--P)">Name ↑</button>' +
        '<button id="tsb_dept"   onclick="_tamSort(\'dept\')"   class="tsb"            style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx2)"><i class="fas fa-building" style="font-size:10px"></i> Dept</button>' +
        '<button id="tsb_checkin" onclick="_tamSort(\'checkin\')" class="tsb"          style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx2)"><i class="fas fa-clock" style="font-size:10px"></i> Check-in</button>' +
        '<button id="tsb_status" onclick="_tamSort(\'status\')" class="tsb"            style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx2)"><i class="fas fa-circle-check" style="font-size:10px"></i> Status</button>' +
        '<div style="width:1px;height:22px;background:var(--bdr);flex-shrink:0;margin:0 2px"></div>' +
        '<button onclick="_tamExpandAll(true)"  style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx2)"><i class="fas fa-angles-down" style="font-size:10px"></i> Expand All</button>' +
        '<button onclick="_tamExpandAll(false)" style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx2)"><i class="fas fa-angles-right" style="font-size:10px"></i> Collapse All</button>' +
        '</div>' +

        // ── Summary stats ────────────────────────────────────────────────
        '<div id="tamStats" style="display:flex;gap:8px;margin-bottom:12px"></div>' +

        // ── Bulk mark bar ────────────────────────────────────────────────
        '<div id="tamBulkBar" style="display:none;align-items:center;gap:8px;margin-bottom:12px;padding:10px 14px;background:var(--Pl);border-radius:10px;border:1px solid var(--bdr2)">' +
        '<i class="fas fa-bolt" style="color:var(--P)"></i>' +
        '<span id="tamBulkLbl" style="font-size:13px;font-weight:700;color:var(--P);flex:1"></span>' +
        '<input type="time" id="tamBulkIn"  value="' + curTime + '" style="padding:5px 8px;border-radius:7px;border:1.5px solid var(--bdr2);background:var(--bg);font-size:12px;color:var(--tx)">' +
        '<input type="time" id="tamBulkOut" placeholder="Out (opt)" style="padding:5px 8px;border-radius:7px;border:1.5px solid var(--bdr2);background:var(--bg);font-size:12px;color:var(--tx)">' +
        '<button onclick="_tamMarkAll()" style="padding:6px 14px;border-radius:8px;background:var(--P);color:#fff;font-size:12px;font-weight:800;border:none;cursor:pointer;white-space:nowrap"><i class="fas fa-check-double"></i> Mark All Present</button>' +
        '</div>' +

        // ── Staff list ───────────────────────────────────────────────────
        '<div id="tamList">' + _skel(3) + '</div>';

      // Populate dept filter then load data
      _gas('getTeamAttendanceStatus', [_teamAttDate], function (rows) {
        _teamAttData = rows || [];
        // Populate dept options
        var depts = _teamAttData.reduce(function (acc, r) {
          if (r.dept && acc.indexOf(r.dept) < 0) acc.push(r.dept);
          return acc;
        }, []).sort();
        var sel = document.getElementById('tamDept');
        if (sel) {
          sel.innerHTML = '<option value="all">All Departments</option>' +
            depts.map(function (d) {return '<option value="' + _esc(d) + '">' + _esc(d) + '</option>';}).join('');
        }
        // Wire up event listeners AFTER render
        ['tamDate', 'tamDept', 'tamShow', 'tamSearch'].forEach(function (id) {
          var el = document.getElementById(id);
          if (!el) return;
          el.addEventListener('change', _renderTeamList);
          el.addEventListener('input', _renderTeamList);
        });
        _renderTeamList();
      }, function (e) {
        var l = document.getElementById('tamList');
        if (l) l.innerHTML = '<div class="te"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) + '</div>';
      });
    }

    function _renderTeamList() {
      var list = document.getElementById('tamList');
      if (!list) return;

      var date = (document.getElementById('tamDate') || {}).value || _teamAttDate;
      var dept = (document.getElementById('tamDept') || {}).value || 'all';
      var showF = (document.getElementById('tamShow') || {}).value || 'action';
      var q = ((document.getElementById('tamSearch') || {}).value || '').toLowerCase().trim();

      // Update stats
      var totAll = _teamAttData.length;
      var totMarked = _teamAttData.filter(function (r) {return r.marked;}).length;
      var totUnmark = totAll - totMarked;
      var totNoOut = _teamAttData.filter(function (r) {return r.needs_checkout;}).length;
      var statsEl = document.getElementById('tamStats');
      if (statsEl) {
        statsEl.innerHTML =
          '<div style="flex:1;padding:10px;background:var(--Gl);border-radius:10px;text-align:center"><div style="font-size:20px;font-weight:900;color:var(--G)">' + totMarked + '</div><div style="font-size:10px;font-weight:800;color:var(--G);text-transform:uppercase">Marked IN</div></div>' +
          '<div style="flex:1;padding:10px;background:#fef3c7;border-radius:10px;text-align:center"><div style="font-size:20px;font-weight:900;color:#d97706">' + totNoOut + '</div><div style="font-size:10px;font-weight:800;color:#d97706;text-transform:uppercase">No OUT</div></div>' +
          '<div style="flex:1;padding:10px;background:var(--Rl);border-radius:10px;text-align:center"><div style="font-size:20px;font-weight:900;color:var(--R)">' + totUnmark + '</div><div style="font-size:10px;font-weight:800;color:var(--R);text-transform:uppercase">Not Marked</div></div>' +
          '<div style="flex:1;padding:10px;background:var(--Pl);border-radius:10px;text-align:center"><div style="font-size:20px;font-weight:900;color:var(--P)">' + totAll + '</div><div style="font-size:10px;font-weight:800;color:var(--P);text-transform:uppercase">Total</div></div>';
      }

      // Filter — default "action" keeps IN-without-OUT visible
      var rows = _teamAttData.filter(function (r) {
        if (dept !== 'all' && r.dept !== dept) return false;
        if (showF === 'action' && r.marked && !r.needs_checkout) return false;
        if (showF === 'unmarked' && r.marked) return false;
        if (showF === 'noout' && !r.needs_checkout) return false;
        if (showF === 'complete' && !r.complete) return false;
        if (showF === 'marked' && !r.marked) return false;
        if (q && (r.name + ' ' + r.dept).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });

      // Sort
      rows = rows.slice().sort(function (a, b) {
        var va, vb;
        if (_teamAttSort.key === 'dept') {va = a.dept || ''; vb = b.dept || '';}
        else if (_teamAttSort.key === 'checkin') {va = a.check_in || '99:99'; vb = b.check_in || '99:99';}
        else if (_teamAttSort.key === 'status') {va = a.status || 'zzz'; vb = b.status || 'zzz';}
        else {va = a.name || ''; vb = b.name || '';}
        va = va.toLowerCase(); vb = vb.toLowerCase();
        return va < vb ? -_teamAttSort.dir : va > vb ? _teamAttSort.dir : 0;
      });

      // Update bulk bar
      var unmarkedFilt = rows.filter(function (r) {return !r.marked;});
      var bulkBar = document.getElementById('tamBulkBar');
      var bulkLbl = document.getElementById('tamBulkLbl');
      if (bulkBar) {
        if (unmarkedFilt.length && (showF === 'unmarked' || showF === 'all' || showF === 'action')) {
          bulkBar.style.display = 'flex';
          if (bulkLbl) bulkLbl.textContent = unmarkedFilt.length + ' unmarked staff — mark all as Present?';
        } else {
          bulkBar.style.display = 'none';
        }
      }

      if (!rows.length) {
        list.innerHTML = '<div class="empty-state" style="padding:28px;text-align:center">' +
          '<i class="fas fa-user-check" style="font-size:32px;opacity:.15;color:var(--G)"></i>' +
          '<div style="margin-top:10px;font-size:14px;color:var(--tx3);font-weight:600">' +
          (showF === 'action' || showF === 'unmarked' ? 'All staff have complete attendance ✓' : 'No staff match this filter') +
          '</div></div>';
        return;
      }

      var curTime = _nowTime();

      // Group by dept
      var byDept = {}, deptOrder = [];
      rows.forEach(function (r) {
        var d = r.dept || 'Other';
        if (!byDept[d]) {byDept[d] = []; deptOrder.push(d);}
        byDept[d].push(r);
      });

      var html = deptOrder.map(function (d, di) {
        var dRows = byDept[d];
        var dMarked = dRows.filter(function (r) {return r.marked;}).length;
        var dUnmark = dRows.length - dMarked;
        var uid = 'tam_d' + di;
        var open = true;

        var dHtml = '<div style="margin-bottom:10px;border-radius:12px;overflow:hidden;border:1px solid var(--bdr2)">' +
          // Dept header
          '<div id="tamh_' + uid + '" onclick="_tamToggle(\'' + uid + '\')" style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--sur2);cursor:pointer;user-select:none;border-bottom:1px solid var(--bdr)">' +
          '<i id="tami_' + uid + '" class="fas fa-chevron-down fa-fw" style="color:var(--P);font-size:11px"></i>' +
          '<span style="font-weight:800;font-size:14px;flex:1">' + _esc(d) + '</span>' +
          '<div style="display:flex;gap:6px;align-items:center">' +
          (dMarked ? '<span style="padding:2px 8px;border-radius:12px;background:var(--Gl);color:var(--G);font-size:10.5px;font-weight:800">' + dMarked + ' Marked</span>' : '') +
          (dUnmark ? '<span style="padding:2px 8px;border-radius:12px;background:var(--Rl);color:var(--R);font-size:10.5px;font-weight:800">' + dUnmark + ' Pending</span>' : '') +
          '<span style="font-size:11px;color:var(--tx3);font-weight:600">' + dRows.length + ' staff</span>' +
          '</div></div>' +
          '<div id="' + uid + '" class="adm-body adm-open">';

        dHtml += dRows.map(function (r, ri) {
          var marked = r.marked;
          var initials = (r.name || '?').split(' ').map(function (w) {return w[0] || '';}).slice(0, 2).join('').toUpperCase();
          var stBg = r.status === 'P' ? 'var(--Gl)' : r.status === 'HD' ? 'var(--Ol)' : r.status === 'A' ? 'var(--Rl)' : 'var(--sur2)';
          var stFc = r.status === 'P' ? 'var(--G)' : r.status === 'HD' ? 'var(--O)' : r.status === 'A' ? 'var(--R)' : 'var(--tx3)';
          var stLbl = r.status === 'P' || r.status === 'Present' ? 'Present' : r.status === 'HD' || r.status === 'Half Day' ? 'Half Day' : r.status === 'A' || r.status === 'Absent' ? 'Absent' : r.status === 'WO' || r.status === 'Week Off' ? 'Week Off' : r.status === 'PTO' ? 'PTO' : (r.status || '—');
          var rowBg = ri % 2 === 0 ? 'var(--bg)' : 'var(--sur2)';

          return '<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;background:' + rowBg + ';border-top:' + (ri > 0 ? '1px solid var(--bdr)' : 'none') + ';transition:background .1s" onmouseover="this.style.background=\'var(--Pl)\'" onmouseout="this.style.background=\'' + rowBg + '\'">' +
            // Avatar
            '<div style="width:38px;height:38px;border-radius:50%;background:var(--Pl);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;color:var(--P);flex-shrink:0">' + _esc(initials) + '</div>' +
            // Name + role
            '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:800;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(r.name) + '</div>' +
            '<div style="font-size:11px;color:var(--tx3)">' + _esc(r.role) + (r.phone ? '  ·  ' + _esc(r.phone) : '') + '</div>' +
            '</div>' +
            // Actions column — clean alignment
            '<div class="tam-actions" style="display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;flex-shrink:0">' +
            (marked && !r.needs_checkout
              ? '<span style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:800;background:' + stBg + ';color:' + stFc + '">' +
                (stLbl === '—' ? 'Done' : stLbl) + '</span>' +
              (r.check_in ? '<span style="font-size:12px;font-weight:700;color:var(--G)"><i class="fas fa-arrow-right-to-bracket"></i> ' + _esc(r.check_in) + '</span>' : '') +
              (r.check_out ? '<span style="font-size:12px;font-weight:700;color:var(--R)"><i class="fas fa-arrow-right-from-bracket"></i> ' + _esc(r.check_out) + '</span>' : '') +
              '<i class="fas fa-circle-check" style="color:var(--G);font-size:14px"></i>' +
              '<button type="button" class="tam-btn" onclick="_tamEdit(\'' + _esc(r.emp_id) + '\',\'' + _esc(r.name) + '\',\'' + _esc(d) + '\',\'' + _esc(r.check_in || '') + '\',\'' + _esc(r.check_out || '') + '\',\'' + _esc(r.status || 'P') + '\')" style="padding:6px 10px;border-radius:8px;background:var(--sur);color:var(--P);font-size:12px;font-weight:700;border:1.5px solid var(--bdr);cursor:pointer;margin-left:6px"><i class="fas fa-pen"></i> Edit</button>'
              : marked && r.needs_checkout
              ? '<span style="padding:4px 10px;border-radius:20px;font-size:11px;font-weight:800;background:#fef3c7;color:#d97706">OUT pending</span>' +
              (r.check_in ? '<span style="font-size:12px;font-weight:700;color:var(--G)"><i class="fas fa-arrow-right-to-bracket"></i> ' + _esc(r.check_in) + '</span>' : '') +
              '<input type="hidden" id="ti_' + r.emp_id + '" value="' + _esc(r.check_in || '') + '">' +
              '<input type="time" id="to_' + r.emp_id + '" value="' + curTime + '" class="tam-time" style="padding:5px 8px;border-radius:8px;border:1.5px solid var(--bdr);background:var(--bg);font-size:12px;color:var(--tx);min-width:100px">' +
              '<select id="st_' + r.emp_id + '" class="tam-sel" style="padding:5px 8px;border-radius:8px;border:1.5px solid var(--bdr);background:var(--bg);font-size:12px;color:var(--tx)">' +
              '<option value="P"' + (r.status === 'P' || r.status === 'Present' ? ' selected' : '') + '>Present</option>' +
              '<option value="HD"' + (r.status === 'HD' || r.status === 'Half Day' ? ' selected' : '') + '>Half Day</option>' +
              '<option value="A"' + (r.status === 'A' || r.status === 'Absent' ? ' selected' : '') + '>Absent</option>' +
              '<option value="WO"' + (r.status === 'WO' || r.status === 'Week Off' ? ' selected' : '') + '>Week Off</option>' +
              '<option value="PTO"' + (r.status === 'PTO' ? ' selected' : '') + '>PTO</option>' +
              '</select>' +
              '<button id="mb_' + r.emp_id + '" class="tam-btn" onclick="_tamMark1(\'' + _esc(r.emp_id) + '\',\'' + _esc(r.name) + '\',\'' + _esc(d) + '\')" style="padding:6px 14px;border-radius:8px;background:#d97706;color:#fff;font-size:12px;font-weight:800;border:none;cursor:pointer;white-space:nowrap"><i class="fas fa-sign-out-alt"></i> Mark OUT</button>' + '<button type="button" class="tam-btn" onclick="_tamEdit(\'' + _esc(r.emp_id) + '\',\'' + _esc(r.name) + '\',\'' + _esc(d) + '\')" style="padding:6px 10px;border-radius:8px;background:var(--sur);color:var(--P);font-size:12px;font-weight:700;border:1.5px solid var(--bdr);cursor:pointer"><i class="fas fa-pen"></i></button>'
              : '<input type="time" id="ti_' + r.emp_id + '" value="' + curTime + '" class="tam-time" style="padding:5px 8px;border-radius:8px;border:1.5px solid var(--bdr);background:var(--bg);font-size:12px;color:var(--tx);min-width:100px" title="Check-in">' +
              '<input type="time" id="to_' + r.emp_id + '" class="tam-time" style="padding:5px 8px;border-radius:8px;border:1.5px solid var(--bdr);background:var(--bg);font-size:12px;color:var(--tx);min-width:100px" title="Check-out">' +
              '<select id="st_' + r.emp_id + '" class="tam-sel" style="padding:5px 8px;border-radius:8px;border:1.5px solid var(--bdr);background:var(--bg);font-size:12px;color:var(--tx)">' +
              '<option value="P">Present</option><option value="HD">Half Day</option><option value="A">Absent</option><option value="WO">Week Off</option><option value="PTO">PTO</option>' +
              '</select>' +
              '<button id="mb_' + r.emp_id + '" class="tam-btn" onclick="_tamMark1(\'' + _esc(r.emp_id) + '\',\'' + _esc(r.name) + '\',\'' + _esc(d) + '\')" style="padding:6px 14px;border-radius:8px;background:var(--G);color:#fff;font-size:12px;font-weight:800;border:none;cursor:pointer;white-space:nowrap"><i class="fas fa-check"></i> Mark</button>' + '<button type="button" class="tam-btn" onclick="_tamEdit(\'' + _esc(r.emp_id) + '\',\'' + _esc(r.name) + '\',\'' + _esc(d) + '\')" style="padding:6px 10px;border-radius:8px;background:var(--sur);color:var(--P);font-size:12px;font-weight:700;border:1.5px solid var(--bdr);cursor:pointer;margin-left:4px"><i class="fas fa-pen"></i></button>'
            ) +
            '<button type="button" class="tam-btn" onclick="_tamEdit(\'' + _esc(r.emp_id) + '\',\'' + _esc(r.name) + '\',\'' + _esc(d) + '\',\'' + _esc(r.check_in || '') + '\',\'' + _esc(r.check_out || '') + '\',\'' + _esc(r.status || 'P') + '\')" style="padding:6px 10px;border-radius:8px;background:var(--sur);color:var(--P);font-size:12px;font-weight:700;border:1.5px solid var(--bdr);cursor:pointer" title="Edit attendance"><i class="fas fa-pen"></i> Edit</button>' +
            '</div></div>';
        }).join('');

        dHtml += '</div></div>';
        return dHtml;
      }).join('');

      list.innerHTML = html;
    }

    function _nowTime() {
      var n = new Date(); return (n.getHours() < 10 ? '0' : '') + n.getHours() + ':' + (n.getMinutes() < 10 ? '0' : '') + n.getMinutes();
    }

    function _tamSort(key) {
      if (_teamAttSort.key === key) {_teamAttSort.dir *= -1;}
      else {_teamAttSort.key = key; _teamAttSort.dir = 1;}
      // Update sort button styles
      document.querySelectorAll('.tsb').forEach(function (b) {
        var isActive = b.id === 'tsb_' + key;
        b.style.border = '1.5px solid ' + (isActive ? 'var(--P)' : 'var(--bdr)');
        b.style.background = isActive ? 'var(--Pl)' : 'var(--bg)';
        b.style.color = isActive ? 'var(--P)' : 'var(--tx2)';
        if (isActive) {
          var lbl = {name: 'Name', dept: 'Dept', checkin: 'Check-in', status: 'Status'}[key] || key;
          b.textContent = lbl + (_teamAttSort.dir === 1 ? ' ↑' : ' ↓');
        }
      });
      _renderTeamList();
    }

    function _tamToggle(uid) {
      var b = document.getElementById(uid), ic = document.getElementById('tami_' + uid);
      if (!b) return;
      var open = b.classList.toggle('adm-open');
      if (ic) ic.className = 'fas fa-chevron-' + (open ? 'down' : 'right') + ' fa-fw';
    }

    function _tamExpandAll(exp) {
      document.querySelectorAll('#tamList .adm-body').forEach(function (b) {b.classList.toggle('adm-open', exp);});
      document.querySelectorAll('#tamList [id^="tami_"]').forEach(function (i) {i.className = 'fas fa-chevron-' + (exp ? 'down' : 'right') + ' fa-fw';});
    }

    function _tamReload() {
      var root = document.getElementById('amteamRoot');
      if (!root) return;
      _teamAttDate = (document.getElementById('tamDate') || {}).value || _today();
      var l = document.getElementById('tamList');
      if (l) l.innerHTML = _skel(3);
      _gas('getTeamAttendanceStatus', [_teamAttDate], function (rows) {
        _teamAttData = rows || [];
        // Refresh dept options
        var depts = _teamAttData.reduce(function (acc, r) {if (r.dept && acc.indexOf(r.dept) < 0) acc.push(r.dept); return acc;}, []).sort();
        var sel = document.getElementById('tamDept');
        if (sel) {
          var cur = sel.value;
          sel.innerHTML = '<option value="all">All Departments</option>' + depts.map(function (d) {return '<option value="' + _esc(d) + '">' + _esc(d) + '</option>';}).join('');
          sel.value = cur;
        }
        _renderTeamList();
      }, function (e) {
        if (l) l.innerHTML = '<div class="te"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) + '</div>';
      });
    }

    function _tamMark1(empId, empName, dept) {
      var btn = document.getElementById('mb_' + empId);
      if (btn) {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
      }
      var inT = (document.getElementById('ti_' + empId) || {}).value || '';
      var outT = (document.getElementById('to_' + empId) || {}).value || '';
      var st = (document.getElementById('st_' + empId) || {}).value || 'P';
      _toast('Marking ' + empName + '…', 'info');
      _gas('markStaffAttendance', [[{
        emp_id: empId, emp_name: empName, dept: dept,
        date: _teamAttDate, check_in: inT, check_out: outT, status: st
      }]], function (res) {
        _toast('✓ ' + empName + (outT ? ' OUT saved' : ' marked ' + ({P:'Present',HD:'Half Day',A:'Absent',WO:'Week Off',PTO:'PTO'}[st] || st)), 'ok');
        // Brief wait so server SNAP patch commits before reload
        setTimeout(function () { _tamReload(); }, 350);
      }, function (e) {
        _toast(e.message || 'Mark failed', 'err');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = outT
            ? '<i class="fas fa-sign-out-alt"></i> Mark OUT'
            : '<i class="fas fa-check"></i> Mark';
        }
      });
    }


    function _tamEdit(empId, empName, dept, prefIn, prefOut, prefSt) {
      var inEl = document.getElementById('ti_' + empId);
      var outEl = document.getElementById('to_' + empId);
      var stEl = document.getElementById('st_' + empId);
      var curIn = (inEl && inEl.value) || prefIn || '';
      var curOut = (outEl && outEl.value) || prefOut || '';
      var curSt = (stEl && stEl.value) || prefSt || 'P';
      // normalize status codes
      if (curSt === 'Present') curSt = 'P';
      if (curSt === 'Half Day') curSt = 'HD';
      if (curSt === 'Absent') curSt = 'A';
      if (curSt === 'Week Off') curSt = 'WO';
      var dateVal = _teamAttDate || _today();
      _openModal(
        '<i class="fas fa-pen" style="color:var(--P)"></i> Edit Attendance — ' + _esc(empName),
        '<div style="display:flex;flex-direction:column;gap:12px">' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Date</label>' +
        '<input type="date" id="tamEditDate" class="ana-sel" value="' + dateVal + '" style="width:100%"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Check-in</label>' +
        '<input type="time" id="tamEditIn" class="ana-sel" value="' + _esc(curIn) + '" style="width:100%"></div>' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Check-out</label>' +
        '<input type="time" id="tamEditOut" class="ana-sel" value="' + _esc(curOut) + '" style="width:100%"></div>' +
        '</div>' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Status</label>' +
        '<select id="tamEditSt" class="ana-sel" style="width:100%">' +
        ['P|Present','HD|Half Day','A|Absent','WO|Week Off','PTO|PTO'].map(function (x) {
          var p = x.split('|');
          return '<option value="' + p[0] + '"' + (curSt === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
        }).join('') +
        '</select></div>' +
        '<div style="font-size:11px;color:var(--tx3)"><i class="fas fa-info-circle"></i> Management can update today or any back date.</div>' +
        '</div>',
        function () {
          var dt = (document.getElementById('tamEditDate') || {}).value || dateVal;
          var inT = (document.getElementById('tamEditIn') || {}).value || '';
          var outT = (document.getElementById('tamEditOut') || {}).value || '';
          var st = (document.getElementById('tamEditSt') || {}).value || 'P';
          _closeModal();
          _toast('Saving ' + empName + '…', 'info');
          _gas('markStaffAttendance', [[{
            emp_id: empId, emp_name: empName, dept: dept,
            date: dt, check_in: inT, check_out: outT, status: st
          }]], function () {
            _toast('✓ Attendance updated for ' + empName, 'ok');
            if (typeof _loadTeamAtt === 'function') {
              // keep selected date if filter exists
              var dateInp = document.getElementById('tamDate') || document.getElementById('cmtDate');
              _teamAttDate = dt;
              _loadTeamAtt();
            }
          }, function (e) {
            _toast('Error: ' + ((e && e.message) || 'Save failed'), 'err');
          });
        },
        '<i class="fas fa-save"></i> Save Attendance'
      );
    }

    function _tamMarkAll() {
      var bulkIn = (document.getElementById('tamBulkIn') || {}).value || '';
      var bulkOut = (document.getElementById('tamBulkOut') || {}).value || '';
      var dept = (document.getElementById('tamDept') || {}).value || 'all';
      var showF = (document.getElementById('tamShow') || {}).value || 'unmarked';
      var q = ((document.getElementById('tamSearch') || {}).value || '').toLowerCase().trim();
      var unmarked = _teamAttData.filter(function (r) {
        if (r.marked) return false;
        if (dept !== 'all' && r.dept !== dept) return false;
        if (q && (r.name + ' ' + r.dept).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      if (!unmarked.length) {_toast('No unmarked staff in current filter', 'warn'); return;}
      var btn = document.querySelector('#tamBulkBar button');
      if (btn) {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Marking ' + unmarked.length + '…';
      }
      _toast('Marking ' + unmarked.length + ' staff as Present…', 'info');
      var records = unmarked.map(function (r) {
        return {emp_id: r.emp_id, emp_name: r.name, dept: r.dept, date: _teamAttDate, check_in: bulkIn, check_out: bulkOut, status: 'P'};
      });
      _gas('markStaffAttendance', [records], function (res) {
        unmarked.forEach(function (r) {r.marked = true; r.check_in = bulkIn; r.check_out = bulkOut; r.status = 'P';});
        _toast('✓ ' + (res.saved || records.length) + ' staff marked Present', 'ok');
        _renderTeamList();
        if (btn) {btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-double"></i> Mark All Present';}
      }, function (e) {
        _toast(e.message || 'Bulk mark failed', 'err');
        if (btn) {btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-double"></i> Mark All Present';}
      });
    }

    function _loadMyRegularizations() {
      var el = document.getElementById('aregList');
      if (!el) return;
      el.innerHTML = _skel(3);
      _gas('getRegularizationRequests', [], function (rows) {
        if (!rows || !rows.length) {
          el.innerHTML = '<div class="empty-state" style="padding:40px 0"><i class="fas fa-clipboard-check" style="font-size:40px;color:var(--tx4);margin-bottom:12px"></i><h4>No Requests Yet</h4><p>Submit a regularization request to correct your attendance.</p></div>';
          return;
        }
        var h = '<div class="table-card"><div class="tw"><table><thead><tr>' +
          '<th>Date</th><th>Day</th><th>Req In</th><th>Req Out</th><th>Reason</th><th>Status</th><th>Remark</th>' +
          '</tr></thead><tbody>' +
          rows.map(function (r) {
            var sc = r.status === 'Approved' ? 'var(--G)' : r.status === 'Rejected' ? 'var(--R)' : 'var(--O)';
            var d = r.date ? new Date(r.date + 'T00:00:00') : null;
            var dow = d ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] : '';
            return '<tr>' +
              '<td style="font-weight:700;white-space:nowrap">' + _fmtDate(r.date) + '</td>' +
              '<td style="color:var(--tx2)">' + dow + '</td>' +
              '<td style="color:var(--G);font-weight:700">' + _esc(r.req_in || '—') + '</td>' +
              '<td style="color:var(--R);font-weight:700">' + _esc(r.req_out || '—') + '</td>' +
              '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + _esc(r.reason) + '">' + _esc(r.reason || '—') + '</td>' +
              '<td><span class="bdg" style="background:' + sc + '22;color:' + sc + ';font-weight:800">' + _esc(r.status || 'Pending') + '</span></td>' +
              '<td style="color:var(--tx3);font-size:12px">' + _esc(r.remark || '—') + '</td>' +
              '</tr>';
          }).join('') +
          '</tbody></table></div></div>';
        el.innerHTML = h;
      }, function (e) {el.innerHTML = '<div class="te">Failed to load: ' + _esc(e.message) + '</div>';});
    }

    function _openRegModal() {
      var today = new Date().toISOString().slice(0, 10);
      _openModal(
        '<i class="fas fa-pen-to-square" style="color:var(--T)"></i> Regularization Request',
        '<div class="form-g" style="display:flex;flex-direction:column;gap:14px">' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:5px">Date</label>' +
        '<input type="date" id="regDate" value="' + today + '" max="' + today + '" style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;background:var(--bg);color:var(--tx);outline:none"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:5px">Check In Time</label>' +
        '<input type="time" id="regIn" style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;background:var(--bg);color:var(--tx);outline:none"></div>' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:5px">Check Out Time</label>' +
        '<input type="time" id="regOut" style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;background:var(--bg);color:var(--tx);outline:none"></div>' +
        '</div>' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:5px">Reason <span style="color:var(--R)">*</span></label>' +
        '<textarea id="regReason" rows="3" placeholder="Explain reason for regularization..." ' +
        'style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;background:var(--bg);color:var(--tx);outline:none;resize:vertical;font-family:inherit"></textarea></div>' +
        '</div>',
        function () {_submitReg();},
        '<i class="fas fa-paper-plane"></i> Submit Request'
      );
    }

    function _submitReg() {
      var date = (document.getElementById('regDate') || {}).value || '';
      var inT = (document.getElementById('regIn') || {}).value || '';
      var outT = (document.getElementById('regOut') || {}).value || '';
      var reason = (document.getElementById('regReason') || {}).value.trim() || '';
      if (!date || !reason) {_toast('Date and reason required', 'err'); return;}
      // Disable confirm button to prevent double-submit
      var btns = document.querySelectorAll('.modal-footer .btn, #modalConfirm');
      btns.forEach(function (b) {b.disabled = true; b.style.opacity = '0.6';});
      _gas('requestRegularization', [{date: date, req_in: inT, req_out: outT, reason: reason}], function (r) {
        _closeModal();
        _toast('Regularization request submitted successfully', 'ok');
        _loadMyRegularizations();
      }, function (e) {
        btns.forEach(function (b) {b.disabled = false; b.style.opacity = '';});
        _toast('Failed: ' + e.message, 'err');
      });
    }

    // Reg. Approvals form (manager)
    function _aregaForm() {
      return '<div class="fbar">' +
        '<label>Filter:</label>' +
        '<select id="aregaFilter" onchange="_loadRegApprovals()"><option value="Pending">Pending</option><option value="All">All</option></select>' +
        '<label>Month:</label>' +
        '<input type="month" id="aregaMonth" value="' + _currMonth() + '">' +
        '<button class="btn btn-sm" onclick="_loadRegApprovals()"><i class="fas fa-search"></i> Load</button>' +
        '</div>' +
        '<div id="aregaList">' + _skel(3) + '</div>';
    }

    function _loadRegApprovals() {
      var el = document.getElementById('aregaList');
      if (!el) return;
      el.innerHTML = _skel(3);
      var month = (document.getElementById('aregaMonth') || {}).value || '';
      _gas('getRegularizationRequests', [], function (rows) {
        var filter = (document.getElementById('aregaFilter') || {}).value || 'Pending';
        rows = rows || [];
        if (filter === 'Pending') rows = rows.filter(function (r) {return r.status === 'Pending';});
        if (month) rows = rows.filter(function (r) {return (r.date || '').substring(0, 7) === month;});
        if (!rows.length) {
          el.innerHTML = '<div class="empty-state" style="padding:40px 0"><i class="fas fa-clipboard-check" style="font-size:40px;color:var(--tx4);margin-bottom:12px"></i><h4>No Requests</h4><p>No regularization requests found.</p></div>';
          return;
        }
        var h = '<div class="table-card"><div class="tw"><table><thead><tr>' +
          '<th>Employee</th><th>Dept</th><th>Date</th><th>Req In</th><th>Req Out</th><th>Reason</th><th>Status</th><th>Action</th>' +
          '</tr></thead><tbody>' +
          rows.map(function (r) {
            var sc = r.status === 'Approved' ? 'var(--G)' : r.status === 'Rejected' ? 'var(--R)' : 'var(--O)';
            var btns = r.status === 'Pending'
              ? '<div style="display:flex;gap:5px">' +
              '<button class="btn btn-xs" style="background:var(--G);color:#fff;padding:4px 10px" onclick="_approveReg(\'' + r.reg_id + '\',\'Approved\')"><i class="fas fa-check"></i></button>' +
              '<button class="btn btn-xs" style="background:var(--R);color:#fff;padding:4px 10px" onclick="_approveReg(\'' + r.reg_id + '\',\'Rejected\')"><i class="fas fa-times"></i></button>' +
              '</div>'
              : '<span style="color:' + sc + ';font-weight:700">' + _esc(r.status) + '</span>';
            return '<tr>' +
              '<td style="font-weight:700">' + _esc(r.emp_name || '—') + '</td>' +
              '<td><span class="bdg" style="background:var(--Pl);color:var(--P)">' + _esc(r.dept || '—') + '</span></td>' +
              '<td style="font-weight:700;white-space:nowrap">' + _fmtDate(r.date) + '</td>' +
              '<td style="color:var(--G);font-weight:700">' + _esc(r.req_in || '—') + '</td>' +
              '<td style="color:var(--R);font-weight:700">' + _esc(r.req_out || '—') + '</td>' +
              '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + _esc(r.reason) + '">' + _esc(r.reason || '—') + '</td>' +
              '<td><span class="bdg" style="background:' + sc + '22;color:' + sc + ';font-weight:800">' + _esc(r.status || 'Pending') + '</span></td>' +
              '<td>' + btns + '</td>' +
              '</tr>';
          }).join('') + '</tbody></table></div></div>';
        el.innerHTML = h;
      }, function (e) {el.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';});
    }

    function _approveReg(regId, status) {
      var label = status === 'Approved' ? 'Approve' : 'Reject';
      var ico = status === 'Approved' ? 'fa-check-circle' : 'fa-times-circle';
      var clr = status === 'Approved' ? 'var(--G)' : 'var(--R)';
      _openModal(
        '<i class="fas ' + ico + '" style="color:' + clr + '"></i> ' + label + ' Regularization',
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:8px">Remark by Management (optional)</label>' +
        '<textarea id="regApprRemark" rows="3" placeholder="Enter remark..." style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;background:var(--bg);color:var(--tx);outline:none;resize:vertical;font-family:inherit"></textarea></div>',
        function () {
          var remark = (document.getElementById('regApprRemark') || {}).value || '';
          _closeModal();
          _gas('approveRegularization', [regId, status, remark], function () {
            _toast(status + ' successfully', 'ok');
            _loadRegApprovals();
          }, function (e) {_toast('Failed: ' + e.message, 'err');});
        },
        '<i class="fas ' + ico + '"></i> Confirm ' + label
      );
    }

    // ════════════════════════════════════════════════════════════════════════
    // ATTENDANCE ANALYTICS — Rich dashboard with charts, filters & insights
    // ════════════════════════════════════════════════════════════════════════

    function _aanaForm() {
      return '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px;padding:10px 14px;background:var(--sur2);border-radius:12px;border:1px solid var(--bdr)">' +
        '<select id="aanaDept" class="ana-sel" style="min-width:130px"><option value="All">All Departments</option></select>' +
        '<input type="month" id="aanaMonth" class="ana-sel" style="max-width:140px" value="' + _currMonth() + '">' +
        '<select id="aanaView" class="ana-sel" style="min-width:130px" onchange="_renderAnaTable()"><option value="overview">Overview</option><option value="dept">By Department</option><option value="employee">By Employee</option><option value="trend">Trend &amp; Insights</option></select>' +
        '<select id="aanaStatus" class="ana-sel" style="min-width:130px"><option value="all">All Employees</option><option value="perfect">Perfect (100%)</option><option value="good">Good (≥80%)</option><option value="avg">Average (60-79%)</option><option value="low">Low (&lt;60%)</option></select>' +
        '<select id="aanaSort" class="ana-sel" style="min-width:110px" onchange="_renderAnaTable()"><option value="pct_desc">Presence % ↓</option><option value="pct_asc">Presence % ↑</option><option value="absent_desc">Absent ↓</option><option value="name_asc">Name A-Z</option><option value="dept_asc">Department</option></select>' +
        '<input type="text" id="aanaEmpSearch" class="ana-sel" placeholder="Search employee..." oninput="_filterAnaTable()" style="min-width:150px;max-width:200px">' +
        '<div style="flex:1"></div>' +
        '<button class="btn btn-sm" onclick="_loadAttAnalytics()" style="white-space:nowrap"><i class="fas fa-chart-bar"></i> Analyze</button>' +
        '<span id="aanaLastLoad" style="font-size:11px;color:var(--tx3);white-space:nowrap"></span>' +
        '</div>' +
        '<div id="aanaContent">' + _skel(4) + '</div>';
    }

    function _filterAnaTable() {
      var q = ((document.getElementById('aanaEmpSearch') || {}).value || '').toLowerCase().trim();
      document.querySelectorAll('#anaEmpTable tbody tr').forEach(function (r) {
        r.style.display = (!q || r.textContent.toLowerCase().indexOf(q) >= 0) ? '' : 'none';
      });
    }

    function _exportAnaCSV() {
      if (!_D.anaData || !_D.anaData.rows) {_toast('Load analytics first', 'err'); return;}
      var head = ['Employee', 'Department', 'Present Days', 'Half Days', 'Absent Days', 'Week Off', 'Working Days', 'Presence %'];
      var csv = [head.join(',')].concat((_D.anaData.rows || []).map(function (r) {
        return ['"' + r.emp_name + '"', '"' + r.dept + '"', r.days_present || 0, r.days_hd || 0, r.days_absent || 0, r.days_wo || 0, r.working_days || 0, (r.pct || 0) + '%'].join(',');
      })).join('\n');
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFF' + csv);
      a.download = 'attendance_' + (_D.anaData.month || '') + '.csv';
      a.click();
    }

    function _anaChart(canvasId, type, labels, datasets, opts) {
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      if (canvas._ci) {try {canvas._ci.destroy();} catch (e) { } }
      var isDark = document.body.classList.contains('dark');
      var gc = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
      var tc = isDark ? '#94a3b8' : '#64748b';
      var base = {
        responsive: true, maintainAspectRatio: false,
        plugins: {legend: {labels: {color: tc, font: {size: 11}, boxWidth: 12}}},
        scales: (type === 'pie' || type === 'doughnut') ? {} : {
          x: {ticks: {color: tc, font: {size: 10}}, grid: {color: gc}},
          y: {ticks: {color: tc, font: {size: 10}}, grid: {color: gc}}
        }
      };
      function deepMerge(a, b) {var r = Object.assign({}, a); Object.keys(b || {}).forEach(function (k) {r[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) ? deepMerge(a[k] || {}, b[k]) : b[k];}); return r;}
      canvas._ci = new Chart(canvas, {type: type, data: {labels: labels, datasets: datasets}, options: deepMerge(base, opts || {})});
    }

    function _loadAttAnalytics() {
      var el = document.getElementById('aanaContent');
      if (!el) return;
      el.innerHTML = _skel(4);
      _populateDeptSel('aanaDept', function () {
        var dept = (document.getElementById('aanaDept') || {}).value || 'All';
        var month = (document.getElementById('aanaMonth') || {}).value || _currMonth();
        var view = (document.getElementById('aanaView') || {}).value || 'overview';
        var sort = (document.getElementById('aanaSort') || {}).value || 'pct_desc';
        var stFlt = (document.getElementById('aanaStatus') || {}).value || 'all';

        // Calendar context
        var parts = month.split('-'); var yr = parseInt(parts[0]), mo = parseInt(parts[1]) - 1;
        var dim = new Date(yr, mo + 1, 0).getDate(), suns = 0;
        for (var d = 1; d <= dim; d++) if (new Date(yr, mo, d).getDay() === 0) suns++;
        var holList = (_D.holidays || []).filter(function (h) {return h.date && h.date.substring(0, 7) === month;});
        var netWD = dim - suns - holList.length;

        _gas('getMusterGrid', [dept, month], function (res) {
          res = res || {};
          var allRows = res.rows || [], dates = res.dates || [];

          // Filter
          var rows = allRows.filter(function (r) {
            if (stFlt === 'perfect') return r.pct === 100;
            if (stFlt === 'good') return r.pct >= 80;
            if (stFlt === 'avg') return r.pct >= 60 && r.pct < 80;
            if (stFlt === 'low') return r.pct < 60;
            if (stFlt === 'absent_heavy') return (r.days_absent || 0) > 3;
            return true;
          });
          // Sort
          rows.sort(function (a, b) {
            if (sort === 'pct_asc') return (a.pct || 0) - (b.pct || 0);
            if (sort === 'absent_desc') return (b.days_absent || 0) - (a.days_absent || 0);
            if (sort === 'name_asc') return (a.emp_name || '').localeCompare(b.emp_name || '');
            if (sort === 'dept_asc') return (a.dept || '').localeCompare(b.dept || '');
            return (b.pct || 0) - (a.pct || 0);
          });

          _D.anaData = {rows: allRows, month: month};

          // Aggregates
          var empCount = allRows.length,
            totalP = allRows.reduce(function (s, r) {return s + (r.days_present || 0);}, 0),
            totalA = allRows.reduce(function (s, r) {return s + (r.days_absent || 0);}, 0),
            totalHD = allRows.reduce(function (s, r) {return s + (r.days_hd || 0);}, 0),
            totalWO = allRows.reduce(function (s, r) {return s + (r.days_wo || 0);}, 0),
            avgPct = empCount > 0 ? Math.round(allRows.reduce(function (s, r) {return s + (r.pct || 0);}, 0) / empCount) : 0,
            perfectCnt = allRows.filter(function (r) {return r.pct === 100;}).length,
            lowCnt = allRows.filter(function (r) {return r.pct < 60;}).length,
            highAbsCnt = allRows.filter(function (r) {return (r.days_absent || 0) > 3;}).length;

          // Dept agg
          var dMap = {};
          allRows.forEach(function (r) {
            var k = r.dept || 'Other';
            if (!dMap[k]) dMap[k] = {dept: k, emps: 0, present: 0, hd: 0, absent: 0, pts: []};
            dMap[k].emps++; dMap[k].present += r.days_present || 0; dMap[k].hd += r.days_hd || 0;
            dMap[k].absent += r.days_absent || 0; dMap[k].pts.push(r.pct || 0);
          });
          var dList = Object.keys(dMap).sort().map(function (k) {
            var d = dMap[k], avg = d.pts.length ? Math.round(d.pts.reduce(function (a, b) {return a + b;}, 0) / d.pts.length) : 0;
            return Object.assign(d, {avg_pct: avg});
          });

          // Daily trend
          var trend = dates.map(function (dt) {
            var dow = new Date(dt + 'T00:00:00').getDay();
            if (dow === 0) return null;
            var tot = 0, pres = 0;
            allRows.forEach(function (r) {var v = r[dt] || ''; if (v !== 'WO' && v !== 'H') {tot++; if (v === 'P' || v === 'HD') pres++;} });
            return {date: dt, pct: tot > 0 ? Math.round(pres / tot * 100) : 0};
          }).filter(Boolean);

          var kc = avgPct >= 80 ? 'var(--G)' : avgPct >= 60 ? 'var(--O)' : 'var(--R)';
          var h = '';

          // ── KPI Strip ────────────────────────────────────────────────────
          h += '<div class="ana-kpi-row">' + [
            {lbl: 'Employees', val: empCount, c: 'var(--P)', ico: 'fa-users', sub: dept === 'All' ? 'Total tracked' : dept},
            {lbl: 'Avg Presence', val: avgPct + '%', c: kc, ico: 'fa-chart-pie', sub: avgPct >= 80 ? 'Excellent' : avgPct >= 60 ? 'Average' : 'Needs attention'},
            {lbl: 'Perfect Att.', val: perfectCnt, c: 'var(--G)', ico: 'fa-star', sub: '100% this month'},
            {lbl: 'Needs Attn', val: lowCnt, c: 'var(--R)', ico: 'fa-triangle-exclamation', sub: 'Below 60%'},
            {lbl: 'Working Days', val: netWD, c: 'var(--I)', ico: 'fa-calendar-days', sub: month},
            {lbl: 'Total Present', val: totalP, c: 'var(--G)', ico: 'fa-calendar-check', sub: 'day-instances'},
            {lbl: 'Total Absent', val: totalA, c: 'var(--R)', ico: 'fa-calendar-xmark', sub: 'day-instances'},
            {lbl: 'High Absent', val: highAbsCnt, c: highAbsCnt > 0 ? 'var(--O)' : 'var(--G)', ico: 'fa-user-slash', sub: '>3 absent days'}
          ].map(function (k) {
            return '<div class="ana-kpi">' +
              '<div class="ana-kpi-top"><div class="ana-kpi-ico" style="--kc:' + k.c + '"><i class="fas ' + k.ico + '"></i></div>' +
              '<div class="ana-kpi-val" style="color:' + k.c + '">' + k.val + '</div></div>' +
              '<div class="ana-kpi-lbl">' + k.lbl + '</div>' +
              '<div class="ana-kpi-sub">' + k.sub + '</div></div>';
          }).join('') + '</div>';

          // Context bar
          h += '<div class="ana-ctx-bar">' +
            '<i class="fas fa-circle-info" style="color:var(--P)"></i> <b>' + month + '</b>: ' + dim + ' days — ' + suns + ' Sundays — ' + holList.length + ' holidays = <b style="color:var(--P)">' + netWD + ' working days</b>' +
            (holList.length ? ' | ' + holList.map(function (h) {return '<span class="bdg" style="background:#e0e7ff;color:#4338ca">' + _esc(h.name || '') + '</span>';}).join(' ') : '') +
            (stFlt !== 'all' ? ' &nbsp;·&nbsp; Filter: <b style="color:var(--O)">' + stFlt + '</b> — ' + rows.length + '/' + empCount + ' employees' : '') +
            '</div>';

          if (!allRows.length) {
            el.innerHTML = h + '<div class="te" style="margin-top:16px"><i class="fas fa-calendar-times"></i> No attendance data for ' + month + '</div>';
            return;
          }

          // ── CHARTS ───────────────────────────────────────────────────────
          if (view === 'overview' || view === 'dept') {
            h += '<div class="ana-charts-grid">';
            h += '<div class="ana-chart-card"><div class="ana-chart-title"><i class="fas fa-building"></i> Dept Presence %</div><div style="height:190px"><canvas id="anaChDept"></canvas></div></div>';
            h += '<div class="ana-chart-card"><div class="ana-chart-title"><i class="fas fa-chart-pie"></i> Attendance Breakdown</div><div style="height:190px"><canvas id="anaChBreak"></canvas></div></div>';
            h += '<div class="ana-chart-card"><div class="ana-chart-title"><i class="fas fa-chart-bar"></i> Presence Distribution</div><div style="height:190px"><canvas id="anaChDist"></canvas></div></div>';
            if (trend.length) h += '<div class="ana-chart-card ana-chart-wide"><div class="ana-chart-title"><i class="fas fa-chart-line"></i> Daily Presence Trend</div><div style="height:170px"><canvas id="anaChTrend"></canvas></div></div>';
            h += '</div>';

            if (dList.length) {
              h += '<div class="card card-nohover card-sm" style="margin-top:16px"><div class="sec-title" style="margin-bottom:12px"><i class="fas fa-building" style="color:var(--P)"></i> Department Breakdown</div><div class="tw"><table><thead><tr><th>Department</th><th style="text-align:center">Emps</th><th style="text-align:center;color:var(--G)">Present</th><th style="text-align:center;color:var(--O)">HD</th><th style="text-align:center;color:var(--R)">Absent</th><th style="text-align:center">Avg %</th><th>Progress</th></tr></thead><tbody>' +
                dList.map(function (d) {var c2 = d.avg_pct >= 80 ? 'var(--G)' : d.avg_pct >= 60 ? 'var(--O)' : 'var(--R)'; return '<tr><td style="font-weight:800">' + _esc(d.dept) + '</td><td style="text-align:center;font-weight:700">' + d.emps + '</td><td style="text-align:center;color:var(--G);font-weight:800">' + d.present + '</td><td style="text-align:center;color:var(--O);font-weight:800">' + d.hd + '</td><td style="text-align:center;color:var(--R);font-weight:800">' + d.absent + '</td><td style="text-align:center;font-weight:900;color:' + c2 + '">' + d.avg_pct + '%</td><td><div class="pbar-wrap"><div class="pbar" style="width:' + d.avg_pct + '%;background:' + c2 + '"></div></div></td></tr>';}).join('') +
                '</tbody></table></div></div>';
            }
          }

          if (view === 'overview' || view === 'employee') {
            h += '<div class="card card-nohover card-sm" style="margin-top:16px"><div class="sec-title" style="margin-bottom:12px"><i class="fas fa-users" style="color:var(--P)"></i> Employee Detail (' + rows.length + ')</div>' +
              '<div class="tw"><table id="anaEmpTable"><thead><tr>' +
              '<th>Employee</th><th>Dept</th>' +
              '<th style="text-align:center" title="Present"><i class="fas fa-calendar-check" style="color:var(--G)"></i></th>' +
              '<th style="text-align:center" title="Half Day"><i class="fas fa-circle-half-stroke" style="color:var(--O)"></i></th>' +
              '<th style="text-align:center" title="Absent"><i class="fas fa-calendar-xmark" style="color:var(--R)"></i></th>' +
              '<th style="text-align:center">WD</th><th style="text-align:center">%</th>' +
              '<th style="min-width:80px">Bar</th><th>Status</th>' +
              '</tr></thead><tbody>' +
              rows.map(function (r) {
                var p = r.pct || 0, c2 = p >= 80 ? 'var(--G)' : p >= 60 ? 'var(--O)' : 'var(--R)';
                var badge = p === 100 ? '<span class="bdg" style="background:#d1fae5;color:#059669;font-size:10px"><i class="fas fa-star"></i> Perfect</span>' :
                  p >= 80 ? '<span class="bdg" style="background:var(--Gl);color:var(--G);font-size:10px">Good</span>' :
                    p >= 60 ? '<span class="bdg" style="background:var(--Ol);color:var(--O);font-size:10px">Average</span>' :
                      '<span class="bdg" style="background:var(--Rl);color:var(--R);font-size:10px"><i class="fas fa-triangle-exclamation"></i> Low</span>';
                return '<tr><td style="font-weight:700;min-width:130px">' + _esc(r.emp_name || '') + '</td>' +
                  '<td><span class="bdg" style="background:var(--Pl);color:var(--P);font-size:10px">' + _esc(r.dept || '') + '</span></td>' +
                  '<td style="text-align:center;color:var(--G);font-weight:800">' + (r.days_present || 0) + '</td>' +
                  '<td style="text-align:center;color:var(--O);font-weight:800">' + (r.days_hd || 0) + '</td>' +
                  '<td style="text-align:center;color:var(--R);font-weight:800">' + (r.days_absent || 0) + '</td>' +
                  '<td style="text-align:center;font-weight:700;color:var(--tx2)">' + (r.working_days || 0) + '</td>' +
                  '<td style="text-align:center;font-weight:900;color:' + c2 + '">' + p + '%</td>' +
                  '<td><div class="pbar-wrap" style="width:75px"><div class="pbar" style="width:' + p + '%;background:' + c2 + '"></div></div></td>' +
                  '<td>' + badge + '</td></tr>';
              }).join('') +
              '</tbody></table></div></div>';
          }

          if (view === 'trend') {
            h += '<div class="ana-charts-grid">';
            if (trend.length) h += '<div class="ana-chart-card ana-chart-wide"><div class="ana-chart-title"><i class="fas fa-chart-line"></i> Daily Presence % — ' + month + '</div><div style="height:220px"><canvas id="anaChTrendBig"></canvas></div></div>';
            h += '<div class="ana-chart-card"><div class="ana-chart-title"><i class="fas fa-ranking-star"></i> Top 10 Attendees</div><div style="height:240px"><canvas id="anaChTop"></canvas></div></div>';
            h += '<div class="ana-chart-card"><div class="ana-chart-title"><i class="fas fa-arrow-down-wide-short"></i> Highest Absentees</div><div style="height:240px"><canvas id="anaChBot"></canvas></div></div>';
            h += '</div>';
            var topE = allRows.slice().sort(function (a, b) {return (b.pct || 0) - (a.pct || 0);}).slice(0, 3);
            var lowE = allRows.slice().sort(function (a, b) {return (a.pct || 0) - (b.pct || 0);}).slice(0, 3);
            h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">' +
              '<div class="card card-nohover card-sm"><div class="sec-title" style="margin-bottom:12px;color:var(--G)"><i class="fas fa-trophy"></i> Top Performers</div>' +
              topE.map(function (r, i) {var m = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'; return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bdr)"><span style="font-size:18px">' + m + '</span><div style="flex:1;min-width:0;overflow-wrap:break-word"><div style="font-weight:700;font-size:13px">' + _esc(r.emp_name) + '</div><div style="font-size:11px;color:var(--tx3)">' + _esc(r.dept) + '</div></div><div style="font-weight:900;color:var(--G);font-size:16px;flex-shrink:0">' + r.pct + '%</div></div>';}).join('') +
              '</div>' +
              '<div class="card card-nohover card-sm"><div class="sec-title" style="margin-bottom:12px;color:var(--R)"><i class="fas fa-triangle-exclamation"></i> Needs Attention</div>' +
              lowE.map(function (r) {return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bdr)"><div style="width:32px;height:32px;border-radius:50%;background:var(--Rl);color:var(--R);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;flex-shrink:0">' + _esc(r.emp_name.charAt(0)) + '</div><div style="flex:1;min-width:0;overflow-wrap:break-word"><div style="font-weight:700;font-size:13px">' + _esc(r.emp_name) + '</div><div style="font-size:11px;color:var(--tx3)">' + _esc(r.dept) + ' · ' + r.days_absent + ' absent</div></div><div style="font-weight:900;color:var(--R);font-size:16px;flex-shrink:0">' + r.pct + '%</div></div>';}).join('') +
              '</div></div>';
          }

          el.innerHTML = h;
          var lEl = document.getElementById('aanaLastLoad');
          if (lEl) lEl.textContent = 'Updated ' + new Date().toLocaleTimeString();

          // Draw charts
          _whenChart(function () {
            if (document.getElementById('anaChDept') && dList.length) {
              _anaChart('anaChDept', 'bar', dList.map(function (d) {return d.dept;}),
                [{
                  label: 'Avg %', data: dList.map(function (d) {return d.avg_pct;}),
                  backgroundColor: dList.map(function (d) {return d.avg_pct >= 80 ? 'rgba(47,158,68,.75)' : d.avg_pct >= 60 ? 'rgba(245,158,11,.75)' : 'rgba(220,38,38,.75)';}),
                  borderRadius: 6, borderSkipped: false
                }],
                {plugins: {legend: {display: false}}, scales: {y: {min: 0, max: 100}}});
            }
            if (document.getElementById('anaChBreak')) {
              _anaChart('anaChBreak', 'doughnut', ['Present', 'Half Day', 'Absent', 'Week Off'],
                [{
                  data: [totalP, totalHD, totalA, totalWO],
                  backgroundColor: ['rgba(47,158,68,.85)', 'rgba(245,158,11,.85)', 'rgba(220,38,38,.85)', 'rgba(148,163,184,.5)'], borderWidth: 2
                }],
                {plugins: {legend: {position: 'bottom'}}, cutout: '58%'});
            }
            if (document.getElementById('anaChDist')) {
              var b = [0, 0, 0, 0];
              allRows.forEach(function (r) {var p = r.pct || 0; if (p === 100) b[3]++; else if (p >= 80) b[2]++; else if (p >= 60) b[1]++; else b[0]++;});
              _anaChart('anaChDist', 'bar', ['<60%', '60-79%', '80-99%', '100%'],
                [{label: 'Employees', data: b, backgroundColor: ['rgba(220,38,38,.75)', 'rgba(245,158,11,.75)', 'rgba(59,130,246,.75)', 'rgba(47,158,68,.75)'], borderRadius: 6, borderSkipped: false}],
                {plugins: {legend: {display: false}}});
            }
            var trEl = document.getElementById('anaChTrend') || document.getElementById('anaChTrendBig');
            if (trEl && trend.length) {
              var tl = trend.map(function (d) {var p = d.date.split('-'); return p[2] + '/' + p[1];});
              _anaChart(trEl.id, 'line', tl,
                [{
                  label: 'Presence %', data: trend.map(function (d) {return d.pct;}),
                  borderColor: 'rgba(14,165,233,.9)', backgroundColor: 'rgba(14,165,233,.1)', fill: true, tension: 0.4, pointRadius: 2
                }],
                {scales: {y: {min: 0, max: 100}}, plugins: {legend: {display: false}}});
            }
            if (document.getElementById('anaChTop')) {
              var t10 = allRows.slice().sort(function (a, b) {return (b.pct || 0) - (a.pct || 0);}).slice(0, 10).reverse();
              _anaChart('anaChTop', 'bar', t10.map(function (r) {return r.emp_name.split(' ')[0];}),
                [{label: '%', data: t10.map(function (r) {return r.pct || 0;}), backgroundColor: 'rgba(47,158,68,.75)', borderRadius: 4, borderSkipped: false}],
                {indexAxis: 'y', plugins: {legend: {display: false}}, scales: {x: {min: 0, max: 100}}});
            }
            if (document.getElementById('anaChBot')) {
              var b10 = allRows.slice().sort(function (a, b) {return (b.days_absent || 0) - (a.days_absent || 0);}).slice(0, 10).reverse();
              _anaChart('anaChBot', 'bar', b10.map(function (r) {return r.emp_name.split(' ')[0];}),
                [{label: 'Days', data: b10.map(function (r) {return r.days_absent || 0;}), backgroundColor: 'rgba(220,38,38,.75)', borderRadius: 4, borderSkipped: false}],
                {indexAxis: 'y', plugins: {legend: {display: false}}});
            }
          });

        }, function (e) {el.innerHTML = '<div class="te">Error: ' + _esc(e.message) + '</div>';});
      }); // end _populateDeptSel
    }

    function _amyForm() {
      return '<div class="fbar">' +
        '<label>Month:</label><input type="month" id="amyMonth" value="' + _currMonth() + '">' +
        '<button class="btn btn-sm" onclick="_loadMyAtt()"><i class="fas fa-search"></i> Load</button>' +
        '<div class="fbar-spacer"></div>' +
        '<button class="btn btn-outline btn-sm" onclick="_D.myAttendance=null;_loadMyAtt()" title="Refresh attendance data">' +
        '<i class="fas fa-rotate-right"></i> Refresh</button>' +
        '</div><div id="amySum"></div><div id="amyTable"></div>';
    }


    function _loadMyAtt() {
      var month = document.getElementById('amyMonth') ? document.getElementById('amyMonth').value : _currMonth();
      var sumEl = document.getElementById('amySum');
      var tblEl = document.getElementById('amyTable');
      if (!sumEl || !tblEl) return;

      // SWR: agar same month ka cache hai to turant dikhao
      if (_D.myAtt && _D.myAttMonth === month) {
        _renderMyAtt(_D.myAtt, sumEl, tblEl, month);
      } else {
        sumEl.innerHTML = _skel(1, 'sk-h6');
        tblEl.innerHTML = '';
      }

      // Background refresh (always)
      _gas('getMyAttendance', [_U.emp_code, month], function (data) {
        _D.myAtt = data;
        _D.myAttMonth = month;
        _lcSave();
        _renderMyAtt(data, sumEl, tblEl, month);
      }, function (e) {
        // Sirf tab error dikhao jab cache nahi tha
        if (!(_D.myAtt && _D.myAttMonth === month)) {
          sumEl.innerHTML = (e && e.message && e.message.indexOf('Network') > -1)
            ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_loadMyAtt()"><i class="fas fa-rotate-right"></i> Retry</button></div>'
            : '<div class="te">' + _esc(e.message) + '</div>';
        }
      });
    }

    // My Attendance sort state
    var _myAttSortKey = 'date';
    var _myAttSortDir = 'desc'; // date default: newest first

    function _myAttSort(key) {
      if (_myAttSortKey === key) {
        _myAttSortDir = (_myAttSortDir === 'asc') ? 'desc' : 'asc';
      } else {
        _myAttSortKey = key;
        // sensible default direction per column
        _myAttSortDir = (key === 'date' || key === 'hours') ? 'desc' : 'asc';
      }
      if (!_D.myAtt) return;
      var sumEl = document.getElementById('amySum');
      var tblEl = document.getElementById('amyTable');
      var month = document.getElementById('amyMonth')
        ? document.getElementById('amyMonth').value
        : _currMonth();
      if (sumEl && tblEl) _renderMyAtt(_D.myAtt, sumEl, tblEl, month);
    }

    function _myAttSortedRecords(recs) {
      var key = _myAttSortKey || 'date';
      var dir = _myAttSortDir === 'asc' ? 1 : -1;
      var arr = (recs || []).slice();

      function mins(t) {
        if (!t || t === '-') return -1;
        var p = String(t).split(':');
        var h = parseInt(p[0], 10), m = parseInt(p[1], 10);
        if (isNaN(h)) return -1;
        return h * 60 + (isNaN(m) ? 0 : m);
      }
      function hrsNum(h) {
        if (!h || h === '-') return -1;
        var s = String(h);
        var m = s.match(/(\d+)\s*h/i);
        var n = s.match(/(\d+)\s*m/i);
        var total = 0;
        if (m) total += parseInt(m[1], 10) * 60;
        if (n) total += parseInt(n[1], 10);
        if (!m && !n) {
          var f = parseFloat(s);
          return isNaN(f) ? -1 : f * 60;
        }
        return total;
      }
      function statusRank(st) {
        var map = {
          'Present': 1, 'Half Day': 2, 'Absent': 3,
          'Holiday': 4, 'Week Off': 5
        };
        return map[st] || 9;
      }

      arr.sort(function (a, b) {
        var av, bv;
        if (key === 'date') {
          av = String(a.date || '');
          bv = String(b.date || '');
          return av < bv ? -dir : av > bv ? dir : 0;
        }
        if (key === 'in') {
          av = mins(a.check_in || a.punch_in);
          bv = mins(b.check_in || b.punch_in);
          return (av - bv) * dir;
        }
        if (key === 'out') {
          av = mins(a.check_out || a.punch_out);
          bv = mins(b.check_out || b.punch_out);
          return (av - bv) * dir;
        }
        if (key === 'hours') {
          av = hrsNum(a.total_hours);
          bv = hrsNum(b.total_hours);
          return (av - bv) * dir;
        }
        if (key === 'status') {
          av = statusRank(a.status);
          bv = statusRank(b.status);
          return (av - bv) * dir;
        }
        if (key === 'late') {
          av = a.is_late ? 1 : 0;
          bv = b.is_late ? 1 : 0;
          return (av - bv) * dir;
        }
        return 0;
      });
      return arr;
    }


    function _renderMyAtt(data, sumEl, tblEl, month) {
      var s = (data && data.summary) || {};
      sumEl.innerHTML =
        '<div class="att-sum">' +
        [
          ['Full Days', 'full_days', 'var(--G)'],
          ['Half Days', 'half_days', 'var(--O)'],
          ['Late Days', 'late', 'var(--R)'],
          ['Absent', 'absent', 'var(--R)'],
          ['Holidays', 'holiday', '#4338ca'],
          ['Week Off', 'week_off', 'var(--tx2)']
        ].map(function (k) {
          return '<div class="att-kpi"><div class="val" style="color:' + k[2] + '">' +
            (s[k[1]] || 0) + '</div><div class="lbl">' + k[0] + '</div></div>';
        }).join('') +
        '</div>';

      var recs = (data && data.records) || [];
      if (!recs.length) {
        tblEl.innerHTML = '<div class="te"><i class="fas fa-calendar-times"></i> No attendance records for ' + month + '</div>';
        return;
      }

      var sorted = _myAttSortedRecords(recs);
      var key = _myAttSortKey || 'date';
      var dir = _myAttSortDir === 'asc' ? '↑' : '↓';

      function sortBtn(id, label, icon) {
        var active = (key === id);
        return '<button type="button" onclick="_myAttSort(\'' + id + '\')" ' +
          'style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;' +
          'border:1.5px solid ' + (active ? 'var(--P)' : 'var(--bdr)') + ';' +
          'background:' + (active ? 'var(--Pl)' : 'var(--bg)') + ';' +
          'color:' + (active ? 'var(--P)' : 'var(--tx2)') + '">' +
          (icon ? '<i class="fas ' + icon + '" style="font-size:10px;margin-right:4px"></i>' : '') +
          label + (active ? ' ' + dir : '') +
          '</button>';
      }

      tblEl.innerHTML =
        '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px;padding:0 2px">' +
        '<span style="font-size:10.5px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px;margin-right:4px">Sort:</span>' +
        sortBtn('date', 'Date', 'fa-calendar') +
        sortBtn('in', 'Punch IN', 'fa-sign-in-alt') +
        sortBtn('out', 'Punch OUT', 'fa-sign-out-alt') +
        sortBtn('hours', 'Hours', 'fa-clock') +
        sortBtn('status', 'Status', 'fa-tag') +
        sortBtn('late', 'Late', 'fa-hourglass-half') +
        '</div>' +
        '<div class="table-card"><div class="tw"><table><thead><tr>' +
        '<th>Date</th><th>Day</th>' +
        '<th style="color:var(--G)"><i class="fas fa-sign-in-alt"></i> Punch IN</th>' +
        '<th style="color:var(--R)"><i class="fas fa-sign-out-alt"></i> Punch OUT</th>' +
        '<th>Hours</th><th>Status</th><th>Punctuality</th>' +
        '</tr></thead><tbody>' +
        sorted.map(function (r) {
          var stBg = (r.status === 'Present') ? 'var(--Gl)'
            : (r.status === 'Absent') ? 'var(--Rl)'
              : (r.status === 'Half Day') ? 'var(--Ol)'
                : (r.status === 'Holiday') ? '#e0e7ff'
                  : 'var(--sur2)';
          var stClr = (r.status === 'Present') ? 'var(--G)'
            : (r.status === 'Absent') ? 'var(--R)'
              : (r.status === 'Half Day') ? 'var(--O)'
                : (r.status === 'Holiday') ? '#4338ca'
                  : 'var(--tx2)';

          var ciTxt = (!r.check_in || r.check_in === '-' || r.punch_in === '-')
            ? '—' : _esc(r.check_in || r.punch_in || '—');
          var coTxt = (!r.check_out || r.check_out === '-' || r.punch_out === '-')
            ? '—' : _esc(r.check_out || r.punch_out || '—');

          var punctHtml = '<span style="color:var(--tx3)">—</span>';
          if (r.is_late) {
            punctHtml =
              '<span style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--Rl);color:var(--R);white-space:nowrap">' +
              '<i class="fas fa-clock"></i> Late</span>' +
              (r.office_in
                ? '<div style="font-size:9px;color:var(--tx3);margin-top:2px">Office IN: ' + _esc(r.office_in) + '</div>'
                : '');
          } else if (r.check_in && r.check_in !== '-' && (r.status === 'Present' || r.status === 'Half Day')) {
            punctHtml =
              '<span style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--Gl);color:var(--G);white-space:nowrap">' +
              '<i class="fas fa-check"></i> On Time</span>';
          }

          var statusHtml =
            '<span style="display:inline-flex;align-items:center;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:' +
            stBg + ';color:' + stClr + ';white-space:nowrap">' + _esc(r.status || '—') + '</span>' +
            (r.half_day_reason
              ? '<div style="font-size:9px;color:var(--tx3);margin-top:2px">' + _esc(r.half_day_reason) + '</div>'
              : '');

          return '<tr>' +
            '<td style="font-weight:700">' + _fmtDate(r.date) + '</td>' +
            '<td style="color:var(--tx2);font-weight:600">' + _esc(r.day || r.day_name || '') + '</td>' +
            '<td style="font-weight:700;color:var(--G)">' + ciTxt + '</td>' +
            '<td style="font-weight:700;color:var(--R)">' + coTxt + '</td>' +
            '<td style="color:var(--P);font-weight:800">' + _cleanHours(r.total_hours) + '</td>' +
            '<td>' + statusHtml + '</td>' +
            '<td>' + punctHtml + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table></div></div>';
    }


    function _exportAtt() {
      var data = _D.myAtt;
      if (!data || !data.records || !data.records.length) {_toast('No attendance data to export', 'err'); return;}
      var rows = [['Date', 'Day', 'Shift', 'Punch In', 'Punch Out', 'Total Hours', 'Status']];
      data.records.forEach(function (r) {rows.push([r.date, r.day_name, r.shift, r.punch_in, r.punch_out, r.total_hours, r.status]);});
      _downloadCSV('attendance_' + (document.getElementById('amyMonth') ? document.getElementById('amyMonth').value : _currMonth()) + '.csv', rows);
    }
    function _alvForm() {
      return '<div class="fbar"><label>Month:</label><input type="month" id="alvMonth" value="' + _currMonth() + '"><button class="btn btn-sm" onclick="_loadLeave()"><i class="fas fa-search"></i> Load</button></div><div id="alvRes"></div>';
    }
    function _loadLeave() {
      var month = document.getElementById('alvMonth') ? document.getElementById('alvMonth').value : _currMonth();
      var el = document.getElementById('alvRes');
      if (!el) return;
      // Always fresh — no cache, so approved/rejected status always reflects latest
      el.innerHTML = _skel(1, 'sk-h6');
      _gas('getLeaveSummary', [_U.emp_code, month], function (rows) {
        if (!rows || !rows.length) {el.innerHTML = '<div class="te"><i class="fas fa-calendar-times"></i> No leave records for this month</div>'; return;}
        _D.leaveBalance = rows[0]; // update cache for other widgets
        _renderLeaveBalance(rows[0], el);
      }, function (e) {el.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';});
    }

    function _renderLeaveBalance(r, el) {
      el.innerHTML =
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:14px">' +
        [
          ['fa-calendar-week', 'WO Entitlement', r.week_off_entitlement || 0, 'var(--P)'],
          ['fa-umbrella-beach', 'WO Taken', r.week_off_taken || 0, 'var(--O)'],
          ['fa-coins', 'WO Extra Worked', r.week_off_worked || 0, 'var(--G)'],
          ['fa-suitcase', 'PTO Taken', r.pto_taken || r.paid_leave || 0, 'var(--V)'],
          ['fa-heart-pulse', 'Sick Leave', r.sick_leave || 0, 'var(--R)'],
          ['fa-triangle-exclamation', 'Unpaid', r.unpaid_taken || r.lwp || 0, 'var(--R)']
        ].map(function (k) {
          return '<div class="card card-nohover" style="text-align:center">' +
            '<div class="kpi-ico" style="margin:0 auto 12px;background:rgba(0,0,0,.04);color:' + k[3] + '"><i class="fas ' + k[0] + '"></i></div>' +
            '<div style="font-size:28px;font-weight:900;color:' + k[3] + ';margin-bottom:5px;letter-spacing:-1px">' + k[2] + '</div>' +
            '<div style="font-size:11px;color:var(--tx2);font-weight:700;text-transform:uppercase;letter-spacing:.4px">' + k[1] + '</div>' +
            '</div>';
        }).join('') +
        '</div>';
      if (r.extra_pay_estimate || r.daily_rate) {
        el.innerHTML += '<div class="card card-nohover" style="margin-top:12px;padding:12px 14px;font-size:12px;color:var(--tx2)">' +
          '<b style="color:var(--tx)">Policy estimate:</b> Daily ₹' + (r.daily_rate || 0) +
          ' · Extra pay (unused WO) ₹' + (r.extra_pay_estimate || 0) +
          (r.pto_remaining !== undefined ? ' · PTO left ' + r.pto_remaining : '') +
          '</div>';
      }
      _leaveSummaryExtra(r, el);
    }
    function _leaveSummaryExtra(r, el) {
      // Append pending/approved/rejected badges below the grid
      var extra = document.createElement('div');
      extra.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--bdr)';
      [
        ['Approved Days', r.total_approved || 0, 'var(--G)'],
        ['Pending Requests', r.total_pending || 0, 'var(--O)'],
        ['Rejected', r.total_rejected || 0, 'var(--R)']
      ].forEach(function (k) {
        extra.innerHTML += '<div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700"><span style="width:10px;height:10px;border-radius:50%;background:' + k[2] + ';display:inline-block"></span><span style="color:var(--tx2)">' + k[0] + ':</span><span style="color:' + k[2] + ';font-weight:900">' + k[1] + '</span></div>';
      });
      el.appendChild(extra);
    }
    function _alrForm() {
      return '<div style="display:grid;grid-template-columns:340px 1fr;gap:20px">' +
        '<div class="card card-nohover card-sm">' +
        '<div class="sec-title" style="margin-bottom:14px"><i class="fas fa-plane-departure" style="color:var(--T)"></i> New Leave Request</div>' +
        '<div class="fgrp"><label>Leave Type <span class="req">★</span></label>' +
        '<select id="lvrType">' +
        '<option>Weekly Off</option><option>PTO</option><option>Sick Leave</option><option>Unpaid</option><option>Casual Leave</option>' +
        '<option>Comp Off</option><option>WFH</option><option>LWP</option>' +
        '</select></div>' +
        '<div class="fgrp"><label>From <span class="req">★</span></label><input type="date" id="lvrFrom" value="' + _today() + '" style="width:100%"></div>' +
        '<div class="fgrp"><label>To <span class="req">★</span></label><input type="date" id="lvrTo" value="' + _today() + '" style="width:100%"></div>' +
        '<div class="fgrp"><label>Reason (optional)</label><textarea id="lvrReason" placeholder="Brief reason for leave..." rows="3"></textarea></div>' +
        '<button class="btn btn-teal btn-wide" id="btnSaveLvr" onclick="_saveLeaveReq()"><i class="fas fa-paper-plane"></i> Submit Request</button>' +
        '</div>' +
        '<div>' +
        '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-history" style="color:var(--tx2)"></i> My Request History</div>' +
        '<div id="lvrHist">' + _skel(3, 'sk-h4') + '</div>' +
        '</div>' +
        '</div>';
    }
    function _saveLeaveReq() {
      if (!_startSub('btnSaveLvr')) return;
      var type = document.getElementById('lvrType') ? document.getElementById('lvrType').value : 'Sick Leave';
      var from = document.getElementById('lvrFrom') ? document.getElementById('lvrFrom').value : '';
      var to = document.getElementById('lvrTo') ? document.getElementById('lvrTo').value : '';
      var reason = document.getElementById('lvrReason') ? document.getElementById('lvrReason').value.trim() : '';
      if (!_req(from, 'From Date') || !_req(to, 'To Date')) {_endSub('btnSaveLvr'); return;}
      if (to < from) {_toast('To Date cannot be before From Date', 'err'); _endSub('btnSaveLvr'); return;}
      _gas('requestLeave', [{leave_type: type, from_date: from, to_date: to, reason: reason}], function () {
        _successSub('btnSaveLvr', 'Submitted!');
        _toast('Leave request submitted!', 'ok');
        _addNtf('Leave request submitted: ' + type, 'fa-umbrella-beach', 'var(--Tl)', 'var(--T)', 'attend');
        _loadMyLeaveReqs();
      }, function (e) {_endSub('btnSaveLvr'); _toast('Error: ' + e.message, 'err');});
    }
    function _loadMyLeaveReqs() {
      var el = document.getElementById('lvrHist');
      if (!el) return;
      el.innerHTML = _skel(2, 'sk-h4');
      _gas('getLeaveRequests', [{}], function (reqs) {
        if (!reqs || !reqs.length) {el.innerHTML = '<div class="te"><i class="fas fa-inbox"></i>No leave requests found</div>'; return;}
        el.innerHTML = '<div class="table-card"><div class="tw"><table><thead><tr>' +
          '<th>Dates</th><th>Type</th><th>Days</th><th>Status</th><th>Remark</th>' +
          '</tr></thead><tbody>' +
          reqs.map(function (r) {
            var remark = _esc(r.remark || r.remarkbymanagement || '');
            return '<tr>' +
              '<td style="font-weight:700;white-space:nowrap">' + _fmtDate(r.from_date) + ' → ' + _fmtDate(r.to_date) + '</td>' +
              '<td>' + _esc(r.leave_type || '—') + '</td>' +
              '<td style="font-weight:800;text-align:center">' + (r.num_days || '—') + '</td>' +
              '<td>' + _statusBadge(r.status, true) + '</td>' +
              '<td style="font-size:12px;color:var(--tx3);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + remark + '">' + (remark || '—') + '</td>' +
              '</tr>';
          }).join('') +
          '</tbody></table></div></div>';
      }, function (e) {el.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';});
    }
    function _alaForm() {
      return '<div class="fbar">' +
        '<label>Filter:</label>' +
        '<select id="laprvStatus" onchange="_loadLeaveApprovals()">' +
        '<option value="Pending">Pending Only</option>' +
        '<option value="All">All Requests</option>' +
        '</select>' +
        '</div>' +
        '<div id="laprvList">' + _skel(4) + '</div>';
    }
    function _updateLeave(btn, status) {
      var rid = btn.getAttribute('data-rid');
      btn.disabled = true;
      _gas('approveLeaveRequest', [rid, status], function () {
        _toast('Leave ' + status + '!', 'ok');
        _addNtf('Leave request ' + status.toLowerCase(), status === 'Approved' ? 'fa-check-circle' : 'fa-times-circle', status === 'Approved' ? 'var(--Gl)' : 'var(--Rl)', status === 'Approved' ? 'var(--G)' : 'var(--R)');
        _loadLeaveApprovals();
      }, function (e) {_toast('Error: ' + e.message, 'err'); btn.disabled = false;});
    }
    function _amustForm() {
      return '<div class="fbar" style="flex-wrap:wrap;gap:10px">' +
        '<label>Dept:</label>' +
        '<select id="mustDept" style="min-width:140px">' +
        '<option value="All">All Departments</option>' +
        '</select>' +
        '<label>Month:</label><input type="month" id="mustMonth" value="' + _currMonth() + '" onchange="_loadMustTab()">' +
        '<button class="btn btn-sm" onclick="_loadMustTab()"><i class="fas fa-search"></i> Load</button>' +
        '<div class="fbar-spacer"></div>' +
        '<input type="text" id="mustSearch" placeholder="Search employee..." oninput="_filterMuster(this.value)" ' +
        'style="padding:7px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:12px;background:var(--bg);color:var(--tx);outline:none;width:180px">' +

        '</div>' +
        '<div style="display:flex;gap:16px;font-size:12px;font-weight:600;color:var(--tx2);margin-bottom:12px;flex-wrap:wrap;padding:10px 14px;background:var(--sur2);border-radius:8px;border:1px solid var(--bdr)">' +
        '<span style="color:var(--G)"><i class="fas fa-circle" style="font-size:8px"></i> Present</span>' +
        '<span style="color:var(--O)"><i class="fas fa-circle" style="font-size:8px"></i> Half Day</span>' +
        '<span style="color:var(--R)"><i class="fas fa-circle" style="font-size:8px"></i> Absent</span>' +
        '<span style="color:#4338ca"><i class="fas fa-circle" style="font-size:8px"></i> Holiday</span>' +
        '<span style="color:var(--tx3)"><i class="fas fa-circle" style="font-size:8px"></i> Week Off</span>' +
        '</div>' +
        '<div id="mustKrow" class="krow" style="margin-bottom:14px"></div>' +
        '<div id="mustTable">' + _skel(2) + '</div>';
    }


    function _populateDeptSel(selId, afterFn) {
      var sel = document.getElementById(selId);
      if (!sel) {if (afterFn) afterFn(); return;}
      var prev = sel.value || 'All';
      var opts = _getDeptOptions();
      if (opts) {
        sel.innerHTML = '<option value="All">All Departments</option>' + opts;
        // Restore previous selection
        for (var j = 0; j < sel.options.length; j++) {
          if (sel.options[j].value === prev) {sel.value = prev; break;}
        }
        if (afterFn) afterFn();
      } else {
        // _D.empDir empty — fetch doers first
        _gas('getDoerList', [], function (doers) {
          _D.doers = doers || [];
          var newOpts = _getDeptOptions();
          sel.innerHTML = '<option value="All">All Departments</option>' + newOpts;
          for (var j = 0; j < sel.options.length; j++) {
            if (sel.options[j].value === prev) {sel.value = prev; break;}
          }
          if (afterFn) afterFn();
        }, function () {if (afterFn) afterFn();});
      }
    }

    function _loadMustTab() {
      if (!_isManager()) return;
      var el = document.getElementById('mustTable');
      var kEl = document.getElementById('mustKrow');
      if (!el) return;
      _populateDeptSel('mustDept', function () {
        var month = (document.getElementById('mustMonth') || {}).value || _currMonth();
        var dSel = document.getElementById('mustDept');
        var dept = dSel ? dSel.value : 'All';
        var el = document.getElementById('mustTable');
        var kEl = document.getElementById('mustKrow');
        if (!el) return;
        el.innerHTML = _skel(4);
        if (kEl) kEl.innerHTML = [1, 2, 3, 4].map(function () {return '<div class="sk sk-h6" style="border-radius:14px"></div>';}).join('');

        _gas('getMusterGrid', [dept, month], function (res) {
          res = res || {};
          var rows = res.rows || [];
          var dates = res.dates || [];
          var hols = res.holidays || [];

          // ── KPIs ──────────────────────────────────────────────────────────
          if (kEl) {
            var totP = 0, totA = 0, totHD = 0, empCount = rows.length;
            rows.forEach(function (r) {totP += r.days_present || 0; totA += r.days_absent || 0; totHD += r.days_hd || 0;});
            var wkg = totP + totA + totHD;
            var avgPct = wkg > 0 ? Math.round((totP + totHD * 0.5) / wkg * 100) : 0;
            kEl.innerHTML = [
              {lbl: 'Employees', val: empCount, c: 'var(--P)', ico: 'fa-users'},
              {lbl: 'Present Days', val: totP, c: 'var(--G)', ico: 'fa-calendar-check'},
              {lbl: 'Absent Days', val: totA, c: 'var(--R)', ico: 'fa-calendar-times'},
              {lbl: 'Avg Presence', val: avgPct + '%', c: avgPct >= 80 ? 'var(--G)' : avgPct >= 60 ? 'var(--O)' : 'var(--R)', ico: 'fa-chart-pie'}
            ].map(function (k) {
              return '<div class="kpi" style="--kc:' + k.c + '">' +
                '<div class="kpi-ico"><i class="fas ' + k.ico + '"></i></div>' +
                '<div class="kpi-val">' + k.val + '</div>' +
                '<div class="kpi-lbl">' + k.lbl + '</div></div>';
            }).join('');
          }

          _renderMuster(rows, dates, hols, month);
        }, function (e) {
          if (el) el.innerHTML = '<div class="te"><i class="fas fa-exclamation-triangle"></i> Error: ' + _esc(e.message) + '</div>';
        });
      }); // end _populateDeptSel callback
    }

    function _renderMuster(rows, dates, hols, month) {
      var el = document.getElementById('mustTable');
      if (!el) return;
      if (!rows || !rows.length) {
        el.innerHTML = '<div class="te"><i class="fas fa-table"></i> No attendance records found for ' + month + '</div>';
        return;
      }

      var holSet = {};
      (hols || []).forEach(function (d) {holSet[d] = true;});
      var dowMap = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
      var dowFull = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      // Status display map
      function cellHtml(v, date) {
        var dow = new Date(date + 'T00:00:00').getDay();
        var isHol = holSet[date];
        var display, bg, fc;
        if (v === 'P' || v === 'FD') {display = 'P'; bg = 'rgba(47,158,68,.15)'; fc = 'var(--G)';}
        else if (v === 'HD') {display = 'HD'; bg = 'rgba(217,119,6,.15)'; fc = 'var(--O)';}
        else if (v === 'A') {display = 'A'; bg = 'rgba(224,49,49,.15)'; fc = 'var(--R)';}
        else if (v === 'H') {display = 'H'; bg = 'rgba(67,56,202,.12)'; fc = '#4338ca';}
        else if (v === 'WO' || dow === 0) {display = ''; bg = 'rgba(148,163,184,.08)'; fc = 'var(--tx4)';}
        else if (isHol) {display = 'H'; bg = 'rgba(67,56,202,.12)'; fc = '#4338ca';}
        else {display = ''; bg = 'transparent'; fc = 'var(--tx4)';}
        return '<td class="mst-cell" style="background:' + bg + ';color:' + fc + ';font-size:11px;font-weight:800">' + (display || '') + '</td>';
      }

      var html = '<div style="margin-bottom:8px;font-size:12px;color:var(--tx2)">' +
        '<i class="fas fa-users"></i> <b>' + rows.length + '</b> employees &nbsp;·&nbsp; <b>' + dates.length + '</b> days' +
        (hols && hols.length ? ' &nbsp;·&nbsp; <i class="fas fa-umbrella-beach" style="color:#4338ca"></i> <b>' + hols.length + '</b> holidays' : '') +
        '</div>' +
        '<div style="overflow-x:auto"><table class="muster-tbl" id="mstrGridTable"><thead><tr>' +
        '<th class="mst-emp">EMPLOYEE</th>' +
        '<th class="mst-pct" style="min-width:42px">P</th>' +
        '<th class="mst-pct" style="min-width:42px;color:var(--R)">A</th>' +
        '<th class="mst-pct" style="min-width:38px">%</th>' +
        dates.map(function (d) {
          var day = parseInt(d.split('-').pop());
          var dow = new Date(d + 'T00:00:00').getDay();
          var isHol = holSet[d];
          var bg = dow === 0 ? 'rgba(148,163,184,.1)' : isHol ? 'rgba(67,56,202,.08)' : '';
          return '<th class="mst-day" style="background:' + bg + '" title="' + dowFull[dow] + (isHol ? ' (Holiday)' : '') + '">' +
            '<div style="font-weight:700">' + day + '</div>' +
            '<div style="font-size:9px;opacity:.6">' + dowMap[dow] + '</div></th>';
        }).join('') +
        '</tr></thead><tbody>' +
        rows.map(function (r) {
          var pct = r.pct || 0;
          var pClr = pct >= 80 ? 'var(--G)' : pct >= 60 ? 'var(--O)' : 'var(--R)';
          return '<tr class="mstr-row">' +
            '<td class="mst-emp">' +
            '<div style="font-weight:700;font-size:12px">' + _esc(r.emp_name || '') + '</div>' +
            '<div style="font-size:10px;color:var(--tx3)">' + _esc(r.dept || '') + '</div>' +
            '</td>' +
            '<td class="mst-pct" style="color:var(--G);font-weight:800">' + (r.days_present || 0) + '</td>' +
            '<td class="mst-pct" style="color:var(--R);font-weight:800">' + (r.days_absent || 0) + '</td>' +
            '<td class="mst-pct" style="color:' + pClr + ';font-weight:900">' + pct + '%</td>' +
            dates.map(function (d) {return cellHtml(r[d], d);}).join('') +
            '</tr>';
        }).join('') +
        '</tbody></table></div>';

      el.innerHTML = html;
      _D.musterData = rows;
    }

    function _filterMuster(q) {
      q = (q || '').toLowerCase().trim();
      var rows = document.querySelectorAll('#mstrGridTable tbody tr.mstr-row');
      rows.forEach(function (r) {
        var txt = (r.cells[0] ? r.cells[0].textContent : '').toLowerCase();
        r.style.display = (!q || txt.indexOf(q) >= 0) ? '' : 'none';
      });
    }





    function _goALR() {_loadV('leave', 'lreq');}

    /* ══════════════════════════════════════════════════════════
       HOLIDAY CALENDAR MODULE
    ══════════════════════════════════════════════════════════ */
    function _calPrev() {_calM--; if (_calM < 0) {_calM = 11; _calY--;} _renderCal();}
    function _calNext() {_calM++; if (_calM > 11) {_calM = 0; _calY++;} _renderCal();}
    function _calGoToday() {_calY = new Date().getFullYear(); _calM = new Date().getMonth(); _renderCal();}

    function _renderCal() {
      var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      var lbl = document.getElementById('calMonthLbl');
      if (lbl) lbl.textContent = MONTHS[_calM] + ' ' + _calY;

      var firstDay = new Date(_calY, _calM, 1).getDay();
      var daysInMonth = new Date(_calY, _calM + 1, 0).getDate();
      var todayStr = _today();

      // Build holiday map
      var holMap = {};
      (_D.holidays || []).forEach(function (h) {
        var d = String(h.date || h.Date || h.holiday_date || '').substring(0, 10);
        var n = String(h.name || h.Name || h.holiday_name || h.Holiday || 'Holiday');
        if (d) holMap[d] = n;
      });

      var calBody = document.getElementById('calBody');
      if (!calBody) return;

      var html =
        '<div class="cal-hdr">' +
        DAYS.map(function (d) {return '<div class="cal-hdr-day">' + d + '</div>';}).join('') +
        '</div>' +
        '<div class="cal-grid">';

      // Padding before month start
      for (var i = 0; i < firstDay; i++) html += '<div class="cal-cell other-month"></div>';

      var holCount = 0; var weekendCount = 0; var workingCount = 0;

      for (var day = 1; day <= daysInMonth; day++) {
        var mm = String(_calM + 1).padStart(2, '0');
        var dd = String(day).padStart(2, '0');
        var dateStr = _calY + '-' + mm + '-' + dd;
        var dow = new Date(dateStr + 'T00:00:00').getDay();
        var isToday = dateStr === todayStr;
        var holName = holMap[dateStr];
        var isWkend = (dow === 0 || dow === 6);

        if (holName) holCount++;
        else if (isWkend) weekendCount++;
        else workingCount++;

        var cls = 'cal-cell' + (isToday ? ' today' : '') + (holName ? ' holiday' : '') + (isWkend && !holName ? ' weekend' : '');

        html += '<div class="' + cls + '"' + (holName ? ' title="' + _esc(holName) + '"' : '') + '>' +
          '<div class="cal-day-num">' + day + '</div>' +
          (holName ? '<div class="cal-hol-lbl">' + _esc(holName) + '</div>' : '') +
          '</div>';
      }
      html += '</div>';
      calBody.innerHTML = html;

      // Upcoming holidays
      var upEl = document.getElementById('holUpcoming');
      if (upEl) {
        var upcoming = Object.keys(holMap).filter(function (d) {return d >= todayStr;}).sort().slice(0, 10);
        if (!upcoming.length) {
          upEl.innerHTML = '<div style="font-size:12.5px;color:var(--tx3);font-weight:600">No upcoming holidays found</div>';
        } else {
          upEl.innerHTML = upcoming.map(function (d) {
            var dl = Math.ceil((new Date(d + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000);
            return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bdr)">' +
              '<div>' +
              '<div style="font-size:13px;font-weight:700">' + _esc(holMap[d]) + '</div>' +
              '<div style="font-size:11px;color:var(--tx3)">' + _fmtDate(d) + ' · ' + _dayName(d) + '</div>' +
              '</div>' +
              '<div style="font-size:12px;font-weight:900;color:' + (dl === 0 ? 'var(--G)' : dl <= 7 ? 'var(--O)' : 'var(--P)') + '">' +
              (dl === 0 ? 'Today' : dl + 'd') +
              '</div>' +
              '</div>';
          }).join('');
        }
      }

      // Monthly summary
      var sumEl = document.getElementById('calMonthlySummary');
      if (sumEl) {
        sumEl.innerHTML =
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">' +
          [
            {lbl: 'Working Days', val: workingCount, c: 'var(--G)'},
            {lbl: 'Weekends', val: weekendCount, c: 'var(--tx3)'},
            {lbl: 'Holidays', val: holCount, c: '#4338ca'}
          ].map(function (k) {
            return '<div style="text-align:center;padding:10px;background:var(--bg);border-radius:9px;border:1px solid var(--bdr)">' +
              '<div style="font-size:18px;font-weight:900;color:' + k.c + '">' + k.val + '</div>' +
              '<div style="font-size:9.5px;color:var(--tx2);font-weight:700;text-transform:uppercase;letter-spacing:.3px;margin-top:2px">' + k.lbl + '</div>' +
              '</div>';
          }).join('') +
          '</div>';
      }
    }

    /* ══════════════════════════════════════════════════════════
       MY PROFILE MODULE
    ══════════════════════════════════════════════════════════ */
    function _changePassword() {
      if (!_startSub('btnPwSave')) return;
      var np = document.getElementById('pwNew') ? document.getElementById('pwNew').value.trim() : '';
      var con = document.getElementById('pwCon') ? document.getElementById('pwCon').value.trim() : '';
      if (!_req(np, 'New Password')) {_endSub('btnPwSave'); return;}
      if (np.length < 4) {_toast('Password must be at least 4 characters', 'err'); _endSub('btnPwSave'); return;}
      if (np !== con) {_toast('Passwords do not match', 'err'); _endSub('btnPwSave'); return;}
      _gas('changePassword', [np], function () {
        _endSub('btnPwSave');
        _toast('Password changed successfully!', 'ok');
        if (document.getElementById('pwNew')) document.getElementById('pwNew').value = '';
        if (document.getElementById('pwCon')) document.getElementById('pwCon').value = '';
        _addNtf('Password updated', 'fa-lock', 'var(--Gl)', 'var(--G)');
      }, function (e) {_endSub('btnPwSave'); _toast('Error: ' + e.message, 'err');});
    }

    /* ══════════════════════════════════════════════════════════
       EMPLOYEE DIRECTORY MODULE
    ══════════════════════════════════════════════════════════ */
    function _filterDir(q) {
      var q2 = (q || '').toLowerCase();
      var dept = document.getElementById('dirDept') ? document.getElementById('dirDept').value : '';
      var role = document.getElementById('dirRole') ? document.getElementById('dirRole').value : '';
      var emps = (_D.empDir || []).filter(function (e) {
        var mq = !q2 || (e.name + ' ' + e.dept + ' ' + e.email).toLowerCase().indexOf(q2) > -1;
        var md = !dept || e.dept === dept;
        var mr = !role || e.role === role;
        return mq && md && mr;
      });
      _renderDir(emps);
    }
    function _renderDir(emps) {
      var cnt = document.getElementById('dirCount');
      if (cnt) cnt.textContent = emps.length + ' member' + (emps.length !== 1 ? 's' : '') + ' found';
      var grid = document.getElementById('dirGrid');
      if (!grid) return;
      if (!emps.length) {
        grid.innerHTML = '<div class="te" style="grid-column:1/-1"><i class="fas fa-users"></i>No employees match your filters</div>';
        return;
      }
      grid.innerHTML = emps.map(function (e) {
        var init = _initials(e.name);
        var roleClr = e.role === 'OWNER' ? 'var(--R)' : e.role === 'MANAGER' ? 'var(--V)' : 'var(--P)';
        return '<div class="emp-card" onclick="_loadEmpDetail(\'' + _esc(e.emp_id) + '\')">' +
          '<div class="ec-ava">' + (e.photo ? '<img src="' + e.photo + '" alt="' + _esc(e.name) + '" onerror="this.outerHTML=\'' + init + '\'">' : init) + '</div>' +
          '<div class="ec-name" title="' + _esc(e.name) + '">' + _esc(e.name) + '</div>' +
          '<div class="ec-dept">' + _esc(e.dept || '—') + '</div>' +
          '<div class="ec-role" style="background:rgba(0,0,0,.0);color:' + roleClr + ';border:1.5px solid ' + roleClr + '">' + _esc(e.role) + '</div>' +
          '<div class="ec-email">' + _esc(e.email || '—') + '</div>' +
          (e.overdue_delegations > 0 ? '<div class="ec-ovr"><i class="fas fa-triangle-exclamation"></i> ' + e.overdue_delegations + ' overdue</div>' : '') +
          '</div>';
      }).join('');
    }
    function _exportDir() {
      var emps = _D.empDir || [];
      if (!emps.length) {_toast('No data to export', 'err'); return;}
      var rows = [['Emp ID', 'Name', 'Department', 'Email', 'Role', 'Overdue Delegations']];
      emps.forEach(function (e) {rows.push([e.emp_id, e.name, e.dept, e.email, e.role, e.overdue_delegations]);});
      _downloadCSV('employee_directory_' + _today() + '.csv', rows);
    }
    function _goDelegTo(empId, empName) {
      _loadV('deleg', 'dcr');
      setTimeout(function () {
        var sel = document.getElementById('dcrTo');
        if (!sel) {setTimeout(function () {_goDelegTo(empId, empName);}, 300); return;}
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === empId) {sel.selectedIndex = i; break;}
        }
      }, 500);
    }

    /* ══════════════════════════════════════════════════════════
       ANALYTICS MODULE
    ══════════════════════════════════════════════════════════ */

    /* ══════════════════════════════════════════════════════════
       PERFORMANCE REPORTS MODULE
    ══════════════════════════════════════════════════════════ */

    function _ptopForm() {
      return '<div class="fbar">' +
        '<label>From:</label><input type="date" id="ptFrom" value="' + _daysAgo(30) + '">' +
        '<label>To:</label><input type="date" id="ptTo" value="' + _today() + '">' +
        '<button class="btn btn-sm" onclick="_loadTopPerformers()"><i class="fas fa-trophy"></i> Load</button>' +
        '<div class="fbar-spacer"></div>' +

        '</div><div id="ptContent"></div>';
    }
    function _exportTopPerf() {
      var tops = _D.topPerf || [];
      if (!tops.length) {_toast('No data', 'err'); return;}
      var rows = [['Rank', 'Employee', 'Department', 'Tasks Done']];
      tops.forEach(function (e, i) {rows.push([i + 1, e.name, e.dept, e.done]);});
      _downloadCSV('top_performers_' + _today() + '.csv', rows);
    }

    function _pindForm() {
      return '<div class="fbar">' +
        '<label>Employee:</label><select id="pindEmp" style="min-width:180px"><option value="' + (_U && _U.emp_code || '') + '">' + _esc((_U && _U.name) || 'Me') + ' (Me)</option></select>' +
        '<label>From:</label><input type="date" id="pindFrom" value="' + _daysAgo(30) + '">' +
        '<label>To:</label><input type="date" id="pindTo" value="' + _today() + '">' +
        '<button class="btn btn-sm" onclick="_loadIndivPerf()"><i class="fas fa-search"></i> Load</button>' +
        '<div class="fbar-spacer"></div>' +

        '</div><div id="pindContent"></div>';
    }
    function _exportIndPerf() {
      var rpt = _D.indPerf;
      if (!rpt || !rpt.daily_trend) {_toast('No data', 'err'); return;}
      var rows = [['Date', 'Tasks Done']];
      rpt.daily_trend.forEach(function (d) {rows.push([d.date, d.done]);});
      _downloadCSV('individual_performance_' + _today() + '.csv', rows);
    }

    function _pteamForm() {
      return '<div class="fbar">' +
        '<label>Department:</label>' +
        '<select id="pteamDept"><option value="All">All Departments</option><option>Admin</option><option>Accounts</option><option>Finance</option><option>Marketing</option></select>' +
        '<label>Month:</label><input type="month" id="pteamMonth" value="' + _currMonth() + '">' +
        '<button class="btn btn-sm" onclick="_loadTeamPerf()"><i class="fas fa-search"></i> Load</button>' +
        '<div class="fbar-spacer"></div>' +

        '</div><div id="pteamContent"></div>';
    }
    function _loadTeamPerf() {
      var dept = document.getElementById('pteamDept') ? document.getElementById('pteamDept').value : 'All';
      var month = document.getElementById('pteamMonth') ? document.getElementById('pteamMonth').value : _currMonth();
      var el = document.getElementById('pteamContent');
      if (!el) return;
      el.innerHTML = _skel();

      _gas('getTopPerformers', [month + '-01', month + '-31'], function (tops) {
        _D.teamPerf = tops;
        var filtered = dept === 'All' ? tops : tops.filter(function (e) {return e.dept === dept;});
        if (!filtered.length) {el.innerHTML = '<div class="te"><i class="fas fa-users"></i>No team data</div>'; return;}
        var maxVal = filtered[0].done || 1;
        el.innerHTML =
          '<div class="table-card"><div class="tw"><table><thead><tr>' +
          '<th>Rank</th><th>Employee</th><th>Department</th><th>Tasks Done</th><th style="width:100%;max-width:220px">Performance Bar</th>' +
          '</tr></thead><tbody>' +
          filtered.map(function (e, i) {
            var pct = Math.round(e.done / maxVal * 100);
            return '<tr>' +
              '<td style="font-size:18px;font-weight:900;color:' + (i === 0 ? '#92400e' : i === 1 ? '#334155' : i === 2 ? '#7c3aed' : 'var(--tx2)') + '">' + (i + 1) + '</td>' +
              '<td style="font-weight:800">' + _esc(e.name) + '</td>' +
              '<td><span class="tag">' + _esc(e.dept) + '</span></td>' +
              '<td style="font-weight:900;font-size:17px;color:var(--P)">' + e.done + '</td>' +
              '<td><div style="display:flex;align-items:center;gap:8px"><div class="pbar-wrap" style="flex:1;margin:0"><div class="pbar" style="width:' + pct + '%;background:' + (i === 0 ? 'var(--G)' : 'var(--P)') + '"></div></div><span style="font-size:11px;font-weight:700;color:var(--tx2);min-width:32px">' + pct + '%</span></div></td>' +
              '</tr>';
          }).join('') +
          '</tbody></table></div></div>';
      }, function (e) {el.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';});
    }

    /* ══════════════════════════════════════════════════════════
       DELEGATION ANALYTICS MODULE
    ══════════════════════════════════════════════════════════ */

    /* ══════════════════════════════════════════════════════════
       ATTENDANCE ANALYTICS MODULE
    ══════════════════════════════════════════════════════════ */

    /* ══════════════════════════════════════════════════════════
       KEYBOARD SHORTCUTS & GLOBAL NAVIGATION
    ══════════════════════════════════════════════════════════ */
    document.addEventListener('keydown', function (e) {
      // ⌘K → Global Search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {e.preventDefault(); _openGS(); return;}
      // Alt+Number shortcuts for quick navigation
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        var numMap = {'1': 'dash', '2': 'check', '3': 'deleg', '4': 'attend', '5': 'profile', '6': 'profile', '7': 'em', '9': 'empdir'};
        if (numMap[e.key]) {e.preventDefault(); _loadV(numMap[e.key]);}
      }
      // ? → Show keyboard shortcuts help
      if (e.key === '?' && !e.target.closest('input,textarea,select')) {_showShortcuts();}
    });

    /* ══════════════════════════════════════════════════════════
       KEYBOARD SHORTCUTS HELP PANEL
    ══════════════════════════════════════════════════════════ */

    /* ══════════════════════════════════════════════════════════
       PRINT / PDF EXPORT
    ══════════════════════════════════════════════════════════ */
    /* Print the current content area as-is */

    /* ══════════════════════════════════════════════════════════
       DATA VALIDATION UTILITIES
       Complete validation library used across all forms
    ══════════════════════════════════════════════════════════ */

    /* Validate that a date string is a valid ISO date */
    function _validDate(s) {
      if (!s) return false;
      var d = new Date(s + 'T00:00:00');
      return !isNaN(d.getTime());
    }

    /* Validate that from <= to */
    function _validDateRange(from, to) {
      if (!_validDate(from) || !_validDate(to)) return false;
      return new Date(from) <= new Date(to);
    }

    /* Validate email format */
    function _validEmail(email) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    /* Validate minimum string length */
    function _minLen(s, n, lbl) {
      if (String(s || '').trim().length < n) {
        _toast(lbl + ' must be at least ' + n + ' characters', 'err');
        return false;
      }
      return true;
    }

    /* Validate maximum string length */
    function _maxLen(s, n, lbl) {
      if (String(s || '').trim().length > n) {
        _toast(lbl + ' cannot exceed ' + n + ' characters', 'err');
        return false;
      }
      return true;
    }

    /* Validate that a numeric value is within a range */
    function _inRange(v, min, max, lbl) {
      var n = Number(v);
      if (isNaN(n) || n < min || n > max) {
        _toast(lbl + ' must be between ' + min + ' and ' + max, 'err');
        return false;
      }
      return true;
    }

    /* Highlight an input field with error state */
    function _fieldErr(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.style.borderColor = 'var(--R)';
      el.style.boxShadow = '0 0 0 3px var(--Rl)';
      el.focus();
      setTimeout(function () {el.style.borderColor = ''; el.style.boxShadow = '';}, 2500);
    }

    /* Clear all error states on a form */
    function _clearErrors(formId) {
      var form = document.getElementById(formId);
      if (!form) return;
      form.querySelectorAll('input,select,textarea').forEach(function (el) {
        el.style.borderColor = '';
        el.style.boxShadow = '';
      });
    }

    /* ══════════════════════════════════════════════════════════
       TOAST QUEUE — Multiple toasts in sequence
    ══════════════════════════════════════════════════════════ */
    var _toastQ = [];
    var _toastPlaying = false;

    function _toastQ_push(msg, type, delay) {
      _toastQ.push({msg: msg, type: type, delay: delay || 0});
      if (!_toastPlaying) _toastQ_play();
    }

    function _toastQ_play() {
      if (!_toastQ.length) {_toastPlaying = false; return;}
      _toastPlaying = true;
      var item = _toastQ.shift();
      setTimeout(function () {
        _toast(item.msg, item.type);
        setTimeout(_toastQ_play, 3600);
      }, item.delay);
    }

    /* ══════════════════════════════════════════════════════════
       SESSION MANAGEMENT
    ══════════════════════════════════════════════════════════ */
    /* Auto-save last viewed section to sessionStorage */
    function _saveNavState() {
      try {
        sessionStorage.setItem('fk_last_view', JSON.stringify({v: _V, st: _ST, ts: Date.now()}));
      } catch (e) { }
    }

    /* Restore last nav state on app boot */
    function _restoreNavState() {
      try {
        var saved = JSON.parse(sessionStorage.getItem('fk_last_view') || 'null');
        if (saved && saved.v && (Date.now() - saved.ts) < 3600000) {
          return {view: saved.v, sub: saved.st};
        }
      } catch (e) { }
      return null;
    }

    /* ══════════════════════════════════════════════════════════
       RESPONSIVE UTILITY — Detect breakpoints
    ══════════════════════════════════════════════════════════ */
    function _isMobile() {return window.innerWidth <= 640;}
    function _isTablet() {return window.innerWidth > 640 && window.innerWidth <= 960;}
    function _isDesktop() {return window.innerWidth > 960;}

    /* Debounce utility for resize/input handlers */
    function _debounce(fn, delay) {
      var timer;
      return function () {
        var args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () {fn.apply(null, args);}, delay);
      };
    }

    /* Throttle utility for scroll handlers */
    function _throttle(fn, limit) {
      var last = 0;
      return function () {
        var now = Date.now();
        if (now - last >= limit) {last = now; fn.apply(null, arguments);}
      };
    }

    /* Responsive chart height adjustment */
    function _chartH() {return _isMobile() ? 180 : _isTablet() ? 220 : 280;}

    /* ══════════════════════════════════════════════════════════
       CLIPBOARD UTILITIES
    ══════════════════════════════════════════════════════════ */
    function _copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          _toast('Copied to clipboard!', 'ok');
        }).catch(function () {
          _copyFallback(text);
        });
      } else {
        _copyFallback(text);
      }
    }
    function _copyFallback(text) {
      var el = document.createElement('textarea');
      el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
      document.body.appendChild(el); el.select();
      try {document.execCommand('copy'); _toast('Copied!', 'ok');} catch (e) {_toast('Copy failed', 'err');}
      document.body.removeChild(el);
    }

    /* ══════════════════════════════════════════════════════════
       LOCAL STORAGE WRAPPER — Safe JSON operations
    ══════════════════════════════════════════════════════════ */
    var _store = {
      get: function (key, def) {
        try {var v = localStorage.getItem('fk_' + key); return v !== null ? JSON.parse(v) : def;}
        catch (e) {return def;}
      },
      set: function (key, val) {
        try {localStorage.setItem('fk_' + key, JSON.stringify(val));} catch (e) { }
      },
      del: function (key) {
        try {localStorage.removeItem('fk_' + key);} catch (e) { }
      }
    };

    /* ══════════════════════════════════════════════════════════
       CHART THEME — Returns Chart.js default options for dark/light
    ══════════════════════════════════════════════════════════ */
    function _chartDefaults() {
      var textColor = _dark ? '#94a3b8' : '#64748b';
      var gridColor = _dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)';
      return {
        textColor: textColor,
        gridColor: gridColor,
        scales: {
          x: {
            grid: {color: 'transparent'},
            ticks: {color: textColor, font: {size: 11, family: "'Plus Jakarta Sans', sans-serif"}}
          },
          y: {
            grid: {color: gridColor},
            ticks: {color: textColor, font: {size: 11, family: "'Plus Jakarta Sans', sans-serif"}}
          }
        },
        plugins: {
          legend: {
            labels: {color: textColor, font: {size: 12, family: "'Plus Jakarta Sans', sans-serif"}, padding: 16}
          },
          tooltip: {
            backgroundColor: _dark ? '#1e293b' : '#0f172a',
            titleColor: '#f1f5f9', bodyColor: '#cbd5e1',
            borderColor: _dark ? '#334155' : '#1e293b', borderWidth: 1,
            padding: 10, cornerRadius: 8
          }
        }
      };
    }

    /* ══════════════════════════════════════════════════════════
       CHART.JS GLOBAL DEFAULTS — Applied once on load
    ══════════════════════════════════════════════════════════ */
    (function _setChartDefaults() {
      if (typeof Chart !== 'undefined') {
        Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
        Chart.defaults.font.size = 12;
        Chart.defaults.color = '#94a3b8';
        Chart.defaults.animation = {duration: 600, easing: 'easeInOutQuart'};
        Chart.defaults.plugins.tooltip.cornerRadius = 8;
        Chart.defaults.plugins.tooltip.padding = 10;
        Chart.defaults.plugins.legend.labels.usePointStyle = true;
        Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
      }
    }());

    /* ══════════════════════════════════════════════════════════
       SETTINGS PANEL — User preferences sidebar
    ══════════════════════════════════════════════════════════ */
    var _settingsOpen = false;

    function _openSettings() {
      var existing = document.getElementById('settingsPanel');
      if (existing) {existing.remove(); _settingsOpen = false; return;}
      _settingsOpen = true;

      var pref = {
        dense: _store.get('dense', false),
        animate: _store.get('animate', true),
        notify: _store.get('notify', true)
      };

      var panel = document.createElement('div');
      panel.id = 'settingsPanel';
      panel.style.cssText = 'position:fixed;top:0;right:0;height:100vh;width:320px;background:var(--sur);border-left:1px solid var(--bdr);z-index:850;box-shadow:-8px 0 32px rgba(0,0,0,.15);display:flex;flex-direction:column;animation:fadein .2s ease both';

      panel.innerHTML =
        '<div style="padding:20px 20px 14px;border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between">' +
        '<div style="font-size:16px;font-weight:800"><i class="fas fa-sliders" style="color:var(--P);margin-right:9px"></i>Preferences</div>' +
        '<button onclick="document.getElementById(\'settingsPanel\').remove()" style="background:none;border:none;font-size:18px;color:var(--tx2);cursor:pointer;padding:4px">×</button>' +
        '</div>' +
        '<div style="padding:20px;flex:1;overflow-y:auto">' +

        '<div style="font-size:11px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.7px;margin-bottom:12px">Appearance</div>' +

        _mkToggle('Dark Mode', 'Reduce eye strain with dark colors', _dark, '_toggleDark()') +
        _mkToggle('Dense Layout', 'More content with less spacing', pref.dense, '_togglePref(\'dense\', this)') +
        _mkToggle('Animations', 'Enable transition effects', pref.animate, '_togglePref(\'animate\', this)') +

        '<div style="font-size:11px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.7px;margin:20px 0 12px">Notifications</div>' +

        _mkToggle('In-App Notifications', 'Show notification badges and alerts', pref.notify, '_togglePref(\'notify\', this)') +

        '<div style="font-size:11px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.7px;margin:20px 0 12px">Account</div>' +

        '<div style="background:var(--bg);border:1px solid var(--bdr);border-radius:10px;padding:14px">' +
        '<div style="font-size:13px;font-weight:700;margin-bottom:3px">' + _esc(_U ? _U.name : 'User') + '</div>' +
        '<div style="font-size:11px;color:var(--tx2)">' + _esc(_U ? (_U.dept + ' · ' + _U.role) : '') + '</div>' +
        '<div style="font-size:11px;color:var(--tx3);margin-top:6px">' + _esc(_U ? _U.email : '') + '</div>' +
        '</div>' +
        '<button class="btn btn-outline btn-sm" style="width:100%;margin-top:12px" onclick="_loadV(\'profile\');document.getElementById(\'settingsPanel\').remove()">' +
        '<i class="fas fa-circle-user"></i> Edit Profile & Password' +
        '</button>' +

        '<div style="font-size:11px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.7px;margin:20px 0 12px">System</div>' +

        '<div style="display:flex;flex-direction:column;gap:8px">' +
        '<button class="btn btn-outline btn-sm" style="width:100%;" onclick="_printView()"><i class="fas fa-print"></i> Print Current View</button>' +
        '<button class="btn btn-outline btn-sm" style="width:100%" onclick="_showShortcuts()"><i class="fas fa-keyboard"></i> Keyboard Shortcuts</button>' +
        '<button class="btn btn-outline btn-sm" style="width:100%" onclick="_clearNtfs()"><i class="fas fa-bell-slash"></i> Clear Notifications</button>' +
        '</div>' +

        '</div>' +
        '<div style="padding:14px 20px;border-top:1px solid var(--bdr)">' +
        '<div style="font-size:10px;color:var(--tx3);font-weight:600">Joolry Daily &nbsp;·&nbsp; &copy; 2026 Joolry</div>' +
        '</div>';

      document.body.appendChild(panel);
    }

    function _mkToggle(label, desc, checked, handler) {
      var id = 'tog_' + Math.random().toString(36).slice(2, 7);
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--bg);border:1px solid var(--bdr);border-radius:10px;margin-bottom:8px">' +
        '<div>' +
        '<div style="font-size:13px;font-weight:700">' + label + '</div>' +
        '<div style="font-size:11px;color:var(--tx3);margin-top:2px">' + desc + '</div>' +
        '</div>' +
        '<label style="position:relative;width:44px;height:24px;flex-shrink:0;cursor:pointer">' +
        '<input type="checkbox" id="' + id + '" ' + (checked ? 'checked' : '') + ' onchange="' + handler + '" ' +
        'style="position:absolute;opacity:0;width:0;height:0">' +
        '<span style="position:absolute;inset:0;background:' + (checked ? 'var(--P)' : 'var(--bdr2)') + ';border-radius:12px;transition:background .2s">' +
        '<span style="position:absolute;left:' + (checked ? '22px' : '2px') + ';top:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:left .2s;box-shadow:0 1px 4px rgba(0,0,0,.2)"></span>' +
        '</span>' +
        '</label>' +
        '</div>';
    }

    function _togglePref(key, el) {
      var val = el.checked;
      _store.set(key, val);
      if (key === 'animate') document.body.style.setProperty('--anim', val ? '.3s' : '0s');
    }

    /* ══════════════════════════════════════════════════════════
       INLINE HELP / TOOLTIPS SYSTEM
    ══════════════════════════════════════════════════════════ */
    /* Creates a question mark icon that shows an inline help tooltip */
    function _helpIco(text) {
      return '<span class="help-ico" title="' + _esc(text) + '" ' +
        'style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--Il);color:var(--I);font-size:10px;cursor:help;margin-left:5px;font-weight:800;vertical-align:middle">' +
        '?' +
        '</span>';
    }

    /* ══════════════════════════════════════════════════════════
       BULK ACTIONS — Multi-select for delegation / task management
    ══════════════════════════════════════════════════════════ */
    var _selectedItems = new Set();

    function _toggleItemSel(id, el) {
      if (el.checked) _selectedItems.add(id);
      else _selectedItems.delete(id);
      _updateBulkBar();
    }

    function _selectAllItems(els) {
      document.querySelectorAll('.bulk-cb').forEach(function (cb) {
        cb.checked = els.checked;
        if (els.checked) _selectedItems.add(cb.getAttribute('data-id'));
        else _selectedItems.delete(cb.getAttribute('data-id'));
      });
      _updateBulkBar();
    }

    function _updateBulkBar() {
      var bar = document.getElementById('bulkBar');
      if (!bar) return;
      if (_selectedItems.size > 0) {
        bar.style.display = 'flex';
        var cnt = bar.querySelector('.bulk-cnt');
        if (cnt) cnt.textContent = _selectedItems.size + ' selected';
      } else {
        bar.style.display = 'none';
      }
    }

    function _clearSelection() {
      _selectedItems.clear();
      document.querySelectorAll('.bulk-cb').forEach(function (cb) {cb.checked = false;});
      _updateBulkBar();
    }

    /* Build a floating bulk actions bar */
    function _mkBulkBar(actions) {
      return '<div id="bulkBar" style="display:none;position:sticky;bottom:20px;left:0;right:0;background:var(--sb);color:#e2e8f0;border-radius:12px;padding:10px 16px;align-items:center;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,.35);z-index:100;margin-top:14px">' +
        '<span class="bulk-cnt" style="font-size:13px;font-weight:700;flex:1">0 selected</span>' +
        actions.map(function (a) {
          return '<button class="btn btn-sm" style="background:' + (a.c || 'rgba(255,255,255,.1)') + ';color:#fff;border:none" onclick="' + a.fn + '">' +
            '<i class="fas ' + a.ico + '"></i> ' + a.lbl +
            '</button>';
        }).join('') +
        '<button class="btn btn-sm" style="background:rgba(255,255,255,.08);color:#94a3b8" onclick="_clearSelection()"><i class="fas fa-times"></i> Clear</button>' +
        '</div>';
    }

    /* ══════════════════════════════════════════════════════════
       ANIMATED COUNTER — For KPI values
    ══════════════════════════════════════════════════════════ */
    function _animateCounter(el, from, to, duration) {
      if (!el) return;
      var start = null;
      var isFloat = String(to).indexOf('.') > -1;
      var suffix = isFloat ? '%' : '';
      var fromN = parseFloat(from) || 0;
      var toN = parseFloat(to) || 0;

      function step(ts) {
        if (!start) start = ts;
        var pct = Math.min((ts - start) / (duration || 800), 1);
        var ease = 1 - Math.pow(1 - pct, 3); // ease-out cubic
        var val = fromN + (toN - fromN) * ease;
        el.textContent = isFloat ? val.toFixed(1) + suffix : Math.round(val) + suffix;
        if (pct < 1) requestAnimationFrame(step);
        else el.textContent = to + suffix;
      }
      requestAnimationFrame(step);
    }

    /* ══════════════════════════════════════════════════════════
       DATA CACHING — Prevent redundant GAS calls
    ══════════════════════════════════════════════════════════ */
    var _cache = {};
    var _cacheTTL = 5 * 60 * 1000; // 5 minutes

    function _cacheGet(key) {
      var entry = _cache[key];
      if (!entry) return null;
      if (Date.now() - entry.ts > _cacheTTL) {delete _cache[key]; return null;}
      return entry.data;
    }
    function _cacheSet(key, data) {
      _cache[key] = {data: data, ts: Date.now()};
    }
    function _cacheClear(key) {
      if (key) delete _cache[key];
      else _cache = {};
    }

    /* Cached version of _gas for read-only calls */
    function _gasC(fn, args, onOk, onErr) {
      var key = fn + ':' + JSON.stringify(args || []);
      var hit = _cacheGet(key);
      if (hit) {if (onOk) onOk(hit); return;}
      _gas(fn, args, function (r) {_cacheSet(key, r); if (onOk) onOk(r);}, onErr);
    }

    /* ══════════════════════════════════════════════════════════
       QUICK TASK ENTRY — FAB style floating input
    ══════════════════════════════════════════════════════════ */
    var _fabOpen = false;

    function _openFAB() {
      var existing = document.getElementById('fabMenu');
      if (existing) {existing.remove(); _fabOpen = false; return;}
      _fabOpen = true;

      var fab = document.createElement('div');
      fab.id = 'fabMenu';
      fab.style.cssText = 'position:fixed;bottom:80px;right:24px;background:var(--sur);border:1px solid var(--bdr);border-radius:14px;box-shadow:var(--shad3);z-index:700;min-width:200px;animation:slideup .2s ease forwards;overflow:hidden';
      fab.innerHTML = [
        {ico: 'fa-list-check', lbl: 'Today\'s Tasks', fn: "_loadV('check')"},
        {ico: 'fa-people-arrows', lbl: 'Create Delegation', fn: "_goDCr()"},
        {ico: 'fa-umbrella-beach', lbl: 'Request Leave', fn: "_goALR()"},
        {ico: 'fa-bullhorn', lbl: 'Post Announcement', fn: "_loadV('ann');setTimeout(_openPostAnn,500)", mgr: true},
        {ico: 'fa-bolt', lbl: 'Activity Feed', fn: "_loadV('feed')"}
      ].filter(function (a) {return !a.mgr || _isManager();}).map(function (a, i) {
        return '<div onclick="' + a.fn + ';document.getElementById(\'fabMenu\').remove()" ' +
          'style="display:flex;align-items:center;gap:11px;padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--bdr);transition:background .1s" ' +
          'onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">' +
          '<div style="width:28px;height:28px;border-radius:7px;background:var(--Pl);color:var(--P);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">' +
          '<i class="fas ' + a.ico + '"></i>' +
          '</div>' +
          '<span style="font-size:13px;font-weight:700">' + a.lbl + '</span>' +
          '</div>';
      }).join('');
      document.body.appendChild(fab);

      // Auto-close on outside click
      setTimeout(function () {
        document.addEventListener('click', function fabClose(e) {
          if (!fab.contains(e.target)) {fab.remove(); _fabOpen = false; document.removeEventListener('click', fabClose);}
        });
      }, 100);
    }

    /* ══════════════════════════════════════════════════════════
       DASHBOARD WIDGETS — Extended Stats Cards
    ══════════════════════════════════════════════════════════ */

    /* Mini sparkline chart rendered as SVG inline */
    function _sparkline(values, color) {
      if (!values || values.length < 2) return '';
      var max = Math.max.apply(null, values);
      var min = Math.min.apply(null, values);
      var h = 32; var w = 80;
      var range = max - min || 1;
      var pts = values.map(function (v, i) {
        var x = Math.round(i / (values.length - 1) * w);
        var y = Math.round(h - (v - min) / range * h);
        return x + ',' + y;
      });
      return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" style="display:block">' +
        '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + (color || 'var(--P)') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<circle cx="' + pts[pts.length - 1].split(',')[0] + '" cy="' + pts[pts.length - 1].split(',')[1] + '" r="3" fill="' + (color || 'var(--P)') + '"/>' +
        '</svg>';
    }

    /* Extended KPI card with sparkline and trend */
    function _kpiCardEx(opts) {
      var pct = opts.max > 0 ? Math.round(opts.val / opts.max * 100) : 0;
      var trend = opts.prev != null ?
        (opts.val > opts.prev ? '<span class="kpi-trend up"><i class="fas fa-arrow-trend-up"></i>+' + (opts.val - opts.prev) + ' vs last period</span>' :
          opts.val < opts.prev ? '<span class="kpi-trend dn"><i class="fas fa-arrow-trend-down"></i>-' + (opts.prev - opts.val) + ' vs last period</span>' :
            '<span class="kpi-trend same"><i class="fas fa-minus"></i>No change</span>') : '';
      return '<div class="kpi" style="--kc:' + (opts.color || 'var(--P)') + '">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between">' +
        '<div class="kpi-ico"><i class="fas ' + (opts.ico || 'fa-chart-bar') + '"></i></div>' +
        (opts.spark ? _sparkline(opts.spark, opts.color) : '') +
        '</div>' +
        '<div class="kpi-val">' + (opts.val != null ? opts.val : '—') + (opts.suffix || '') + '</div>' +
        '<div class="kpi-lbl">' + (opts.lbl || '') + '</div>' +
        (opts.max ? '<div class="kpi-bar-wrap"><div class="kpi-bar" style="width:' + pct + '%"></div></div>' : '') +
        trend +
        '</div>';
    }

    /* ══════════════════════════════════════════════════════════
       DATE PICKER ENHANCEMENTS
       Quick date range selector component
    ══════════════════════════════════════════════════════════ */
    function _quickDateRange(fromId, toId, containerId) {
      var presets = [
        {lbl: 'Today', from: _today(), to: _today()},
        {lbl: 'Yesterday', from: _daysAgo(1), to: _daysAgo(1)},
        {lbl: 'Last 7 Days', from: _daysAgo(7), to: _today()},
        {lbl: 'Last 30 Days', from: _daysAgo(30), to: _today()},
        {lbl: 'This Month', from: _currMonth() + '-01', to: _today()},
        {lbl: 'Last 90 Days', from: _daysAgo(90), to: _today()}
      ];

      var cont = document.getElementById(containerId);
      if (!cont) return;

      cont.innerHTML =
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
        presets.map(function (p) {
          return '<button class="btn btn-outline btn-xs" onclick="_applyDateRange(\'' + fromId + '\',\'' + toId + '\',\'' + p.from + '\',\'' + p.to + '\')">' + p.lbl + '</button>';
        }).join('') +
        '</div>';
    }

    function _applyDateRange(fromId, toId, from, to) {
      var fromEl = document.getElementById(fromId);
      var toEl = document.getElementById(toId);
      if (fromEl) fromEl.value = from;
      if (toEl) toEl.value = to;
    }

    /* ══════════════════════════════════════════════════════════
       SEARCH INDEX — Build a lightweight in-memory search index
       from all loaded module data for faster global search
    ══════════════════════════════════════════════════════════ */
    var _searchIdx = [];

    function _buildSearchIndex() {
      _searchIdx = [];

      // Index navigation routes
      _navRoutes.forEach(function (n) {
        if (n.mgr && !_isManager()) return;
        _searchIdx.push({type: 'nav', title: n.title, meta: n.meta, route: n.route, ico: n.ico, bg: 'var(--Pl)', c: 'var(--P)'});
      });

      // Index employee directory
      (_D.empDir || []).forEach(function (e) {
        _searchIdx.push({type: 'emp', title: e.name, meta: e.dept + ' · ' + e.role + ' · ' + (e.email || ''), empId: e.emp_id, ico: 'fa-user', bg: 'var(--Gl)', c: 'var(--G)'});
      });

      // Index announcements
      (_D.announcements || []).forEach(function (a) {
        _searchIdx.push({type: 'ann', title: a.text.slice(0, 60) + (a.text.length > 60 ? '…' : ''), meta: 'Announcement · ' + (a.posted_by || '') + ' · ' + _fmtDate(a.posted_at), ico: 'fa-bullhorn', bg: 'var(--Ol)', c: 'var(--O)', action: function () {_loadV('ann');}});
      });
    }

    /* ══════════════════════════════════════════════════════════
       DELEGATION TIMELINE VIEW
       Visual timeline of delegation history for an employee
    ══════════════════════════════════════════════════════════ */
    function _renderTimeline(dels, containerId) {
      var el = document.getElementById(containerId);
      if (!el) return;
      if (!dels || !dels.length) {el.innerHTML = '<div class="te">No delegation history</div>'; return;}

      el.innerHTML = '<div style="position:relative;padding-left:28px">' +
        '<div style="position:absolute;left:8px;top:0;bottom:0;width:2px;background:var(--bdr);border-radius:1px"></div>' +
        dels.map(function (d, i) {
          var statusColor = _colorForStatus(d.status === 'Completed' ? 'Completed' : d.is_overdue ? 'Overdue' : d.status);
          return '<div style="position:relative;margin-bottom:20px">' +
            '<div style="position:absolute;left:-24px;top:6px;width:12px;height:12px;border-radius:50%;background:' + statusColor + ';border:2px solid var(--sur)"></div>' +
            '<div style="background:var(--bg);border:1px solid var(--bdr);border-radius:10px;padding:12px 14px">' +
            '<div style="font-size:13px;font-weight:700;margin-bottom:4px">' + _esc(d.task_desc) + '</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:10px;font-size:11px;color:var(--tx2)">' +
            '<span><i class="fas fa-user-check"></i> ' + _esc(d.delegated_to_name || '—') + '</span>' +
            '<span><i class="fas fa-calendar-plus"></i> ' + _fmtDate(d.first_date) + '</span>' +
            '<span><i class="fas fa-flag-checkered"></i> ' + _fmtDate(d.final_date) + '</span>' +
            '</div>' +
            '<div style="margin-top:7px">' + _statusBadge(d.status === 'Completed' ? 'Completed' : d.is_overdue ? 'Overdue' : d.status) + '</div>' +
            '</div>' +
            '</div>';
        }).join('') +
        '</div>';
    }

    /* ══════════════════════════════════════════════════════════
       ATTENDANCE CALENDAR VIEW
       Monthly grid showing attendance status per day for an employee
    ══════════════════════════════════════════════════════════ */
    function _renderAttCalendar(records, year, month, containerId) {
      var el = document.getElementById(containerId);
      if (!el) return;

      var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      var firstDay = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month + 1, 0).getDate();

      // Build record map: dateStr → status
      var recMap = {};
      (records || []).forEach(function (r) {recMap[String(r.date)] = r.status;});

      var statusColors = {
        FD: 'var(--G)', P: 'var(--G)', HD: 'var(--O)', A: 'var(--R)', H: '#4338ca', WO: 'var(--tx3)', WE: 'var(--tx3)'
      };

      var html =
        '<div class="cal-hdr">' + DAYS.map(function (d) {return '<div class="cal-hdr-day">' + d + '</div>';}).join('') + '</div>' +
        '<div class="cal-grid">';

      for (var p = 0; p < firstDay; p++) html += '<div class="cal-cell other-month"></div>';

      for (var day = 1; day <= daysInMonth; day++) {
        var mm = String(month + 1).padStart(2, '0');
        var dd = String(day).padStart(2, '0');
        var dateStr = year + '-' + mm + '-' + dd;
        var st = recMap[dateStr] || '';
        var clr = statusColors[st] || '';
        var isToday = dateStr === _today();

        html += '<div class="cal-cell' + (isToday ? ' today' : '') + '" style="' + (clr ? 'border-left:3px solid ' + clr + ';' : '') + '">' +
          '<div class="cal-day-num" style="' + (clr ? 'color:' + clr + ';' : '') + '">' + day + '</div>' +
          (st ? '<div style="font-size:9px;font-weight:800;color:' + (clr || 'var(--tx3)') + '">' + st + '</div>' : '') +
          '</div>';
      }
      html += '</div>';
      el.innerHTML = html;
    }

    /* ══════════════════════════════════════════════════════════
       TASK SUMMARY CARD — Used on dashboard & profile
       Shows tasks done vs total with a radial/ring indicator
    ══════════════════════════════════════════════════════════ */
    function _taskSummaryCard(done, total, label, color) {
      var pct = total > 0 ? Math.round(done / total * 100) : 0;
      var r = 28; var circ = 2 * Math.PI * r;
      var dash = (pct / 100) * circ;
      return '<div style="display:flex;align-items:center;gap:16px;padding:14px;background:var(--bg);border:1px solid var(--bdr);border-radius:12px">' +
        '<div style="position:relative;width:72px;height:72px;flex-shrink:0">' +
        '<svg width="72" height="72" viewBox="0 0 72 72" style="transform:rotate(-90deg)">' +
        '<circle cx="36" cy="36" r="' + r + '" fill="none" stroke="var(--bdr)" stroke-width="6"/>' +
        '<circle cx="36" cy="36" r="' + r + '" fill="none" stroke="' + (color || 'var(--P)') + '" stroke-width="6" stroke-dasharray="' + dash + ' ' + circ + '" stroke-linecap="round"/>' +
        '</svg>' +
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:' + (color || 'var(--P)') + '">' + pct + '%</div>' +
        '</div>' +
        '<div>' +
        '<div style="font-size:22px;font-weight:900;letter-spacing:-1px">' + done + '<span style="font-size:13px;font-weight:500;color:var(--tx2)"> / ' + total + '</span></div>' +
        '<div style="font-size:12px;font-weight:700;color:var(--tx2);margin-top:2px">' + (label || 'Tasks Done') + '</div>' +
        '</div>' +
        '</div>';
    }

    /* ══════════════════════════════════════════════════════════
       DEPARTMENT PERFORMANCE HEATMAP
       Shows a grid of dept × week with color intensity
    ══════════════════════════════════════════════════════════ */
    function _renderHeatmap(data, depts, weeks, containerId) {
      var el = document.getElementById(containerId);
      if (!el) return;

      var html =
        '<div style="overflow-x:auto">' +
        '<table style="border-collapse:collapse;font-size:11px;min-width:500px">' +
        '<thead><tr>' +
        '<th style="padding:6px 10px;text-align:left;font-weight:800;font-size:10px;color:var(--tx2)">Department</th>' +
        weeks.map(function (w) {return '<th style="padding:6px 8px;font-weight:800;font-size:10px;color:var(--tx2);text-align:center">W' + w + '</th>';}).join('') +
        '</tr></thead>' +
        '<tbody>' +
        depts.map(function (dept) {
          return '<tr>' +
            '<td style="padding:6px 10px;font-weight:700;white-space:nowrap">' + dept + '</td>' +
            weeks.map(function (w) {
              var val = (data[dept] && data[dept][w]) || 0;
              var alpha = Math.min(val / 10, 1);
              return '<td style="padding:4px;text-align:center">' +
                '<div style="width:32px;height:24px;border-radius:4px;background:rgba(0,95,115,' + alpha.toFixed(2) + ');display:flex;align-items:center;justify-content:center;font-weight:800;font-size:10px;color:' + (alpha > 0.5 ? '#fff' : 'var(--tx2)') + '">' + (val || '') + '</div>' +
                '</td>';
            }).join('') +
            '</tr>';
        }).join('') +
        '</tbody>' +
        '</table></div>';
      el.innerHTML = html;
    }

    /* ══════════════════════════════════════════════════════════
       LEAVE CALENDAR — Monthly view showing leave requests
       Integrated with the attendance module
    ══════════════════════════════════════════════════════════ */
    function _renderLeaveCalendar(requests, year, month, containerId) {
      var el = document.getElementById(containerId);
      if (!el) return;

      var firstDay = new Date(year, month, 1).getDay();
      var daysInMonth = new Date(year, month + 1, 0).getDate();
      var todayStr = _today();

      // Map date ranges to leave type
      var leaveMap = {};
      (requests || []).forEach(function (r) {
        if (r.status === 'Rejected') return;
        var cur = new Date(r.from_date + 'T00:00:00');
        var end = new Date(r.to_date + 'T00:00:00');
        while (cur <= end) {
          leaveMap[cur.toISOString().slice(0, 10)] = {type: r.leave_type, status: r.status};
          cur.setDate(cur.getDate() + 1);
        }
      });

      var leaveColors = {
        'Sick Leave': '#fee2e2', 'Paid Leave': '#dcfce7',
        'Casual Leave': '#fef3c7', 'Comp Off': '#f3e8ff',
        'WFH': '#e0f2fe', 'LWP': '#fecaca'
      };

      var html =
        '<div class="cal-hdr">' + ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(function (d) {return '<div class="cal-hdr-day">' + d + '</div>';}).join('') + '</div>' +
        '<div class="cal-grid">';

      for (var p = 0; p < firstDay; p++) html += '<div class="cal-cell other-month"></div>';
      for (var day = 1; day <= daysInMonth; day++) {
        var mm = String(month + 1).padStart(2, '0');
        var dd = String(day).padStart(2, '0');
        var ds = year + '-' + mm + '-' + dd;
        var lv = leaveMap[ds];
        var isT = ds === todayStr;
        html += '<div class="cal-cell' + (isT ? ' today' : '') + '" ' + (lv ? 'style="background:' + (leaveColors[lv.type] || '#f0f4f8') + '"' : '') + '>' +
          '<div class="cal-day-num">' + day + '</div>' +
          (lv ? '<div style="font-size:8.5px;font-weight:800;color:#374151;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">' + lv.type.split(' ')[0] + '</div>' : '') +
          '</div>';
      }
      html += '</div>';
      el.innerHTML = html;
    }

    /* ══════════════════════════════════════════════════════════
       DELEGATION KANBAN VIEW
       Renders delegations in kanban-style status columns
    ══════════════════════════════════════════════════════════ */
    function _renderKanban(dels, containerId) {
      var el = document.getElementById(containerId);
      if (!el) return;

      var columns = ['Pending', 'Shifted', 'Completed', 'Cancelled'];
      var grouped = {};
      columns.forEach(function (c) {grouped[c] = [];});
      (dels || []).forEach(function (d) {
        var st = d.is_overdue && d.status !== 'Completed' ? 'Pending' : d.status;
        if (grouped[st]) grouped[st].push(d);
        else grouped['Pending'].push(d);
      });

      var colColors = {
        Pending: {bg: 'var(--Ol)', c: 'var(--O)', border: 'var(--O)'},
        Shifted: {bg: 'var(--Vl)', c: 'var(--V)', border: 'var(--V)'},
        Completed: {bg: 'var(--Gl)', c: 'var(--G)', border: 'var(--G)'},
        Cancelled: {bg: 'var(--bg)', c: 'var(--tx2)', border: 'var(--bdr2)'}
      };

      el.innerHTML =
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;overflow-x:auto">' +
        columns.map(function (col) {
          var clr = colColors[col] || colColors.Pending;
          var items = grouped[col] || [];
          return '<div style="background:var(--sur2);border:1px solid var(--bdr);border-radius:12px;overflow:hidden">' +
            '<div style="padding:10px 14px;background:' + clr.bg + ';border-bottom:1px solid var(--bdr);display:flex;align-items:center;justify-content:space-between">' +
            '<div style="font-size:12px;font-weight:800;color:' + clr.c + '">' + col + '</div>' +
            '<span style="background:' + clr.c + ';color:#fff;font-size:10px;font-weight:800;padding:1px 7px;border-radius:999px">' + items.length + '</span>' +
            '</div>' +
            '<div style="padding:10px;display:flex;flex-direction:column;gap:8px;min-height:120px">' +
            (items.length === 0 ?
              '<div style="text-align:center;color:var(--tx3);font-size:12px;padding:20px 0">No items</div>' :
              items.slice(0, 5).map(function (d) {
                return '<div style="background:var(--sur);border:1px solid var(--bdr);border-radius:8px;padding:9px;font-size:12px">' +
                  '<div style="font-weight:700;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(d.task_desc) + '</div>' +
                  '<div style="font-size:10.5px;color:var(--tx2)">' + _esc(d.delegated_to_name || '—') + ' · ' + _fmtDateShort(d.final_date) + '</div>' +
                  '</div>';
              }).join('') +
              (items.length > 5 ? '<div style="text-align:center;font-size:11px;color:var(--tx3);font-weight:700">+' + (items.length - 5) + ' more</div>' : '')
            ) +
            '</div>' +
            '</div>';
        }).join('') +
        '</div>';
    }

    /* ══════════════════════════════════════════════════════════
       EMPLOYEE COMPARISON — Side-by-side stats for two employees
       Manager-only feature for performance review
    ══════════════════════════════════════════════════════════ */
    function _compareEmployees(emp1Id, emp1Name, emp2Id, emp2Name, containerId) {
      var el = document.getElementById(containerId);
      if (!el) return;
      el.innerHTML = _skel(2);

      var results = [null, null];
      var done = 0;

      function check() {
        done++;
        if (done < 2) return;
        if (!results[0] || !results[1]) {el.innerHTML = '<div class="te">Could not load comparison data</div>'; return;}
        var s1 = results[0]; var s2 = results[1];
        var metrics = [
          {lbl: 'Tasks Done This Month', v1: s1.tasks_done_this_month, v2: s2.tasks_done_this_month},
          {lbl: 'Tasks Logged', v1: s1.tasks_logged_this_month, v2: s2.tasks_logged_this_month},
          {lbl: 'Pending Delegations', v1: s1.pending_delegations, v2: s2.pending_delegations},
          {lbl: 'Present Days (Month)', v1: s1.attendance_days_this_month, v2: s2.attendance_days_this_month}
        ];
        el.innerHTML =
          '<div class="table-card"><div class="tw"><table><thead><tr>' +
          '<th>Metric</th>' +
          '<th style="text-align:center;color:var(--P)">' + _esc(emp1Name) + '</th>' +
          '<th style="text-align:center;color:var(--V)">' + _esc(emp2Name) + '</th>' +
          '<th style="text-align:center">Winner</th>' +
          '</tr></thead><tbody>' +
          metrics.map(function (m) {
            var w = m.v1 > m.v2 ? emp1Name : m.v2 > m.v1 ? emp2Name : 'Tied';
            var wClr = m.v1 > m.v2 ? 'var(--P)' : m.v2 > m.v1 ? 'var(--V)' : 'var(--tx2)';
            return '<tr>' +
              '<td style="font-weight:700">' + m.lbl + '</td>' +
              '<td style="text-align:center;font-size:18px;font-weight:900;color:var(--P)">' + (m.v1 || 0) + '</td>' +
              '<td style="text-align:center;font-size:18px;font-weight:900;color:var(--V)">' + (m.v2 || 0) + '</td>' +
              '<td style="text-align:center;font-weight:800;color:' + wClr + '">' + _esc(w) + '</td>' +
              '</tr>';
          }).join('') +
          '</tbody></table></div></div>';
      }

      _gas('getEmployeeStats', [emp1Id], function (s) {results[0] = s; check();}, function () {results[0] = {}; check();});
      _gas('getEmployeeStats', [emp2Id], function (s) {results[1] = s; check();}, function () {results[1] = {}; check();});
    }

    /* ══════════════════════════════════════════════════════════
       ADVANCED FILTER BUILDER
       Reusable filter panel for complex data filtering
    ══════════════════════════════════════════════════════════ */
    function _mkFilterPanel(filters, onChange) {
      return '<div style="display:flex;flex-wrap:wrap;gap:10px;padding:12px 14px;background:var(--sur);border:1px solid var(--bdr);border-radius:10px;margin-bottom:14px">' +
        filters.map(function (f) {
          if (f.type === 'select') {
            return '<div style="display:flex;flex-direction:column;gap:4px">' +
              '<label style="font-size:10px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px">' + f.label + '</label>' +
              '<select id="filter_' + f.key + '" onchange="(' + onChange.toString() + ')({key:\'' + f.key + '\',val:this.value})" style="padding:6px 28px 6px 10px;border:1.5px solid var(--bdr);border-radius:7px;font-size:12px;background:var(--bg);color:var(--tx);appearance:none;background-image:url(\'data:image/svg+xml,...\');outline:none">' +
              f.options.map(function (o) {
                var v = typeof o === 'object' ? o.value : o;
                var l = typeof o === 'object' ? o.label : o;
                return '<option value="' + _esc(v) + '">' + _esc(l) + '</option>';
              }).join('') +
              '</select>' +
              '</div>';
          }
          if (f.type === 'date') {
            return '<div style="display:flex;flex-direction:column;gap:4px">' +
              '<label style="font-size:10px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px">' + f.label + '</label>' +
              '<input type="date" id="filter_' + f.key + '" value="' + (f.default || '') + '" onchange="(' + onChange.toString() + ')({key:\'' + f.key + '\',val:this.value})" style="padding:6px 10px;border:1.5px solid var(--bdr);border-radius:7px;font-size:12px;background:var(--bg);color:var(--tx);outline:none">' +
              '</div>';
          }
          if (f.type === 'search') {
            return '<div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:160px">' +
              '<label style="font-size:10px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px">' + f.label + '</label>' +
              '<div class="search-inp"><i class="fas fa-search"></i><input type="text" id="filter_' + f.key + '" placeholder="' + _esc(f.placeholder || '') + '" oninput="(' + onChange.toString() + ')({key:\'' + f.key + '\',val:this.value})" style="padding:6px 6px 6px 28px;border:1.5px solid var(--bdr);border-radius:7px;font-size:12px;background:var(--bg);color:var(--tx);outline:none;width:100%"></div>' +
              '</div>';
          }
          return '';
        }).join('') +
        '<div style="display:flex;align-items:flex-end">' +
        '<button class="btn btn-outline btn-xs" onclick="(' + onChange.toString() + ')({key:\'reset\',val:null})"><i class="fas fa-rotate-left"></i> Reset</button>' +
        '</div>' +
        '</div>';
    }

    /* ══════════════════════════════════════════════════════════
       INFINITE SCROLL — Load more items on scroll
       Attaches to a container and calls loader when near bottom
    ══════════════════════════════════════════════════════════ */
    function _infiniteScroll(containerId, loader, threshold) {
      var el = document.getElementById(containerId);
      if (!el) return;
      threshold = threshold || 120;

      function onScroll() {
        if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
          el.removeEventListener('scroll', onScroll);
          loader();
        }
      }
      el.addEventListener('scroll', onScroll);
      return function () {el.removeEventListener('scroll', onScroll);};
    }

    /* ══════════════════════════════════════════════════════════
       AVATAR GENERATOR — Creates a deterministic colored avatar
       based on the employee's name (no photo needed)
    ══════════════════════════════════════════════════════════ */
    function _avatarGradient(name) {
      var palette = [
        ['#111111', '#2A2A2A'], ['#2F9E44', '#40C057'], ['#B76E79', '#E8B4B8'],
        ['#D97706', '#F59E0B'], ['#E03131', '#F03E3E'], ['#0D9488', '#14B8A6'],
        ['#0EA5E9', '#38BDF8'], ['#DC2626', '#EF4444'], ['#7C3AED', '#8B5CF6']
      ];
      var idx = name ? name.charCodeAt(0) % palette.length : 0;
      return 'linear-gradient(135deg,' + palette[idx][0] + ',' + palette[idx][1] + ')';
    }

    function _avatarEl(name, photo, size) {
      size = size || 40;
      var init = _initials(name);
      var grad = _avatarGradient(name);
      if (photo) {
        return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;overflow:hidden;flex-shrink:0">' +
          '<img src="' + _esc(photo) + '" alt="' + _esc(name) + '" ' +
          'style="width:' + size + 'px;height:' + size + 'px;object-fit:cover" ' +
          'onerror="this.outerHTML=\'<div style=&quot;width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + grad + ';display:flex;align-items:center;justify-content:center;font-weight:900;font-size:' + Math.round(size * 0.35) + 'px;color:#fff&quot;>' + init + '</div>\'">' +
          '</div>';
      }
      return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + grad + ';display:flex;align-items:center;justify-content:center;font-weight:900;font-size:' + Math.round(size * 0.35) + 'px;color:#fff;flex-shrink:0">' + init + '</div>';
    }

    /* ══════════════════════════════════════════════════════════
       NUMBER FORMATTER — Humanize large numbers (1.2K, 3.4M)
    ══════════════════════════════════════════════════════════ */
    function _fmtNum(n) {
      if (n == null) return '—';
      n = Number(n);
      if (isNaN(n)) return '—';
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    }

    /* Ordinal suffix: 1st, 2nd, 3rd, 4th ... */
    function _ordinal(n) {
      var s = ['th', 'st', 'nd', 'rd'];
      var v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    /* ══════════════════════════════════════════════════════════
       STRING HIGHLIGHT — Highlight query match within a string
    ══════════════════════════════════════════════════════════ */
    function _highlight(str, query) {
      if (!query || !str) return _esc(str || '');
      var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return _esc(str).replace(new RegExp('(' + escaped + ')', 'gi'), '<mark style="background:var(--Ol);color:var(--O);border-radius:2px;padding:0 1px">$1</mark>');
    }

    /* ══════════════════════════════════════════════════════════
       LOADING SPINNER HELPER — Full-pane centered spinner
    ══════════════════════════════════════════════════════════ */
    function _spinner(msg) {
      return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:var(--tx3)">' +
        '<div style="width:40px;height:40px;border:3px solid var(--bdr);border-top-color:var(--P);border-radius:50%;animation:spin .8s linear infinite;margin-bottom:14px"></div>' +
        '<div style="font-size:13px;font-weight:600">' + (msg || 'Loading...') + '</div>' +
        '</div>';
    }

    /* ══════════════════════════════════════════════════════════
       POLLING — Periodically refresh live data
       Used for dashboard stats and notification badges
    ══════════════════════════════════════════════════════════ */
    var _polls = {};

    function _startPoll(key, fn, intervalMs) {
      _stopPoll(key);
      _polls[key] = setInterval(fn, intervalMs || 30000);
    }

    function _stopPoll(key) {
      if (_polls[key]) {clearInterval(_polls[key]); delete _polls[key];}
    }

    function _stopAllPolls() {
      Object.keys(_polls).forEach(function (k) {clearInterval(_polls[k]);});
      _polls = {};
    }

    /* Auto-refresh announcement badge every 5 minutes */
    function _startBadgePoll() {
      _startPoll('annBadge', _loadAnnBadge, 5 * 60 * 1000);
    }

    /* ══════════════════════════════════════════════════════════
       PAGE VISIBILITY — Pause polling when tab hidden
    ══════════════════════════════════════════════════════════ */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        _stopAllPolls();
      } else {
        if (_U) {
          _startBadgePoll();
        }
      }
    });

    /* ══════════════════════════════════════════════════════════
       WINDOW RESIZE HANDLER — Re-render charts on resize
    ══════════════════════════════════════════════════════════ */
    window.addEventListener('resize', _debounce(function () {
      if (_V && Object.keys(_charts).length > 0) {
        Object.keys(_charts).forEach(function (k) {
          try {_charts[k].resize();} catch (e) { }
        });
      }
    }, 300));

    /* ══════════════════════════════════════════════════════════
       UNHANDLED ERROR BOUNDARY — Catch unexpected errors
       and show a friendly recovery message
    ══════════════════════════════════════════════════════════ */
    window.addEventListener('error', function (e) {
      console.error('[Portal Error]', e.message, e.filename, e.lineno);
      // Don't show toast for minor script errors, only critical ones
      if (e.message && e.message.indexOf('ResizeObserver') === -1) {
        _toast('An unexpected error occurred. Try refreshing the page.', 'err');
      }
    });

    window.addEventListener('unhandledrejection', function (e) {
      console.error('[Portal Promise Error]', e.reason);
    });

    /* ══════════════════════════════════════════════════════════
       FIRST PAINT OPTIMIZATIONS
       Mark login input as autofocus after DOM ready
    ══════════════════════════════════════════════════════════ */
    document.addEventListener('DOMContentLoaded', function () {
      // Autofocus email field on login screen
      var emailInp = document.getElementById('femail');
      if (emailInp) setTimeout(function () {emailInp.focus();}, 200);

      // Register service worker if available (for better caching)
      // Note: not used in GAS environment, but left for standalone mode
      // if ('serviceWorker' in navigator) { ... }
    });

    /* ══════════════════════════════════════════════════════════
       ACCESSIBILITY IMPROVEMENTS
       Keyboard navigation, ARIA labels, focus trapping in modals
    ══════════════════════════════════════════════════════════ */

    /* Focus trap for modals: keep Tab within the modal box */
    document.getElementById('modal').addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var focusable = this.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {e.preventDefault(); last.focus();}
      } else {
        if (document.activeElement === last) {e.preventDefault(); first.focus();}
      }
    });

    /* Set ARIA-live region on toast for screen readers */
    (function () {
      var t = document.getElementById('toast');
      if (t) {t.setAttribute('role', 'alert'); t.setAttribute('aria-live', 'polite');}
    }());

    /* ══════════════════════════════════════════════════════════
       PERFORMANCE MONITORING — Track GAS call durations
    ══════════════════════════════════════════════════════════ */
    var _perfLog = [];

    function _gasT(fn, args, onOk, onErr) {
      var t0 = Date.now();
      _gas(fn, args, function (r) {
        var dur = Date.now() - t0;
        _perfLog.push({fn: fn, ms: dur, ts: new Date().toISOString()});
        if (_perfLog.length > 50) _perfLog.shift(); // Keep last 50 entries
        if (dur > 5000) console.warn('[Portal Slow] ' + fn + ' took ' + dur + 'ms');
        if (onOk) onOk(r);
      }, onErr);
    }

    /* Log all GAS calls to console (debug mode) */
    var _debug = false;
    function _enableDebug() {
      _debug = true;
      console.log('[Portal Debug] Debug mode enabled. Performance log at window._perfLog');
      window._perfLog = _perfLog;
      window._D = _D;
      window._U = _U;
      window._charts = _charts;
    }

    /* ══════════════════════════════════════════════════════════
       EXPORT FORMATS — Extended export options beyond CSV
    ══════════════════════════════════════════════════════════ */

    /* Export data as JSON */
    function _downloadJSON(filename, data) {
      var json = JSON.stringify(data, null, 2);
      var blob = new Blob([json], {type: 'application/json'});
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      _toast('JSON exported: ' + filename, 'ok');
    }

    /* Export HTML table as formatted text */
    function _tableToText(tableEl) {
      if (!tableEl) return '';
      var rows = [];
      tableEl.querySelectorAll('tr').forEach(function (tr) {
        var cells = [];
        tr.querySelectorAll('th,td').forEach(function (td) {cells.push(td.textContent.trim().replace(/\s+/g, ' '));});
        rows.push(cells.join('\t'));
      });
      return rows.join('\n');
    }

    /* ══════════════════════════════════════════════════════════
       ANNOUNCEMENT SEARCH — Client-side filter for announcements
    ══════════════════════════════════════════════════════════ */
    function _filterAnns(q) {
      q = (q || '').toLowerCase();
      document.querySelectorAll('.ann-card').forEach(function (c) {
        c.style.display = !q || c.textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none';
      });
    }

    /* ══════════════════════════════════════════════════════════
       DELEGATION QUICK COMPLETE — Complete directly from dashboard
       without navigating to delegation module
    ══════════════════════════════════════════════════════════ */
    function _quickComplete(taskId, onDone) {
      _openModal(
        '<i class="fas fa-check-circle" style="color:var(--G)"></i> Quick Complete',
        '<p style="font-size:14px;color:var(--tx2);line-height:1.6">Mark this delegation task as completed?</p>',
        function () {
          _closeModal();
          _gas('updateDelegationStatus', [taskId, 'Completed'], function () {
            _toast('Task completed!', 'ok');
            _addNtf('Delegation completed', 'fa-check-circle', 'var(--Gl)', 'var(--G)');
            if (onDone) onDone();
          }, function (e) {_toast('Error: ' + e.message, 'err');});
        },
        '<i class="fas fa-check"></i> Complete'
      );
    }

    /* ══════════════════════════════════════════════════════════
       DATE MATH UTILITIES — Business day calculations
    ══════════════════════════════════════════════════════════ */

    /* Count working days between two dates (Mon–Fri) */
    function _workingDays(from, to) {
      var start = new Date(from + 'T00:00:00');
      var end = new Date(to + 'T00:00:00');
      var count = 0;
      var cur = new Date(start);
      while (cur <= end) {
        var dow = cur.getDay();
        if (dow !== 0 && dow !== 6) count++;
        cur.setDate(cur.getDate() + 1);
      }
      return count;
    }

    /* Get ISO date of Monday of the week containing a given date */
    function _weekStart(dateStr) {
      var d = new Date(dateStr + 'T00:00:00');
      var day = d.getDay();
      var diff = (day === 0 ? -6 : 1 - day);
      d.setDate(d.getDate() + diff);
      return d.toISOString().slice(0, 10);
    }

    /* Get ISO date of Friday (or Saturday) of the same week */
    function _weekEnd(dateStr) {
      var d = new Date(_weekStart(dateStr) + 'T00:00:00');
      d.setDate(d.getDate() + 4); // Monday + 4 = Friday
      return d.toISOString().slice(0, 10);
    }

    /* Is a given date in the current week? */
    function _isThisWeek(dateStr) {
      return dateStr >= _weekStart(_today()) && dateStr <= _weekEnd(_today());
    }

    /* Is a given date in the current month? */
    function _isThisMonth(dateStr) {
      return dateStr && dateStr.slice(0, 7) === _currMonth();
    }

    /* ══════════════════════════════════════════════════════════
       PROFILE STATS EXTENSION — Extended stats with history
    ══════════════════════════════════════════════════════════ */
    function _loadProfileHistory(empCode) {
      _gas('getTaskHistory', [empCode, _daysAgo(90), _today()], function (logs) {
        var doneByWeek = {};
        logs.forEach(function (l) {
          if (l.status !== 'Done') return;
          var ws = _weekStart(l.date);
          doneByWeek[ws] = (doneByWeek[ws] || 0) + 1;
        });
        var weeks = Object.keys(doneByWeek).sort().slice(-12);
        var vals = weeks.map(function (w) {return doneByWeek[w] || 0;});

        var el = document.getElementById('profileHistChart');
        if (!el) return;
        if (_charts['profHist']) _charts['profHist'].destroy();
        _charts['profHist'] = new Chart(el.getContext('2d'), {
          type: 'bar',
          data: {
            labels: weeks.map(function (w) {return _fmtDateShort(w);}),
            datasets: [{label: 'Tasks Done', data: vals, backgroundColor: 'rgba(0,95,115,.75)', borderRadius: 5, borderSkipped: false}]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {legend: {display: false}},
            scales: {y: {beginAtZero: true, ticks: {color: '#94a3b8', font: {size: 11}}, grid: {color: 'rgba(0,0,0,.05)'}}, x: {ticks: {color: '#94a3b8', font: {size: 11}}, grid: {display: false}}}
          }
        });
      }, function () { });
    }

    /* ══════════════════════════════════════════════════════════
       ONBOARDING TIPS — Show tips for first-time users
       Stored in localStorage so they only show once
    ══════════════════════════════════════════════════════════ */
    var _tips = [
      {id: 't1', title: 'Welcome to Joolry Daily!', body: 'Use the sidebar to navigate between modules. Your current section is highlighted.', ico: 'fa-hand-wave'},
      {id: 't2', title: 'Quick Search', body: 'Press ⌘K (Mac) or Ctrl+K (Windows) to open the global search and jump to any page or employee instantly.', ico: 'fa-magnifying-glass'},
      {id: 't3', title: 'Keyboard Shortcuts', body: 'Press ? anywhere in the app to see all available keyboard shortcuts.', ico: 'fa-keyboard'},
      {id: 't4', title: 'Dark Mode', body: 'Toggle dark mode using the moon icon in the top right corner. Your preference is saved automatically.', ico: 'fa-moon'}
    ];

    function _showNextTip() {
      var seen = _store.get('tips_seen', []);
      var tip = _tips.find(function (t) {return seen.indexOf(t.id) === -1;});
      if (!tip) return;
      seen.push(tip.id);
      _store.set('tips_seen', seen);

      var notif = document.createElement('div');
      notif.style.cssText = 'position:fixed;bottom:28px;right:28px;background:var(--sur);border:1px solid var(--bdr);border-radius:14px;padding:16px 20px;max-width:300px;z-index:8000;box-shadow:var(--shad3);animation:slideup .3s ease forwards;display:flex;gap:12px';
      notif.innerHTML =
        '<div style="width:36px;height:36px;border-radius:9px;background:var(--Pl);color:var(--P);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0"><i class="fas ' + tip.ico + '"></i></div>' +
        '<div style="flex:1">' +
        '<div style="font-size:13px;font-weight:800;margin-bottom:4px">' + tip.title + '</div>' +
        '<div style="font-size:12px;color:var(--tx2);line-height:1.5">' + tip.body + '</div>' +
        '</div>' +
        '<button onclick="this.parentElement.remove()" style="background:none;border:none;font-size:16px;color:var(--tx3);cursor:pointer;align-self:flex-start;padding:0;line-height:1">×</button>';
      document.body.appendChild(notif);
      setTimeout(function () {if (notif.parentNode) notif.remove();}, 8000);
    }

    /* ══════════════════════════════════════════════════════════
       INITIALIZATION
    ══════════════════════════════════════════════════════════ */
    (function init() {
      // Apply saved dark mode on page load
      if (localStorage.getItem('fk_dark') === '1') {
        _dark = true;
        document.body.classList.add('dark');
        var ico = document.getElementById('darkIco');
        if (ico) ico.className = 'fas fa-sun';
      }

      // Apply saved dense layout preference
      if (_store.get('dense', false)) {
        document.body.classList.add('dense');
      }

      // Show first onboarding tip 2 seconds after login (triggered from _bootApp)
      // _showNextTip is called from _bootApp after login

      console.log('[Joolry Daily v3.0] Initialized. Ready for login.');
      console.log('[Joolry Daily v3.0] Press ? for keyboard shortcuts, ⌘K for search.');
    }());

    /* ══════════════════════════════════════════════════════════════════════
       MUSTER REPORT MODULE
       Manager-only: Monthly attendance muster across all departments.
       Shows FD / HD / Absent / Week-Off / Holiday per employee for the
       selected department and month, with department-wise totals.
    ══════════════════════════════════════════════════════════════════════ */
    function _vMuster() {
      // Muster ab Attendance Analytics mein hai (View: Muster Grid)
      _loadV('attana');
      // Pre-select Muster Grid view after page loads
      setTimeout(function () {
        var vSel = document.getElementById('attView');
        if (vSel) {vSel.value = 'muster'; _loadAtt();}
      }, 300);
    }

    function _loadMuster() {
      var month = document.getElementById('mstrMonth') ? document.getElementById('mstrMonth').value : _currMonth();
      var dept = document.getElementById('mstrDept') ? document.getElementById('mstrDept').value : 'All';
      var cEl = document.getElementById('mstrContent');
      var kEl = document.getElementById('mstrKrow');
      if (cEl) cEl.innerHTML = _skel(8);
      if (kEl) kEl.innerHTML = [1, 2, 3, 4, 5].map(function () {return '<div class="sk sk-h6" style="border-radius:14px"></div>';}).join('');

      _gas('getMusterReport', [dept, month], function (rows) {
        _D.musterData = rows || [];

        // Compute summary KPIs
        var totFD = 0, totHD = 0, totAbs = 0, totWO = 0, totHol = 0;
        rows.forEach(function (r) {
          totFD += r.full_days || 0;
          totHD += r.half_days || 0;
          totAbs += r.absent || 0;
          totWO += r.week_off || 0;
          totHol += r.holiday || 0;
        });
        var working = totFD + totHD + totAbs;
        var avgPct = working > 0 ? Math.round((totFD + totHD * 0.5) / working * 100) : 0;

        if (kEl) kEl.innerHTML = [
          {lbl: 'Employees', val: rows.length, c: 'var(--P)', ico: 'fa-users'},
          {lbl: 'Full Days', val: totFD, c: 'var(--G)', ico: 'fa-calendar-check'},
          {lbl: 'Half Days', val: totHD, c: 'var(--O)', ico: 'fa-clock'},
          {lbl: 'Absent', val: totAbs, c: 'var(--R)', ico: 'fa-calendar-times'},
          {lbl: 'Avg Presence', val: avgPct + '%', c: avgPct >= 80 ? 'var(--G)' : avgPct >= 60 ? 'var(--O)' : 'var(--R)', ico: 'fa-chart-pie'}
        ].map(function (k) {
          return '<div class="kpi" style="--kc:' + k.c + '">' +
            '<div class="kpi-ico"><i class="fas ' + k.ico + '"></i></div>' +
            '<div class="kpi-val">' + k.val + '</div>' +
            '<div class="kpi-lbl">' + k.lbl + '</div>' +
            '</div>';
        }).join('');

        if (!rows.length) {
          if (cEl) cEl.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-xmark"></i><h4>No Attendance Data</h4><p>No records found for ' + month + (dept !== 'All' ? ' — ' + dept : '') + '</p></div>';
          return;
        }

        if (!cEl) return;
        cEl.innerHTML =
          '<div class="export-bar">' +
          '<i class="fas fa-id-card-clip"></i>' +
          '<span>' + rows.length + ' employees · ' + month + (dept !== 'All' ? ' · ' + dept : '') + '</span>' +
          '<div class="fbar-spacer"></div>' +
          '<input type="text" placeholder="Search name..." oninput="_filterMuster(this.value)" ' +
          'style="padding:6px 10px;border:1.5px solid var(--bdr);border-radius:7px;font-size:12px;background:var(--bg);color:var(--tx);outline:none;width:160px">' +
          '</div>' +
          '<div class="table-card">' +
          '<div class="tw">' +
          '<table id="mstrTable">' +
          '<thead><tr>' +
          '<th>Employee</th>' +
          '<th>Department</th>' +
          '<th style="text-align:center">Full Days</th>' +
          '<th style="text-align:center">Half Days</th>' +
          '<th style="text-align:center">Absent</th>' +
          '<th style="text-align:center">Week Off</th>' +
          '<th style="text-align:center">Holiday</th>' +
          '<th style="text-align:center">Presence %</th>' +
          '</tr></thead>' +
          '<tbody id="mstrBody">' +
          rows.map(function (r) {
            var pct = r.present_pct || 0;
            var pClr = pct >= 80 ? 'var(--G)' : pct >= 60 ? 'var(--O)' : 'var(--R)';
            return '<tr class="mstr-row">' +
              '<td><div style="font-weight:700">' + _esc(r.emp_name) + '</div>' +
              '<div style="font-size:10px;color:var(--tx3)">' + _esc(r.emp_id) + '</div></td>' +
              '<td>' + _esc(r.dept || '—') + '</td>' +
              '<td style="text-align:center;font-weight:800;color:var(--G)">' + (r.full_days || 0) + '</td>' +
              '<td style="text-align:center;font-weight:800;color:var(--O)">' + (r.half_days || 0) + '</td>' +
              '<td style="text-align:center;font-weight:800;color:var(--R)">' + (r.absent || 0) + '</td>' +
              '<td style="text-align:center;color:var(--tx3)">' + (r.week_off || 0) + '</td>' +
              '<td style="text-align:center;color:#4338ca">' + (r.holiday || 0) + '</td>' +
              '<td style="text-align:center">' +
              '<div style="display:flex;align-items:center;gap:8px;justify-content:center">' +
              '<div style="width:48px;background:var(--bdr);border-radius:999px;height:5px;overflow:hidden">' +
              '<div style="height:100%;width:' + pct + '%;background:' + pClr + ';border-radius:999px"></div>' +
              '</div>' +
              '<span style="font-weight:900;color:' + pClr + ';font-size:12px">' + pct + '%</span>' +
              '</div>' +
              '</td>' +
              '</tr>';
          }).join('') +
          '</tbody>' +
          '</table>' +
          '</div>' +
          '</div>';
      }, function (e) {
        if (cEl) cEl.innerHTML = '<div class="te"><i class="fas fa-exclamation-triangle"></i> Error: ' + _esc(e.message) + '</div>';
      });
    }

    function _filterMuster(q) {
      q = (q || '').toLowerCase();
      document.querySelectorAll('.mstr-row').forEach(function (tr) {
        tr.style.display = !q || tr.textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none';
      });
    }

    function _exportMuster() {
      var data = _D.musterData || [];
      if (!data.length) {_toast('No muster data to export', 'err'); return;}
      var rows = [['Emp ID', 'Name', 'Department', 'Full Days', 'Half Days', 'Absent', 'Week Off', 'Holiday', 'Presence %']];
      data.forEach(function (r) {
        rows.push([r.emp_id, r.emp_name, r.dept, r.full_days, r.half_days, r.absent, r.week_off, r.holiday, r.present_pct]);
      });
      _downloadCSV('muster_report_' + (document.getElementById('mstrMonth') ? document.getElementById('mstrMonth').value : _currMonth()) + '.csv', rows);
      _toast('Muster report exported!', 'ok');
    }

    /* ══════════════════════════════════════════════════════════════════════
       LEAVE MANAGEMENT MODULE (EXTENDED)
       Covers: My Leave Requests · Leave Balance · Leave Calendar ·
               Manager Approvals · Leave Analytics
    ══════════════════════════════════════════════════════════════════════ */
    var TABS_LEAVE = [
      {id: 'lreq', lbl: '<i class="fas fa-paper-plane"></i> My Requests'},
      {id: 'lbal', lbl: '<i class="fas fa-piggy-bank"></i> Leave Balance'},
      {id: 'lcal', lbl: '<i class="fas fa-calendar-days"></i> Calendar'},
      {id: 'lapprv', lbl: '<i class="fas fa-stamp"></i> Approvals', mgr: true}
    ];

    function _vLeave() {
      var at = _ST || 'lreq';
      var tabs = _isManager() ? TABS_LEAVE : TABS_LEAVE.filter(function (t) {return !t.mgr;});

      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div>' +
        '<div class="mod-title">Leave Management</div>' +
        '<div class="mod-sub">Request, track and manage leave across your team</div>' +
        '</div>' +
        '<button class="btn btn-sm" onclick="_openLeaveReq()"><i class="fas fa-plus"></i> New Leave Request</button>' +
        '</div>' +
        _mkTabs(tabs, at) +
        _mkPanes(tabs, at, [
          '<div id="lreqPane">' + _lreqForm() + '</div>',
          '<div id="lbalPane">' + _lbalForm() + '</div>',
          '<div id="lcalPane">' + _lcalForm() + '</div>',
          (_isManager() ? '<div id="laprvPane">' + _laprvForm() + '</div>' : '')
        ]);

      if (at === 'lreq') _loadMyLeaves();
      else if (at === 'lbal') _loadLeaveBalance();
      else if (at === 'lcal') _loadLeaveCalView();
      else if (at === 'lapprv' && _isManager()) _loadLeaveApprovals();
      if (_ST) setTimeout(function () {_switchTab(_ST);}, 30);
    }

    // ── Leave Summary tab (replaces old Attendance > Leave Summary) ──────────
    function _lsummForm() {
      return '<div class="fbar">' +
        '<label>Month:</label><input type="month" id="lsummMonth" value="' + _currMonth() + '">' +
        '<button class="btn btn-sm" onclick="_loadLeaveSummTab()"><i class="fas fa-search"></i> Load</button>' +
        '</div><div id="lsummContent">' + _skel(2) + '</div>';
    }
    function _loadLeaveSummTab() {
      var month = (document.getElementById('lsummMonth') || {}).value || _currMonth();
      var el = document.getElementById('lsummContent');
      if (!el) return;
      el.innerHTML = _skel(2);
      _gas('getLeaveSummary', [_U.emp_code, month], function (rows) {
        var r = (rows && rows[0]) || {};
        _D.leaveBalance = r;
        var el2 = document.getElementById('lsummContent');
        if (!el2) return;
        el2.innerHTML =
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px">' +
          [
            {lbl: 'Approved Days', val: r.total_approved || 0, c: 'var(--G)', ico: 'fa-check-circle', desc: 'Days approved this month'},
            {lbl: 'Pending', val: r.total_pending || 0, c: 'var(--O)', ico: 'fa-clock', desc: 'Awaiting approval'},
            {lbl: 'Rejected', val: r.total_rejected || 0, c: 'var(--R)', ico: 'fa-times-circle', desc: 'Rejected requests'}
          ].map(function (k) {
            return '<div class="kpi" style="--kc:' + k.c + '">' +
              '<div class="kpi-ico"><i class="fas ' + k.ico + '"></i></div>' +
              '<div class="kpi-val">' + k.val + '</div>' +
              '<div class="kpi-lbl">' + k.lbl + '</div>' +
              '<div style="font-size:10px;color:var(--tx3);margin-top:4px">' + k.desc + '</div></div>';
          }).join('') + '</div>' +
          '<div class="card card-nohover"><div class="sec-title" style="margin-bottom:16px">' +
          '<i class="fas fa-list-check" style="color:var(--P)"></i> Leave Type Breakdown — ' + month + '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">' +
          [
            {lbl: 'WO Entitlement', val: r.week_off_entitlement || 0, c: 'var(--P)', ico: 'fa-calendar-week'},
            {lbl: 'WO Taken', val: r.week_off_taken || 0, c: 'var(--O)', ico: 'fa-umbrella-beach'},
            {lbl: 'WO Extra Worked', val: r.week_off_worked || 0, c: 'var(--G)', ico: 'fa-coins'},
            {lbl: 'PTO Taken', val: r.pto_taken || r.paid_leave || 0, c: 'var(--V)', ico: 'fa-suitcase'},
            {lbl: 'Sick Leave', val: r.sick_leave || 0, c: 'var(--R)', ico: 'fa-heart-pulse'},
            {lbl: 'Unpaid', val: r.unpaid_taken || r.lwp || 0, c: 'var(--tx2)', ico: 'fa-circle-minus'}
          ].map(function (k) {
            return '<div style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg);border:1px solid var(--bdr);border-radius:10px">' +
              '<div style="width:34px;height:34px;border-radius:8px;background:' + k.c + '22;color:' + k.c + ';display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0"><i class="fas ' + k.ico + '"></i></div>' +
              '<div><div style="font-size:18px;font-weight:900;color:' + k.c + '">' + k.val +
              '<span style="font-size:11px;color:var(--tx2);font-weight:500"> day' + (k.val !== 1 ? 's' : '') + '</span></div>' +
              '<div style="font-size:11px;font-weight:700;color:var(--tx2)">' + k.lbl + '</div></div></div>';
          }).join('') + '</div></div>';
      }, function (e) {
        var el3 = document.getElementById('lsummContent');
        if (el3) el3.innerHTML = '<div class="te">Error: ' + _esc(e.message) + '</div>';
      });
    }

    function _lreqForm() {
      return '<div class="fbar">' +
        '<label>Month:</label>' +
        '<input type="month" id="lreqMonth" value="' + _currMonth() + '">' +
        '<button class="btn btn-sm" onclick="_loadMyLeaves()"><i class="fas fa-search"></i> Load</button>' +
        '</div><div id="lreqList">' + _skel(4) + '</div>';
    }

    function _loadMyLeaves() {
      var month = document.getElementById('lreqMonth') ? document.getElementById('lreqMonth').value : _currMonth();
      var el = document.getElementById('lreqList');
      if (!el) return;
      el.innerHTML = _skel(4);

      _gas('getLeaveRequests', [{for: 'own'}], function (reqs) {
        _D.myLeaves = reqs || [];
        var filtered = reqs.filter(function (r) {
          return !month || String(r.from_date || '').substring(0, 7) === month;
        });

        if (!filtered.length) {
          el.innerHTML = '<div class="empty-state"><i class="fas fa-umbrella-beach"></i><h4>No Leave Requests</h4>' +
            '<p>No leave requests for ' + month + '.</p>' +
            '<button class="btn btn-sm" onclick="_openLeaveReq()"><i class="fas fa-plus"></i> Submit Request</button>' +
            '</div>';
          return;
        }

        var groups = [
          {key: 'Pending', clr: 'var(--O)', ico: 'fa-clock'},
          {key: 'Approved', clr: 'var(--G)', ico: 'fa-check-circle'},
          {key: 'Rejected', clr: 'var(--R)', ico: 'fa-times-circle'},
          {key: 'Cancelled', clr: 'var(--tx2)', ico: 'fa-ban'}
        ];
        var html = '';
        groups.forEach(function (g) {
          var grpRecs = filtered.filter(function (r) {return (r.status || 'Pending') === g.key;});
          if (!grpRecs.length) return;
          var gid = 'lreq_g_' + g.key;
          html += '<div style="margin-bottom:12px">' +
            '<div onclick="_toggleGrp(\'' + gid + '\')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--sur2);border-radius:10px;cursor:pointer;border:1px solid var(--bdr);margin-bottom:8px">' +
            '<i class="fas ' + g.ico + '" style="color:' + g.clr + '"></i>' +
            '<span style="font-weight:800;font-size:13px;color:' + g.clr + '">' + g.key + '</span>' +
            '<span style="background:' + g.clr + '22;color:' + g.clr + ';padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800">' + grpRecs.length + '</span>' +
            '<i class="fas fa-chevron-down" style="margin-left:auto;font-size:11px;color:var(--tx3)"></i>' +
            '</div>' +
            '<div id="' + gid + '">' +
            grpRecs.map(function (r) {
              return '<div class="ann-card" style="border-left-color:' + g.clr + ';margin-bottom:8px">' +
                '<div style="display:flex;align-items:flex-start;gap:14px">' +
                '<div style="flex:1;min-width:0">' +
                '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">' +
                '<span style="font-size:13px;font-weight:800">' + _esc(r.leave_type || '—') + '</span>' +
                '<span style="background:var(--Pl);color:var(--P);padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700">' + (r.num_days || 1) + ' day' + (r.num_days !== 1 ? 's' : '') + '</span>' +
                '</div>' +
                '<div style="font-size:13px;color:var(--tx2);margin-bottom:4px"><i class="fas fa-calendar-range"></i> ' + _fmtDate(r.from_date) + ' — ' + _fmtDate(r.to_date) + '</div>' +
                (r.reason ? '<div style="font-size:12px;color:var(--tx3);margin-bottom:3px"><i class="fas fa-comment"></i> ' + _esc(r.reason) + '</div>' : '') +
                (r.remark ? '<div style="font-size:12px;color:var(--I);margin-bottom:3px"><i class="fas fa-reply"></i> <em>' + _esc(r.remark) + '</em></div>' : '') +
                '<div style="font-size:11px;color:var(--tx4);margin-top:4px"><i class="fas fa-clock"></i> ' + _fmtDateTime(r.requested_at) +
                (r.approved_by ? ' &nbsp;·&nbsp; <i class="fas fa-user-check"></i> ' + _esc(r.approved_by) : '') + '</div>' +
                '</div></div></div>';
            }).join('') +
            '</div></div>';
        });
        el.innerHTML = html;
      }, function (e) {el.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';});
    }

    function _toggleGrp(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var open = el.style.display !== 'none';
      el.style.display = open ? 'none' : '';
      var hdr = el.previousElementSibling;
      if (hdr) {
        var chev = hdr.querySelector('.fa-chevron-down,.fa-chevron-up');
        if (chev) {chev.className = chev.className.replace(open ? 'fa-chevron-down' : 'fa-chevron-up', open ? 'fa-chevron-up' : 'fa-chevron-down');}
      }
    }

    function _lbalForm() {
      return '<div class="fbar">' +
        '<span style="font-size:12px;color:var(--tx2)"><i class="fas fa-info-circle"></i> Cumulative leave balance (all approved leaves)</span>' +
        '<div class="fbar-spacer"></div>' +
        '<button class="btn btn-sm btn-outline" onclick="_loadLeaveBalance()"><i class="fas fa-rotate-right"></i> Refresh</button>' +
        '</div><div id="lbalContent">' + _skel(2) + '</div>';
    }

    function _loadLeaveBalance() {
      var month = document.getElementById('lbalMonth') ? document.getElementById('lbalMonth').value : _currMonth();
      var el = document.getElementById('lbalContent');
      if (!el) return;
      el.innerHTML = _skel(2);

      _gas('getLeaveSummary', [_U.emp_code, null], function (data) {  // null = all months (balance is cumulative)
        var s = (data && data[0]) || {};
        el.innerHTML =
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px">' +
          [
            {lbl: 'Approved', val: s.total_approved || 0, c: 'var(--G)', ico: 'fa-check-circle', desc: 'Days approved this month'},
            {lbl: 'Pending', val: s.total_pending || 0, c: 'var(--O)', ico: 'fa-clock', desc: 'Awaiting approval'},
            {lbl: 'Rejected', val: s.total_rejected || 0, c: 'var(--R)', ico: 'fa-times-circle', desc: 'Rejected requests'}
          ].map(function (k) {
            return '<div class="kpi" style="--kc:' + k.c + '">' +
              '<div class="kpi-ico"><i class="fas ' + k.ico + '"></i></div>' +
              '<div class="kpi-val">' + k.val + '</div>' +
              '<div class="kpi-lbl">' + k.lbl + '</div>' +
              '<div style="font-size:10px;color:var(--tx3);margin-top:4px">' + k.desc + '</div>' +
              '</div>';
          }).join('') +
          '</div>' +
          '<div class="card card-nohover">' +
          '<div class="sec-title" style="margin-bottom:16px"><i class="fas fa-list-check" style="color:var(--P)"></i> Leave Type Breakdown — ' + month + '</div>' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">' +
          [
            {lbl: 'Sick Leave', val: s.sick_leave || 0, c: 'var(--R)', ico: 'fa-heart-pulse'},
            {lbl: 'Paid Leave', val: s.paid_leave || 0, c: 'var(--G)', ico: 'fa-umbrella'},
            {lbl: 'Casual Leave', val: s.casual_leave || 0, c: 'var(--O)', ico: 'fa-person-walking'},
            {lbl: 'Comp Off', val: s.comp_off || 0, c: 'var(--V)', ico: 'fa-swap-arrows'},
            {lbl: 'WFH', val: s.wfh || 0, c: 'var(--T)', ico: 'fa-house-laptop'},
            {lbl: 'LWP', val: s.lwp || 0, c: 'var(--tx2)', 'ico': 'fa-circle-minus'}
          ].map(function (k) {
            return '<div style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--bg);border:1px solid var(--bdr);border-radius:10px">' +
              '<div style="width:34px;height:34px;border-radius:8px;background:' + k.c + '22;color:' + k.c + ';display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0"><i class="fas ' + k.ico + '"></i></div>' +
              '<div>' +
              '<div style="font-size:18px;font-weight:900;color:' + k.c + '">' + k.val + '<span style="font-size:11px;color:var(--tx2);font-weight:500"> day' + (k.val !== 1 ? 's' : '') + '</span></div>' +
              '<div style="font-size:11px;font-weight:700;color:var(--tx2)">' + k.lbl + '</div>' +
              '</div>' +
              '</div>';
          }).join('') +
          '</div>' +
          '</div>';
      }, function (e) {el.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';});
    }

    function _lcalForm() {
      var d = new Date();
      return '<div class="fbar">' +
        '<label>Month:</label><input type="month" id="lcalMonth" value="' + _currMonth() + '">' +
        '<button class="btn btn-sm" onclick="_loadLeaveCalView()"><i class="fas fa-calendar"></i> Load</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 300px;gap:16px">' +
        '<div id="lcalCal"></div>' +
        '<div class="card card-nohover card-sm" id="lcalLegend">' +
        '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-circle-info" style="color:var(--P)"></i> Legend</div>' +
        ['Sick Leave:var(--R)', 'Paid Leave:var(--G)', 'Casual Leave:var(--O)', 'Comp Off:var(--V)', 'WFH:var(--T)', 'LWP:#dc2626'].map(function (s) {
          var p = s.split(':');
          return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">' +
            '<div style="width:12px;height:12px;border-radius:3px;background:' + p[1] + '33;border:1.5px solid ' + p[1] + ';flex-shrink:0"></div>' +
            '<span style="font-size:12px;font-weight:600">' + p[0] + '</span>' +
            '</div>';
        }).join('') +
        '</div>' +
        '</div>';
    }

    function _loadLeaveCalView() {
      var month = document.getElementById('lcalMonth') ? document.getElementById('lcalMonth').value : _currMonth();
      var parts = month.split('-');
      var yr = parseInt(parts[0]); var mo = parseInt(parts[1]) - 1;
      var el = document.getElementById('lcalCal');
      if (!el) return;
      el.innerHTML = _skel(3);

      _gas('getLeaveRequests', [{for: 'own'}], function (reqs) {
        var monthReqs = (reqs || []).filter(function (r) {
          return String(r.from_date || '').substring(0, 7) === month;
        });
        el.innerHTML =
          '<div style="font-size:13px;font-weight:800;margin-bottom:10px;color:var(--tx2)">' +
          new Date(yr, mo, 1).toLocaleDateString('en-IN', {month: 'long', year: 'numeric'}) +
          '</div>';
        _renderLeaveCalendar(monthReqs, yr, mo, 'lcalCal');
        if (!monthReqs.length) {
          el.innerHTML += '<div style="margin-top:12px;font-size:12px;color:var(--tx3);font-weight:600;text-align:center">No leave requests this month</div>';
        }
      }, function () {el.innerHTML = '<div class="te">Could not load leave calendar</div>';});
    }

    function _laprvForm() {
      return '<div class="fbar">' +
        '<label>Status:</label>' +
        '<select id="laprvStatus" onchange="_loadLeaveApprovals()">' +
        '<option value="Pending">Pending</option><option value="All">All</option>' +
        '<option value="Approved">Approved</option><option value="Rejected">Rejected</option>' +
        '</select>' +
        '<div class="fbar-spacer"></div>' +

        '</div><div id="laprvList">' + _skel(4) + '</div>';
    }

    function _loadLeaveApprovals() {
      var el = document.getElementById('laprvList');
      if (!el) return;
      el.innerHTML = _skel(4);

      _gas('getLeaveRequests', [{for: 'approvals'}], function (reqs) {
        _D.leaveApprovals = reqs || [];
        var st = document.getElementById('laprvStatus') ? document.getElementById('laprvStatus').value : 'Pending';
        var flt = st === 'All' ? reqs : reqs.filter(function (r) {return r.status === st;});

        if (!flt.length) {
          el.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><h4>No ' + (st !== 'All' ? st + ' ' : '') + 'Requests</h4><p>Nothing to review right now.</p></div>';
          return;
        }

        // Group by employee
        var empMap = {}, empOrder = [];
        flt.forEach(function (r) {
          var nm = r.emp_name || 'Unknown';
          if (!empMap[nm]) {empMap[nm] = []; empOrder.push(nm);}
          empMap[nm].push(r);
        });

        var html = '<div style="margin-bottom:10px;font-size:12px;color:var(--tx2)"><i class="fas fa-stamp"></i> ' +
          flt.length + ' request' + (flt.length !== 1 ? 's' : '') + ' · ' + empOrder.length + ' employee' + (empOrder.length !== 1 ? 's' : '') + '</div>';

        empOrder.forEach(function (nm) {
          var recs = empMap[nm];
          var gid = 'la_' + nm.replace(/[^a-zA-Z0-9]/g, '_');
          var hasPending = recs.some(function (r) {return r.status === 'Pending';});
          html += '<div style="margin-bottom:12px">' +
            '<div onclick="_toggleGrp(\'' + gid + '\')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--sur2);border-radius:10px;cursor:pointer;border:1px solid var(--bdr);margin-bottom:8px">' +
            '<div style="width:32px;height:32px;border-radius:50%;background:var(--Pl);color:var(--P);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;flex-shrink:0">' + _esc(nm.charAt(0).toUpperCase()) + '</div>' +
            '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:13px">' + _esc(nm) + '</div>' +
            '<div style="font-size:11px;color:var(--tx3)">' + _esc((recs[0] || {}).dept || '') + ' &nbsp;·&nbsp; ' + recs.length + ' request' + (recs.length !== 1 ? 's' : '') + '</div></div>' +
            (hasPending ? '<span style="background:var(--Ol);color:var(--O);padding:2px 9px;border-radius:999px;font-size:11px;font-weight:800">Pending</span>' : '') +
            '<i class="fas fa-chevron-down" style="font-size:11px;color:var(--tx3)"></i>' +
            '</div>' +
            '<div id="' + gid + '">' +
            recs.map(function (r) {
              var sc = r.status === 'Approved' ? 'var(--G)' : r.status === 'Rejected' ? 'var(--R)' : 'var(--O)';
              return '<div class="ann-card" style="border-left-color:' + sc + ';margin-bottom:8px">' +
                '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px">' +
                '<div style="flex:1;min-width:0">' +
                '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px">' +
                '<span class="bdg" style="background:var(--Il);color:var(--I)">' + _esc(r.leave_type || '—') + '</span>' +
                _statusBadge(r.status) + '</div>' +
                '<div style="font-size:13px;color:var(--tx2);margin-bottom:4px"><i class="fas fa-calendar"></i> ' +
                _fmtDate(r.from_date) + ' — ' + _fmtDate(r.to_date) +
                ' <strong style="color:var(--P)">(' + (r.num_days || 1) + ' day' + (r.num_days !== 1 ? 's' : '') + ')</strong></div>' +
                (r.reason ? '<div style="font-size:12px;color:var(--tx3);margin-bottom:3px"><i class="fas fa-comment"></i> ' + _esc(r.reason) + '</div>' : '') +
                (r.remark ? '<div style="font-size:12px;color:var(--I)"><i class="fas fa-reply"></i> <em>' + _esc(r.remark) + '</em></div>' : '') +
                '</div>' +
                (r.status === 'Pending' ?
                  '<div style="display:flex;flex-direction:column;gap:7px;flex-shrink:0">' +
                  '<button class="btn btn-sm" style="background:var(--G)" onclick="_approveLeave(\'' + _esc(r.request_id) + '\',\'Approved\')"><i class="fas fa-check"></i> Approve</button>' +
                  '<button class="btn btn-sm btn-red" onclick="_approveLeave(\'' + _esc(r.request_id) + '\',\'Rejected\')"><i class="fas fa-times"></i> Reject</button>' +
                  '</div>' :
                  '<span style="font-size:11px;color:var(--tx3);font-weight:700">' + _esc(r.approved_by || '') + '</span>'
                ) +
                '</div></div>';
            }).join('') +
            '</div></div>';
        });
        el.innerHTML = html;
      }, function (e) {el.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';});
    }

    function _approveLeave(requestId, status) {
      var label = status === 'Approved' ? 'Approve' : 'Reject';
      var ico = status === 'Approved' ? 'fa-check-circle' : 'fa-times-circle';
      var clr = status === 'Approved' ? 'var(--G)' : 'var(--R)';
      _openModal(
        '<i class="fas ' + ico + '" style="color:' + clr + '"></i> ' + label + ' Leave Request',
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:8px">Remark for Employee (optional)</label>' +
        '<textarea id="lvRemarkEl" rows="3" placeholder="Enter remark..." style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;background:var(--bg);color:var(--tx);outline:none;resize:vertical;font-family:inherit"></textarea></div>',
        function () {
          var remark = (document.getElementById('lvRemarkEl') || {}).value || '';
          _closeModal();
          _gas('approveLeaveRequest', [requestId, status, remark], function () {
            _toast('Leave ' + status.toLowerCase() + '!', status === 'Approved' ? 'ok' : 'warn');
            _addNtf('Leave ' + status.toLowerCase(), status === 'Approved' ? 'fa-check-circle' : 'fa-times-circle',
              status === 'Approved' ? 'var(--Gl)' : 'var(--Rl)', status === 'Approved' ? 'var(--G)' : 'var(--R)');
            _loadLeaveApprovals();
          }, function (e) {_toast('Error: ' + e.message, 'err');});
        },
        '<i class="fas ' + ico + '"></i> Confirm ' + label
      );
    }

    function _openLeaveReq() {
      _openModal(
        '<i class="fas fa-umbrella-beach" style="color:var(--T)"></i> Submit Leave Request',
        '<div class="leave-req-form">' +
        '<div class="fgrp"><label>Leave Type <span class="req">★</span></label>' +
        '<select id="mLvType" style="width:100%;min-height:44px;font-size:16px;border-radius:10px">' +
        '<option>Weekly Off</option><option>PTO</option><option>Sick Leave</option><option>Unpaid</option><option>Casual Leave</option>' +
        '<option>Comp Off</option><option>WFH</option><option>LWP</option>' +
        '</select></div>' +
        '<div class="frow" style="margin-top:12px">' +
        '<div class="fgrp"><label>From Date <span class="req">★</span></label>' +
        '<input type="date" id="mLvFrom" value="' + _today() + '" style="width:100%;min-height:44px;font-size:16px;border-radius:10px"></div>' +
        '<div class="fgrp"><label>To Date <span class="req">★</span></label>' +
        '<input type="date" id="mLvTo" value="' + _today() + '" style="width:100%;min-height:44px;font-size:16px;border-radius:10px"></div>' +
        '</div>' +
        '<div class="fgrp" style="margin-top:12px"><label>Reason</label>' +
        '<textarea id="mLvReason" rows="3" placeholder="Brief reason for leave..." style="width:100%;min-height:80px;font-size:16px;resize:vertical;border-radius:10px"></textarea></div>' +
        '<div class="tip" style="margin-top:12px;padding:10px 12px;font-size:12px;line-height:1.45"><i class="fas fa-info-circle"></i> Manager notified after submit. Approved leaves show in calendar.</div>' +
        '</div>',
        function () {
          var type = document.getElementById('mLvType') ? document.getElementById('mLvType').value : '';
          var from = document.getElementById('mLvFrom') ? document.getElementById('mLvFrom').value : '';
          var to = document.getElementById('mLvTo') ? document.getElementById('mLvTo').value : '';
          var reason = document.getElementById('mLvReason') ? document.getElementById('mLvReason').value : '';
          if (!from || !to) {_toast('From and To dates are required', 'err'); return;}
          if (!_validDateRange(from, to)) {_toast('From date must be on or before To date', 'err'); return;}
          _closeModal();
          _gas('requestLeave', [{leave_type: type, from_date: from, to_date: to, reason: reason}], function (r) {
            _toast('Leave request submitted! ID: ' + r.request_id, 'ok');
            _addNtf('Leave request submitted', 'fa-umbrella-beach', 'var(--Tl)', 'var(--T)');
            _loadMyLeaves();
          }, function (e) {_toast('Error: ' + e.message, 'err');});
        },
        '<i class="fas fa-paper-plane"></i> Submit Request'
      );
    }

    function _exportLeaves() {
      var data = _D.myLeaves || [];
      if (!data.length) {_toast('No leave data to export', 'err'); return;}
      var rows = [['Request ID', 'Leave Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Approved By', 'Applied At']];
      data.forEach(function (r) {
        rows.push([r.request_id, r.leave_type, r.from_date, r.to_date, r.num_days, r.reason, r.status, r.approved_by, r.requested_at]);
      });
      _downloadCSV('my_leaves_' + _currMonth() + '.csv', rows);
    }

    function _exportLeaveApprovals() {
      var data = _D.leaveApprovals || [];
      if (!data.length) {_toast('No data to export', 'err'); return;}
      var rows = [['Request ID', 'Employee', 'Department', 'Leave Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Approved By']];
      data.forEach(function (r) {
        rows.push([r.request_id, r.emp_name, r.dept, r.leave_type, r.from_date, r.to_date, r.num_days, r.reason, r.status, r.approved_by]);
      });
      _downloadCSV('leave_approvals_' + _today() + '.csv', rows);
    }

    /* ══════════════════════════════════════════════════════════════════════
       DELEGATION ANALYTICS MODULE (EXTENDED)
       Full analytics with charts: status pie, monthly trend, employee table.
       Manager-only.
    ══════════════════════════════════════════════════════════════════════ */
    // ═══════════════════════════════════════════════════════════════════════════
    // DELEGATION ANALYTICS — Fabulous Manager Dashboard
    // Workload distribution, completion rates, trend, insights & leaderboard
    // ═══════════════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════════
    // CHECKLIST ANALYTICS — Task completion, workload, frequency, on-time
    // performance, pending aging & trend analysis. Manager-only.
    // Backed by getChecklistAnalyticsV2 (new — old getChecklistAnalytics is
    // untouched on the backend and no longer called from this page).
    // ═══════════════════════════════════════════════════════════════════════
    var CLA_FREQ_LABELS = {D: 'Daily', W: 'Weekly', F: 'Fortnightly', M: 'Monthly', '2M': 'Bi-Monthly', Q: 'Quarterly', H: 'Half-Yearly', Y: 'Yearly'};

    function _getEmpOptions() {
      var emps = [];
      var seen = {};
      var src = (_D.empDir && _D.empDir.length) ? _D.empDir
        : (_D.doers && _D.doers.length) ? _D.doers
          : [];
      src.forEach(function (d) {
        var id = String(d.emp_id || d['Emp ID'] || '').trim();
        var name = String(d.name || d['Name'] || '').trim();
        if (id && name && !seen[id]) {seen[id] = true; emps.push({id: id, name: name});}
      });
      emps.sort(function (a, b) {return a.name.localeCompare(b.name);});
      return emps.map(function (e) {return '<option value="' + _esc(e.id) + '">' + _esc(e.name) + '</option>';}).join('');
    }

    function _vClAna() {
      if (!_isManager()) {
        document.getElementById('content').innerHTML =
          '<div class="empty-state"><i class="fas fa-lock"></i><h4>Access Restricted</h4></div>';
        return;
      }
      // Dept/Employee dropdowns are built from _D.empDir. If it isn't cached
      // yet (e.g. this page opened before the login bulk-load finished),
      // fetch it now so the filters are never empty.
      if (!_D.empDir || !_D.empDir.length) {
        document.getElementById('content').innerHTML =
          '<div class="mod-head"><div><div class="mod-title">Checklist Analytics</div></div></div>' + _skel(4);
        _gas('getEmployeeDirectory', [], function (emps) {
          _D.empDir = emps || [];
          _vClAnaBuild();
        }, function () {_vClAnaBuild();}); // proceed even if this fails — dropdowns just show "All"
        return;
      }
      _vClAnaBuild();
    }

    function _vClAnaBuild() {
      var defFrom = _currMonth() + '-01';
      var defTo = _today();
      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div><div class="mod-title">Checklist Analytics</div>' +
        '<div class="mod-sub">Workload, completion rates, on-time performance, pending aging &amp; trends</div></div>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +

        '<select id="claPreset" class="ana-sel" onchange="_claApplyPreset()">' +
        '<option value="month">This Month</option>' +
        '<option value="today">Today</option>' +
        '<option value="yesterday">Yesterday</option>' +
        '<option value="week">This Week</option>' +
        '<option value="lastmonth">Last Month</option>' +
        '<option value="quarter">This Quarter</option>' +
        '<option value="year">This Year</option>' +
        '<option value="custom">Custom Range</option>' +
        '</select>' +
        '<input type="date" id="claFrom" class="ana-sel" value="' + defFrom + '" onchange="_claMarkCustom();_loadCla()">' +
        '<span style="color:var(--tx3);font-size:12px">to</span>' +
        '<input type="date" id="claTo" class="ana-sel" value="' + defTo + '" onchange="_claMarkCustom();_loadCla()">' +

        '<select id="claDept" class="ana-sel" onchange="_loadCla()">' +
        '<option value="all">All Departments</option>' +
        _getDeptOptions() +
        '</select>' +
        '<select id="claFreqFlt" class="ana-sel" onchange="_loadCla()">' +
        '<option value="all">All Frequencies</option>' +
        '<option value="D">Daily</option>' +
        '<option value="W">Weekly</option>' +
        '<option value="F">Fortnightly</option>' +
        '<option value="M">Monthly</option>' +
        '<option value="2M">Bi-Monthly</option>' +
        '<option value="Q">Quarterly</option>' +
        '<option value="H">Half-Yearly</option>' +
        '<option value="Y">Yearly</option>' +
        '</select>' +
        '<select id="claEmp" class="ana-sel" onchange="_loadCla()">' +
        '<option value="all">All Employees</option>' +
        _getEmpOptions() +
        '</select>' +

        '<select id="claView" class="ana-sel" onchange="_renderCla()">' +
        '<option value="overview">Overview</option>' +
        '<option value="employee">By Employee</option>' +
        '<option value="dept">By Department</option>' +
        '<option value="task">By Task</option>' +
        '<option value="trend">Trends &amp; Patterns</option>' +
        '<option value="aging">Pending &amp; Aging</option>' +
        '</select>' +
        '<select id="claFilter" class="ana-sel" onchange="_renderCla()">' +
        '<option value="all">All Performance</option>' +
        '<option value="perfect">Perfect (100%)</option>' +
        '<option value="good">Good (&ge;80%)</option>' +
        '<option value="avg">Average (50-79%)</option>' +
        '<option value="low">Low (&lt;50%)</option>' +
        '</select>' +
        '<select id="claSort" class="ana-sel" onchange="_renderCla()">' +
        '<option value="planned_desc">Tasks &darr;</option>' +
        '<option value="rate_desc">Completion % &darr;</option>' +
        '<option value="rate_asc">Completion % &uarr;</option>' +
        '<option value="done_desc">Done &darr;</option>' +
        '<option value="lag_desc">Avg Delay &darr;</option>' +
        '<option value="name_asc">Name A-Z</option>' +
        '</select>' +

        '<button class="btn btn-sm" onclick="_loadCla()"><i class="fas fa-chart-bar"></i> Analyze</button>' +
        '<button class="btn btn-sm" onclick="_exportClaCsv()"><i class="fas fa-file-export"></i> Export</button>' +
        '</div></div>' +
        '<div id="claRoot" style="margin-top:4px">' + _skel(4) + '</div>';

      _loadCla();
    }

    function _claMarkCustom() {
      var p = document.getElementById('claPreset');
      if (p) p.value = 'custom';
    }

    function _claApplyPreset() {
      var p = (document.getElementById('claPreset') || {}).value || 'month';
      if (p === 'custom') return; // user picked dates manually — leave inputs alone
      var t = new Date();
      function iso(d) {return d.toISOString().slice(0, 10);}
      var from, to = iso(t);
      if (p === 'today') {from = to;}
      else if (p === 'yesterday') {var y = new Date(t); y.setDate(y.getDate() - 1); from = iso(y); to = iso(y);}
      else if (p === 'week') {var w = new Date(t); w.setDate(w.getDate() - w.getDay()); from = iso(w);}
      else if (p === 'lastmonth') {
        var lm = new Date(t.getFullYear(), t.getMonth() - 1, 1);
        var lmEnd = new Date(t.getFullYear(), t.getMonth(), 0);
        from = iso(lm); to = iso(lmEnd);
      }
      else if (p === 'quarter') {from = iso(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1));}
      else if (p === 'year') {from = t.getFullYear() + '-01-01';}
      else {from = iso(t).slice(0, 8) + '01';} // 'month' / fallback
      document.getElementById('claFrom').value = from;
      document.getElementById('claTo').value = to;
      _loadCla();
    }

    function _loadCla() {
      var root = document.getElementById('claRoot');
      if (root) root.innerHTML = _skel(4);
      var from = (document.getElementById('claFrom') || {}).value || (_currMonth() + '-01');
      var to = (document.getElementById('claTo') || {}).value || _today();
      var dept = (document.getElementById('claDept') || {}).value || 'all';
      var freq = (document.getElementById('claFreqFlt') || {}).value || 'all';
      var emp = (document.getElementById('claEmp') || {}).value || 'all';
      _gasX('getChecklistAnalyticsV2', [{from: from, to: to, dept: dept, freq: freq, empId: emp}], 45000, function (data) {
        _D.claData = data;
        _renderCla();
      }, function (e) {
        if (root) root.innerHTML =
          '<div class="te"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) +
          '<br><br><button class="btn btn-sm" onclick="_loadCla()"><i class="fas fa-rotate-right"></i> Retry</button></div>';
      });
    }

    function _renderCla() {
      var data = _D.claData;
      if (!data) {_loadCla(); return;}
      var root = document.getElementById('claRoot');
      if (!root) return;

      var view = (document.getElementById('claView') || {}).value || 'overview';
      var bucket = (document.getElementById('claFilter') || {}).value || 'all';
      var sort = (document.getElementById('claSort') || {}).value || 'planned_desc';

      var emps = (data.by_employee || []).filter(function (e) {
        if (bucket === 'perfect') return e.completion_rate === 100;
        if (bucket === 'good') return e.completion_rate >= 80;
        if (bucket === 'avg') return e.completion_rate >= 50 && e.completion_rate < 80;
        if (bucket === 'low') return e.completion_rate < 50;
        return true;
      });
      emps = emps.slice().sort(function (a, b) {
        if (sort === 'rate_desc') return (b.completion_rate || 0) - (a.completion_rate || 0);
        if (sort === 'rate_asc') return (a.completion_rate || 0) - (b.completion_rate || 0);
        if (sort === 'done_desc') return (b.done || 0) - (a.done || 0);
        if (sort === 'lag_desc') return (b.avg_lag_days || 0) - (a.avg_lag_days || 0);
        if (sort === 'name_asc') return (a.name || '').localeCompare(b.name || '');
        return (b.planned || 0) - (a.planned || 0);
      });

      var depts = data.by_dept || [];
      var freqs = data.by_frequency || [];
      var tasks = data.by_task || [];
      var missed = data.most_missed_tasks || [];
      var trend = data.daily_trend || [];
      var monthly = data.monthly_trend || [];
      var weekday = data.weekday_pattern || [];
      var hours = data.hour_pattern || [];
      var deptFreq = data.dept_freq_matrix || [];
      var overdue = data.overdue_tasks || [];
      var empDetail = data.employee_detail;

      var avgR = data.avg_completion || 0;
      var arClr = avgR >= 80 ? 'var(--G)' : avgR >= 50 ? 'var(--O)' : 'var(--R)';

      var h = '';

      // ── Range / filter strip ────────────────────────────────────────────
      h += '<div style="font-size:12px;color:var(--tx3);font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<i class="fas fa-calendar-week"></i> ' + _fmtDate(data.from) + ' &rarr; ' + _fmtDate(data.to) +
        (data.filters && data.filters.dept !== 'all' ? ' &middot; <span style="color:var(--P)">' + _esc(data.filters.dept) + '</span>' : '') +
        (data.filters && data.filters.freq !== 'all' ? ' &middot; <span style="color:var(--V)">' + _esc(CLA_FREQ_LABELS[data.filters.freq] || data.filters.freq) + '</span>' : '') +
        (empDetail ? ' &middot; <span style="color:var(--T)">' + _esc(empDetail.name) + '</span>' : '') +
        '</div>';

      // ── KPI Strip ─────────────────────────────────────────────────────────
      h += '<div class="da-kpi-strip">' + [
        {lbl: 'Employees', val: data.employees || 0, c: 'var(--P)', ico: 'fa-users', sub: (data.working_days || 0) + ' working days'},
        {lbl: 'Tasks Planned', val: data.total_planned || 0, c: 'var(--I)', ico: 'fa-calendar-days', sub: 'In selected range'},
        {lbl: 'Tasks Done', val: data.total_done || 0, c: 'var(--G)', ico: 'fa-circle-check', sub: 'Completed'},
        {lbl: 'Pending', val: data.total_pending || 0, c: data.total_pending > 0 ? 'var(--O)' : 'var(--G)', ico: 'fa-clock', sub: 'Not yet done'},
        {lbl: 'Avg Completion', val: avgR + '%', c: arClr, ico: 'fa-chart-pie', sub: avgR >= 80 ? 'Excellent' : avgR >= 50 ? 'Average' : 'Needs attention'},
        {lbl: 'On-Time', val: (data.on_time_rate || 0) + '%', c: 'var(--G)', ico: 'fa-bolt', sub: (data.on_time_done || 0) + ' tasks'},
        {lbl: 'Late', val: (data.late_rate || 0) + '%', c: 'var(--O)', ico: 'fa-hourglass-half', sub: (data.late_done || 0) + ' tasks'},
        {lbl: 'Avg Delay', val: (data.avg_lag_days || 0) + 'd', c: (data.avg_lag_days || 0) > 1 ? 'var(--R)' : 'var(--tx2)', ico: 'fa-stopwatch', sub: 'When completed late'},
        {lbl: 'Overdue Now', val: data.overdue_count || 0, c: data.overdue_count > 0 ? 'var(--R)' : 'var(--G)', ico: 'fa-triangle-exclamation', sub: 'Past due, still pending'},
        {lbl: 'Tasks Tracked', val: data.distinct_tasks || 0, c: 'var(--V)', ico: 'fa-list-check', sub: 'Unique task types'},
        {lbl: 'Frequencies', val: freqs.length, c: 'var(--V)', ico: 'fa-repeat', sub: 'Task cadences'},
        {lbl: 'Buddy Notes', val: (data.buddy_usage_rate || 0) + '%', c: 'var(--T)', ico: 'fa-comment-dots', sub: (data.buddy_usage_count || 0) + ' remarks left'}
      ].map(function (k) {
        return '<div class="da-kpi">' +
          '<div class="da-kpi-row1"><div class="da-kpi-ico" style="--kc:' + k.c + '"><i class="fas ' + k.ico + '"></i></div>' +
          '<div class="da-kpi-val" style="color:' + k.c + '">' + k.val + '</div></div>' +
          '<div class="da-kpi-lbl">' + k.lbl + '</div>' +
          '<div class="da-kpi-sub">' + k.sub + '</div></div>';
      }).join('') + '</div>';

      // ── Completion ring banner ────────────────────────────────────────────
      var tp = data.total_planned || 0;
      var td = data.total_done || 0;
      var overallPct = tp > 0 ? Math.round(td / tp * 100) : 0;
      var ovClr = overallPct >= 80 ? 'var(--G)' : overallPct >= 50 ? 'var(--O)' : 'var(--R)';
      h += '<div class="da-banner">' +
        '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
        '<div class="da-banner-ring">' +
        '<svg viewBox="0 0 36 36" class="da-ring-svg">' +
        '<circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bdr)" stroke-width="2.5"/>' +
        '<circle cx="18" cy="18" r="15.9" fill="none" stroke="' + ovClr + '" stroke-width="2.5" stroke-dasharray="' + overallPct + ',100" stroke-dashoffset="25" stroke-linecap="round"/>' +
        '</svg><div class="da-ring-lbl" style="color:' + ovClr + '">' + overallPct + '%</div></div>' +
        '<div><div style="font-size:18px;font-weight:900;color:var(--tx)">' + overallPct + '% Overall Completion</div>' +
        '<div style="font-size:13px;color:var(--tx2);margin-top:3px">' + td + ' done of ' + tp + ' planned tasks &middot; ' + (data.on_time_rate || 0) + '% on-time</div></div></div>' +
        '<div style="display:flex;gap:20px;flex-wrap:wrap">' +
        [
          {lbl: 'Done', clr: 'var(--G)', val: td},
          {lbl: 'Pending', clr: 'var(--O)', val: data.total_pending || 0},
          {lbl: 'Overdue', clr: 'var(--R)', val: data.overdue_count || 0}
        ].map(function (s) {
          return '<div style="text-align:center">' +
            '<div style="font-size:20px;font-weight:900;color:' + s.clr + '">' + s.val + '</div>' +
            '<div style="font-size:10px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px">' + s.lbl + '</div></div>';
        }).join('') +
        '</div></div>';

      // ── Employee drill-down panel (shown whenever a specific employee is selected) ──
      if (empDetail) {
        h += '<div class="card card-nohover card-sm" style="margin-bottom:16px">' +
          '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-user" style="color:var(--P)"></i> ' + _esc(empDetail.name) + ' &mdash; Daily Log <span style="color:var(--tx3);font-weight:600">(' + _esc(empDetail.dept) + ')</span></div>' +
          '<div class="tw"><table><thead><tr><th>Date</th><th>Task</th><th>Freq</th><th>Status</th>' +
          '<th style="color:var(--P)"><i class="fas fa-calendar-clock"></i> Plan Time</th>' +
          '<th style="color:var(--G)"><i class="fas fa-check-circle"></i> Actual Time</th>' +
          '<th>Remark</th></tr></thead><tbody>' +
          (empDetail.log.length ? empDetail.log.map(function (r) {
            var planTime = r.scheduled_time || '';
            var actTime = r.actual ? _tsShort(r.actual) : '';
            var lagTag = '';
            if (r.status === 'Done' && r.actual && r.date) {
              var ld = Math.round((new Date(String(r.actual).substring(0, 10) + 'T00:00:00') - new Date(r.date + 'T00:00:00')) / 86400000);
              lagTag = ld > 0 ? ' <span style="color:var(--O);font-weight:800;font-size:10px">(+' + ld + 'd late)</span>' : ' <span style="color:var(--G);font-weight:800;font-size:10px">(on time)</span>';
            }
            return '<tr><td style="font-weight:700">' + _fmtDateShort(r.date) + '</td>' +
              '<td>' + _esc(r.task) + '</td>' +
              '<td>' + _freqBadge(r.freq) + '</td>' +
              '<td>' + _statusBadge(r.status) + lagTag + '</td>' +
              '<td style="color:var(--P);font-weight:600">' + (planTime ? '<i class="fas fa-calendar-clock"></i> ' + _esc(planTime) : '<span style="color:var(--tx3)">—</span>') + '</td>' +
              '<td style="color:var(--G);font-weight:600">' + (actTime ? '<i class="fas fa-check-circle"></i> ' + actTime : '<span style="color:var(--tx3)">—</span>') + '</td>' +
              '<td style="font-size:11px">' +
              (r.remark ? '<span style="color:var(--I);font-weight:600"><i class="fas fa-comment-dots"></i> ' + _esc(r.remark) + '</span>' :
                (r.buddy_remark ? '<span style="color:var(--tx3)">' + _esc(r.buddy_remark) + '</span>' : '<span style="color:var(--tx4)">—</span>')) +
              '</td></tr>';
          }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--tx3);padding:16px">No tasks in this range</td></tr>') +
          '</tbody></table></div></div>';
      }

      // ══ OVERVIEW view ═════════════════════════════════════════════════════
      if (view === 'overview') {
        h += '<div class="da-grid3">';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-building" style="color:var(--P)"></i> Dept Completion %</div>' +
          '<div style="height:200px"><canvas id="claChDept"></canvas></div></div>';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-chart-pie" style="color:var(--G)"></i> Done vs Pending</div>' +
          '<div style="height:200px"><canvas id="claChBreak"></canvas></div></div>';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-repeat" style="color:var(--V)"></i> By Frequency</div>' +
          '<div style="height:200px"><canvas id="claChFreq"></canvas></div></div>';
        h += '</div>';

        h += '<div class="da-grid2" style="margin-bottom:16px">';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-bolt" style="color:var(--G)"></i> On-Time vs Late</div>' +
          '<div style="height:190px"><canvas id="claChOnTime"></canvas></div></div>';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-triangle-exclamation" style="color:var(--R)"></i> Pending Aging</div>' +
          '<div style="height:190px"><canvas id="claChAgingMini"></canvas></div></div>';
        h += '</div>';

        var top5 = (data.by_employee || []).slice().sort(function (a, b) {return (b.completion_rate || 0) - (a.completion_rate || 0);}).slice(0, 5);
        var bot5 = (data.by_employee || []).slice().sort(function (a, b) {return (a.completion_rate || 0) - (b.completion_rate || 0);}).slice(0, 5);
        h += '<div class="da-grid2">';
        h += '<div class="card card-nohover card-sm">' +
          '<div class="sec-title" style="margin-bottom:14px;color:var(--G)"><i class="fas fa-trophy"></i> Top Performers</div>' +
          (top5.length ? top5.map(function (e, i) {
            var m = i === 0 ? '\uD83E\uDD47' : i === 1 ? '\uD83E\uDD48' : i === 2 ? '\uD83E\uDD49' : '#' + (i + 1);
            var r = e.completion_rate || 0;
            return '<div class="da-emp-row">' +
              '<div class="da-emp-rank">' + m + '</div>' +
              '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px">' + _esc(e.name) + '</div>' +
              '<div style="font-size:10px;color:var(--tx3)">' + _esc(e.dept || '') + '</div></div>' +
              '<div style="text-align:right"><div style="font-size:15px;font-weight:900;color:var(--G)">' + r + '%</div>' +
              '<div style="font-size:10px;color:var(--tx3)">' + e.done + '/' + e.planned + ' tasks</div></div></div>';
          }).join('') : '<div class="te">No data</div>') + '</div>';
        h += '<div class="card card-nohover card-sm">' +
          '<div class="sec-title" style="margin-bottom:14px;color:var(--R)"><i class="fas fa-triangle-exclamation"></i> Needs Attention</div>' +
          (!bot5.length || bot5.every(function (e) {return e.completion_rate === 100;})
            ? '<div style="text-align:center;padding:24px;color:var(--G)"><i class="fas fa-circle-check" style="font-size:32px;margin-bottom:8px;display:block"></i><div style="font-weight:700">All employees on track!</div></div>'
            : bot5.map(function (e) {
              var r = e.completion_rate || 0;
              var rC = r >= 80 ? 'var(--G)' : r >= 50 ? 'var(--O)' : 'var(--R)';
              return '<div class="da-emp-row">' +
                '<div class="da-emp-avatar" style="background:var(--Rl);color:var(--R)">' + _esc((e.name || '?').charAt(0)) + '</div>' +
                '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px">' + _esc(e.name) + '</div>' +
                '<div style="font-size:10px;color:var(--tx3)">' + _esc(e.dept || '') + '</div></div>' +
                '<div style="text-align:right"><div style="font-size:15px;font-weight:900;color:' + rC + '">' + r + '%</div>' +
                '<div style="font-size:10px;color:var(--R)">' + e.pending + ' pending</div></div></div>';
            }).join('')
          ) + '</div>';
        h += '</div>';

        if (missed.length) {
          h += '<div class="card card-nohover card-sm" style="margin-top:16px">' +
            '<div class="sec-title" style="margin-bottom:14px;color:var(--O)"><i class="fas fa-list-check"></i> Most-Missed Tasks</div>' +
            missed.slice(0, 5).map(function (t) {
              return '<div class="da-emp-row" style="cursor:pointer" onclick="_claDrillTask(\'' + _esc(t.task).replace(/'/g, "\\'") + '\',\'' + _esc(t.dept || '').replace(/'/g, "\\'") + '\')" title="Click to see who has this task">' +
                '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px">' + _esc(t.task) + '</div>' +
                '<div style="font-size:10px;color:var(--tx3)">' + _esc(t.dept || '') + ' &middot; ' + _esc(CLA_FREQ_LABELS[t.freq] || t.freq) + '</div></div>' +
                '<div style="text-align:right"><div style="font-size:15px;font-weight:900;color:var(--R)">' + t.pending + '</div>' +
                '<div style="font-size:10px;color:var(--tx3)">of ' + t.planned + ' missed</div></div></div>';
            }).join('') + '</div>';
        }
      }

      // ══ EMPLOYEE view ═════════════════════════════════════════════════════
      if (view === 'employee') {
        h += '<div class="da-emp-search-bar" style="margin-top:4px">' +
          '<input type="text" id="claEmpQ" class="ana-sel" placeholder="\uD83D\uDD0D Search employee..." oninput="_filterClaEmps()" style="width:100%;max-width:220px">' +
          '<span style="font-size:12px;color:var(--tx3)">' + emps.length + ' employees</span>' +
          '</div>' +
          '<div class="da-emp-cards" id="claEmpCards">' +
          emps.map(function (e) {
            var r = e.completion_rate || 0;
            var rC = r >= 80 ? 'var(--G)' : r >= 50 ? 'var(--O)' : 'var(--R)';
            var topFreqs = Object.keys(e.freqs || {}).sort(function (a, b) {return (e.freqs[b] || 0) - (e.freqs[a] || 0);}).slice(0, 3);
            return '<div class="da-emp-card' + (r < 50 ? ' da-emp-card-alert' : '') + '" style="cursor:pointer" onclick="_claDrillEmployee(\'' + _esc(e.emp_id) + '\')" title="Click to see task details">' +
              '<div class="da-emp-card-head">' +
              '<div class="da-emp-avatar" style="background:var(--Pl);color:var(--P)">' + _esc((e.name || '?').charAt(0).toUpperCase()) + '</div>' +
              '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(e.name) + '</div>' +
              '<div style="font-size:11px;color:var(--tx3)">' + _esc(e.dept || '') + '</div></div>' +
              '<div style="font-size:20px;font-weight:900;color:' + rC + '">' + r + '%</div></div>' +
              '<div class="da-stat-row">' +
              [
                {lbl: 'Planned', val: e.planned || 0, c: 'var(--P)'},
                {lbl: 'Done', val: e.done || 0, c: 'var(--G)'},
                {lbl: 'Pending', val: e.pending || 0, c: e.pending > 0 ? 'var(--O)' : 'var(--tx3)'}
              ].map(function (s) {
                return '<div class="da-stat-cell"><div style="font-size:16px;font-weight:900;color:' + s.c + '">' + s.val + '</div>' +
                  '<div style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px">' + s.lbl + '</div></div>';
              }).join('') + '</div>' +
              '<div class="pbar-wrap" style="margin:8px 0"><div class="pbar" style="width:' + r + '%;background:' + rC + '"></div></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--tx3);margin-top:6px">' +
              '<span><i class="fas fa-bolt" style="color:var(--G)"></i> ' + (e.on_time_rate || 0) + '% on-time</span>' +
              '<span><i class="fas fa-stopwatch"></i> ' + (e.avg_lag_days || 0) + 'd avg delay</span></div>' +
              (topFreqs.length ? '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px">' +
                topFreqs.map(function (f) {return '<span class="bdg" style="font-size:9px;background:var(--Vl);color:var(--V)">' + _esc(CLA_FREQ_LABELS[f] || f) + '</span>';}).join('') +
                '</div>' : '') +
              '</div>';
          }).join('') + '</div>';
        if (!emps.length) h += '<div class="te" style="margin-top:16px"><i class="fas fa-search"></i> No employees match this filter</div>';
      }

      // ══ DEPT view ═════════════════════════════════════════════════════════
      if (view === 'dept') {
        h += '<div class="da-grid-dept" style="margin-top:4px">';
        depts.forEach(function (d) {
          var r = d.completion_rate || 0;
          var rC = r >= 80 ? 'var(--G)' : r >= 50 ? 'var(--O)' : 'var(--R)';
          h += '<div class="da-dept-card" style="cursor:pointer" onclick="_claDrillDept(\'' + _esc(d.dept).replace(/'/g, "\\'") + '\')" title="Click to see task details">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
            '<div><div style="font-weight:800;font-size:14px">' + _esc(d.dept) + '</div>' +
            '<div style="font-size:10px;color:var(--tx3)">' + (d.employees || 0) + ' employees</div></div>' +
            '<div style="font-size:20px;font-weight:900;color:' + rC + '">' + r + '%</div></div>' +
            '<div class="pbar-wrap" style="margin-bottom:10px"><div class="pbar" style="width:' + r + '%;background:' + rC + '"></div></div>' +
            '<div style="display:flex;justify-content:space-between;font-size:12px">' +
            '<span style="color:var(--tx2)"><b>' + d.planned + '</b> planned</span>' +
            '<span style="color:var(--G)"><b>' + d.done + '</b> done</span>' +
            '<span style="color:' + (d.pending > 0 ? 'var(--O)' : 'var(--tx3)') + '"><b>' + d.pending + '</b> pending</span>' +
            '</div></div>';
        });
        h += '</div>';
        if (!depts.length) h += '<div class="te"><i class="fas fa-building"></i> No department data in this range</div>';

        h += '<div class="da-chart-card" style="margin-top:16px">' +
          '<div class="da-chart-ttl"><i class="fas fa-building" style="color:var(--P)"></i> Department Comparison</div>' +
          '<div style="height:220px"><canvas id="claChDeptBig"></canvas></div></div>';

        if (deptFreq.length) {
          h += '<div class="card card-nohover card-sm" style="margin-top:16px">' +
            '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-table-cells" style="color:var(--V)"></i> Department &times; Frequency Matrix</div>' +
            '<div class="tw"><table><thead><tr><th>Department</th><th>Frequency</th>' +
            '<th style="text-align:center">Planned</th><th style="text-align:center">Done</th><th style="text-align:center">Rate</th></tr></thead><tbody>' +
            deptFreq.map(function (d) {
              return d.freqs.map(function (f, i) {
                var c = f.completion_rate >= 80 ? 'var(--G)' : f.completion_rate >= 50 ? 'var(--O)' : 'var(--R)';
                return '<tr>' + (i === 0 ? '<td rowspan="' + d.freqs.length + '" style="font-weight:800;vertical-align:top">' + _esc(d.dept) + '</td>' : '') +
                  '<td>' + _freqBadge(f.freq) + '</td>' +
                  '<td style="text-align:center;font-weight:700">' + f.planned + '</td>' +
                  '<td style="text-align:center;font-weight:700;color:var(--G)">' + f.done + '</td>' +
                  '<td style="text-align:center;font-weight:900;color:' + c + '">' + f.completion_rate + '%</td></tr>';
              }).join('');
            }).join('') + '</tbody></table></div></div>';
        }
      }

      // ══ TASK view (NEW) ═══════════════════════════════════════════════════
      if (view === 'task') {
        if (missed.length) {
          h += '<div class="card card-nohover card-sm" style="margin-top:4px;margin-bottom:16px">' +
            '<div class="sec-title" style="margin-bottom:14px;color:var(--O)"><i class="fas fa-triangle-exclamation"></i> Most-Missed Tasks</div>' +
            missed.map(function (t) {
              var r = t.completion_rate || 0;
              var rC = r >= 80 ? 'var(--G)' : r >= 50 ? 'var(--O)' : 'var(--R)';
              return '<div class="da-emp-row" style="cursor:pointer" onclick="_claDrillTask(\'' + _esc(t.task).replace(/'/g, "\\'") + '\',\'' + _esc(t.dept || '').replace(/'/g, "\\'") + '\')" title="Click to see who has this task">' +
                '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px">' + _esc(t.task) + '</div>' +
                '<div style="font-size:10px;color:var(--tx3)">' + _esc(t.dept || '') + ' &middot; ' + _esc(CLA_FREQ_LABELS[t.freq] || t.freq) + '</div></div>' +
                '<div style="text-align:right"><div style="font-size:15px;font-weight:900;color:' + rC + '">' + r + '%</div>' +
                '<div style="font-size:10px;color:var(--R)">' + t.pending + ' of ' + t.planned + ' pending</div></div></div>';
            }).join('') + '</div>';
        }

        h += '<div class="card card-nohover card-sm">' +
          '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-list-check" style="color:var(--P)"></i> All Tasks (' + tasks.length + ')</div>' +
          '<div class="tw"><table><thead><tr><th>Task</th><th>Dept</th><th>Freq</th>' +
          '<th style="text-align:center">Planned</th><th style="text-align:center">Done</th><th style="text-align:center">Pending</th><th style="text-align:center">Rate</th></tr></thead><tbody>' +
          (tasks.length ? tasks.map(function (t) {
            var c = t.completion_rate >= 80 ? 'var(--G)' : t.completion_rate >= 50 ? 'var(--O)' : 'var(--R)';
            return '<tr style="cursor:pointer" onclick="_claDrillTask(\'' + _esc(t.task).replace(/'/g, "\\'") + '\',\'' + _esc(t.dept || '').replace(/'/g, "\\'") + '\')" title="Click to see who has this task"><td style="font-weight:700">' + _esc(t.task) + '</td>' +
              '<td style="color:var(--tx2)">' + _esc(t.dept || '') + '</td>' +
              '<td>' + _freqBadge(t.freq) + '</td>' +
              '<td style="text-align:center">' + t.planned + '</td>' +
              '<td style="text-align:center;color:var(--G);font-weight:700">' + t.done + '</td>' +
              '<td style="text-align:center;color:' + (t.pending > 0 ? 'var(--O)' : 'var(--tx3)') + ';font-weight:700">' + t.pending + '</td>' +
              '<td style="text-align:center;font-weight:900;color:' + c + '">' + t.completion_rate + '%</td></tr>';
          }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--tx3);padding:16px">No tasks in this range</td></tr>') +
          '</tbody></table></div></div>';
      }

      // ══ TREND view (Trends & Patterns) ════════════════════════════════════
      if (view === 'trend') {
        h += '<div class="da-grid2" style="margin-top:4px">';
        h += '<div class="da-chart-card da-chart-wide-2">' +
          '<div class="da-chart-ttl"><i class="fas fa-chart-line" style="color:var(--T)"></i> Daily Tasks Done vs Planned</div>' +
          '<div style="height:230px"><canvas id="claChTrend"></canvas></div></div>';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-repeat" style="color:var(--V)"></i> Frequency Breakdown</div>' +
          '<div style="height:230px"><canvas id="claChFreqBig"></canvas></div></div>';
        h += '</div>';

        h += '<div class="da-grid2" style="margin-top:16px">';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-calendar-day" style="color:var(--P)"></i> Day-of-Week Pattern</div>' +
          '<div style="height:220px"><canvas id="claChWeekday"></canvas></div></div>';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-clock" style="color:var(--I)"></i> Time-of-Day — When Tasks Get Done</div>' +
          '<div style="height:220px"><canvas id="claChHour"></canvas></div></div>';
        h += '</div>';

        if (monthly.length > 1) {
          h += '<div class="da-chart-card" style="margin-top:16px">' +
            '<div class="da-chart-ttl"><i class="fas fa-chart-line" style="color:var(--G)"></i> Month-over-Month Completion %</div>' +
            '<div style="height:220px"><canvas id="claChMonthly"></canvas></div></div>';
        }

        h += '<div class="card card-nohover card-sm" style="margin-top:16px">' +
          '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-calendar-days" style="color:var(--P)"></i> Daily Detail (last 30)</div>' +
          '<div class="tw"><table><thead><tr><th>Date</th><th style="text-align:center;color:var(--I)">Planned</th>' +
          '<th style="text-align:center;color:var(--G)">Done</th><th style="text-align:center">Rate</th></tr></thead><tbody>' +
          (trend.length ? trend.slice(-30).reverse().map(function (t) {
            var r2 = t.planned > 0 ? Math.round(t.done / t.planned * 100) : 0;
            var c2 = r2 >= 80 ? 'var(--G)' : r2 >= 50 ? 'var(--O)' : 'var(--R)';
            return '<tr><td style="font-weight:700">' + _fmtDate(t.date) + '</td>' +
              '<td style="text-align:center;font-weight:800">' + t.planned + '</td>' +
              '<td style="text-align:center;font-weight:800;color:var(--G)">' + t.done + '</td>' +
              '<td style="text-align:center"><span style="font-weight:900;color:' + c2 + '">' + r2 + '%</span></td></tr>';
          }).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--tx3);padding:16px">No data</td></tr>') +
          '</tbody></table></div></div>';
      }

      // ══ AGING view — Pending & Aging (NEW) ═══════════════════════════════
      if (view === 'aging') {
        var ag = data.pending_aging || {d0_1: 0, d2_3: 0, d4_7: 0, d8plus: 0};
        h += '<div class="da-grid2" style="margin-top:4px">';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-hourglass-half" style="color:var(--R)"></i> Pending Aging Buckets</div>' +
          '<div style="height:220px"><canvas id="claChAgingBig"></canvas></div></div>';
        h += '<div class="card card-nohover card-sm">' +
          '<div class="sec-title" style="margin-bottom:12px;color:var(--R)"><i class="fas fa-triangle-exclamation"></i> Aging Summary</div>' +
          [
            {lbl: '0-1 day overdue', val: ag.d0_1, c: 'var(--O)'},
            {lbl: '2-3 days overdue', val: ag.d2_3, c: 'var(--O)'},
            {lbl: '4-7 days overdue', val: ag.d4_7, c: 'var(--R)'},
            {lbl: '8+ days overdue', val: ag.d8plus, c: 'var(--R)'}
          ].map(function (b) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--bdr)">' +
              '<span style="font-size:13px;color:var(--tx2)">' + b.lbl + '</span>' +
              '<span style="font-size:16px;font-weight:900;color:' + b.c + '">' + b.val + '</span></div>';
          }).join('') + '</div>';
        h += '</div>';

        h += '<div class="card card-nohover card-sm" style="margin-top:16px">' +
          '<div class="sec-title" style="margin-bottom:12px;color:var(--R)"><i class="fas fa-list-ol"></i> Most Overdue Tasks (' + (data.overdue_count || 0) + ' total pending &amp; overdue)</div>' +
          '<div class="tw"><table><thead><tr><th>Employee</th><th>Dept</th><th>Task</th><th>Freq</th>' +
          '<th style="text-align:center">Planned</th><th style="text-align:center">Overdue</th></tr></thead><tbody>' +
          (overdue.length ? overdue.map(function (o) {
            var c = o.days_overdue >= 7 ? 'var(--R)' : o.days_overdue >= 3 ? 'var(--O)' : 'var(--tx2)';
            return '<tr style="cursor:pointer" onclick="_claDrillEmployee(\'' + _esc(o.emp_id) + '\')" title="Click to see this employee\'s tasks"><td style="font-weight:700">' + _esc(o.name) + '</td>' +
              '<td style="color:var(--tx2)">' + _esc(o.dept || '') + '</td>' +
              '<td>' + _esc(o.task) + '</td>' +
              '<td>' + _freqBadge(o.freq) + '</td>' +
              '<td style="text-align:center">' + _fmtDateShort(o.planned) + '</td>' +
              '<td style="text-align:center;font-weight:900;color:' + c + '">' + o.days_overdue + 'd</td></tr>';
          }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--G);padding:16px"><i class="fas fa-circle-check"></i> Nothing overdue — all caught up!</td></tr>') +
          '</tbody></table></div></div>';
      }

      root.innerHTML = h;

      // ── Charts ────────────────────────────────────────────────────────────
      _whenChart(function () {
        var isDk = document.body.classList.contains('dark');
        var gc = isDk ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', tc = isDk ? '#94a3b8' : '#64748b';

        function mkC(id, type, labels, datasets, extra) {
          var cv = document.getElementById(id); if (!cv) return;
          if (cv._ci) {try {cv._ci.destroy();} catch (e) { } }
          function dm(a, b) {var r = Object.assign({}, a); Object.keys(b || {}).forEach(function (k) {r[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) ? dm(a[k] || {}, b[k]) : b[k];}); return r;}
          var isR = type === 'pie' || type === 'doughnut';
          var base = {
            responsive: true, maintainAspectRatio: false,
            plugins: {legend: {labels: {color: tc, font: {size: 11}, boxWidth: 12}}},
            scales: isR ? {} : {x: {ticks: {color: tc, font: {size: 10}}, grid: {color: gc}}, y: {ticks: {color: tc, font: {size: 10}}, grid: {color: gc}}}
          };
          cv._ci = new Chart(cv, {type: type, data: {labels: labels, datasets: datasets}, options: dm(base, extra || {})});
        }

        // Dept completion bar (mini + big)
        if (depts.length) {
          mkC('claChDept', 'bar', depts.map(function (d) {return d.dept;}),
            [{
              label: '%', data: depts.map(function (d) {return d.completion_rate || 0;}),
              backgroundColor: depts.map(function (d) {return (d.completion_rate || 0) >= 80 ? 'rgba(47,158,68,.8)' : (d.completion_rate || 0) >= 50 ? 'rgba(245,158,11,.8)' : 'rgba(220,38,38,.8)';}),
              borderRadius: 5, borderSkipped: false
            }],
            {plugins: {legend: {display: false}}, scales: {y: {min: 0, max: 100}}});
          mkC('claChDeptBig', 'bar', depts.map(function (d) {return d.dept;}),
            [{label: 'Done', data: depts.map(function (d) {return d.done || 0;}), backgroundColor: 'rgba(47,158,68,.8)', borderRadius: 5, borderSkipped: false},
            {label: 'Pending', data: depts.map(function (d) {return d.pending || 0;}), backgroundColor: 'rgba(245,158,11,.5)', borderRadius: 5, borderSkipped: false}],
            {plugins: {legend: {position: 'bottom'}}, scales: {x: {stacked: true}, y: {stacked: true}}});
        }

        // Done vs Pending donut
        mkC('claChBreak', 'doughnut', ['Done', 'Pending'],
          [{data: [td, data.total_pending || 0], backgroundColor: ['rgba(47,158,68,.85)', 'rgba(245,158,11,.75)'], borderWidth: 0, hoverOffset: 10}],
          {cutout: '60%', plugins: {legend: {position: 'bottom'}}});

        // Frequency (mini pie + big bar)
        if (freqs.length) {
          var fColors = ['rgba(112,72,232,.8)', 'rgba(14,165,233,.8)', 'rgba(47,158,68,.8)', 'rgba(245,158,11,.8)', 'rgba(220,38,38,.8)', 'rgba(148,163,184,.7)', 'rgba(13,148,136,.8)', 'rgba(217,119,6,.8)'];
          mkC('claChFreq', 'pie', freqs.map(function (f) {return f.label;}),
            [{data: freqs.map(function (f) {return f.count;}), backgroundColor: freqs.map(function (_, i) {return fColors[i % fColors.length];}), borderWidth: 0}],
            {plugins: {legend: {position: 'bottom'}}});
          mkC('claChFreqBig', 'bar', freqs.map(function (f) {return f.label;}),
            [{label: 'Tasks', data: freqs.map(function (f) {return f.count;}), backgroundColor: freqs.map(function (_, i) {return fColors[i % fColors.length];}), borderRadius: 5, borderSkipped: false}],
            {plugins: {legend: {display: false}}});
        }

        // On-time vs Late donut
        mkC('claChOnTime', 'doughnut', ['On-Time', 'Late', 'Pending'],
          [{
            data: [data.on_time_done || 0, data.late_done || 0, data.total_pending || 0],
            backgroundColor: ['rgba(47,158,68,.85)', 'rgba(245,158,11,.85)', 'rgba(148,163,184,.6)'], borderWidth: 0, hoverOffset: 10
          }],
          {cutout: '60%', plugins: {legend: {position: 'bottom'}}});

        // Pending aging (mini + big)
        var ag2 = data.pending_aging || {d0_1: 0, d2_3: 0, d4_7: 0, d8plus: 0};
        var agLabels = ['0-1 day', '2-3 days', '4-7 days', '8+ days'];
        var agData = [ag2.d0_1 || 0, ag2.d2_3 || 0, ag2.d4_7 || 0, ag2.d8plus || 0];
        var agColors = ['rgba(245,158,11,.7)', 'rgba(245,158,11,.9)', 'rgba(220,38,38,.75)', 'rgba(220,38,38,.95)'];
        mkC('claChAgingMini', 'bar', agLabels, [{label: 'Overdue tasks', data: agData, backgroundColor: agColors, borderRadius: 5, borderSkipped: false}],
          {plugins: {legend: {display: false}}});
        mkC('claChAgingBig', 'bar', agLabels, [{label: 'Overdue tasks', data: agData, backgroundColor: agColors, borderRadius: 5, borderSkipped: false}],
          {plugins: {legend: {display: false}}});

        // Daily trend line
        if (trend.length) {
          mkC('claChTrend', 'line',
            trend.map(function (t) {var p = t.date.split('-'); return p[2] + '/' + p[1];}),
            [
              {label: 'Planned', data: trend.map(function (t) {return t.planned;}), borderColor: 'rgba(14,165,233,.9)', backgroundColor: 'rgba(14,165,233,.1)', fill: true, tension: 0.4, pointRadius: 2},
              {label: 'Done', data: trend.map(function (t) {return t.done;}), borderColor: 'rgba(47,158,68,.9)', backgroundColor: 'rgba(47,158,68,.1)', fill: true, tension: 0.4, pointRadius: 2}
            ],
            {scales: {y: {beginAtZero: true}}, plugins: {legend: {position: 'bottom'}}});
        }

        // Day-of-week pattern
        if (weekday.length) {
          mkC('claChWeekday', 'bar', weekday.map(function (w) {return w.day.substring(0, 3);}),
            [{
              label: 'Completion %', data: weekday.map(function (w) {return w.completion_rate || 0;}),
              backgroundColor: weekday.map(function (w) {return (w.completion_rate || 0) >= 80 ? 'rgba(47,158,68,.8)' : (w.completion_rate || 0) >= 50 ? 'rgba(245,158,11,.8)' : 'rgba(220,38,38,.8)';}),
              borderRadius: 5, borderSkipped: false
            }],
            {plugins: {legend: {display: false}}, scales: {y: {min: 0, max: 100}}});
        }

        // Time-of-day pattern
        if (hours.length) {
          var hColors = ['rgba(245,158,11,.8)', 'rgba(14,165,233,.8)', 'rgba(112,72,232,.8)', 'rgba(13,148,136,.8)', 'rgba(71,85,105,.7)'];
          mkC('claChHour', 'bar', hours.map(function (s) {return s.slot;}),
            [{label: 'Tasks completed', data: hours.map(function (s) {return s.count;}), backgroundColor: hours.map(function (_, i) {return hColors[i % hColors.length];}), borderRadius: 5, borderSkipped: false}],
            {plugins: {legend: {display: false}}, indexAxis: 'y'});
        }

        // Month-over-month trend
        if (monthly.length > 1) {
          mkC('claChMonthly', 'line', monthly.map(function (m) {return m.month;}),
            [{label: 'Completion %', data: monthly.map(function (m) {return m.completion_rate || 0;}), borderColor: 'rgba(47,158,68,.9)', backgroundColor: 'rgba(47,158,68,.1)', fill: true, tension: 0.3, pointRadius: 3}],
            {scales: {y: {min: 0, max: 100}}, plugins: {legend: {display: false}}});
        }
      }, 80);
    }

    // ── Click-to-drill-down: employee / dept / task cards ─────────────────────
    function _claDrillEmployee(empId) {
      var data = _D.claData;
      if (!data || !data.raw_log) {_toast('No detail data loaded', 'err'); return;}
      var rows = data.raw_log.filter(function (l) {return l.emp_id === empId;});
      var empName = rows.length ? rows[0].name : empId;
      var done = rows.filter(function (l) {return l.status === 'Done';}).length;
      _showDrillModal(
        _esc(empName) + ' — Task Breakdown',
        rows.length + ' tasks &middot; ' + done + ' done &middot; ' + (rows.length - done) + ' pending (' + _fmtDate(data.from) + ' &rarr; ' + _fmtDate(data.to) + ')',
        [
          {label: 'Date', key: 'planned', render: function (r) {return _fmtDateShort(r.planned);}},
          {label: 'Task', key: 'task'},
          {label: 'Freq', render: function (r) {return _freqBadge(r.freq);}},
          {label: 'Status', render: function (r) {return _statusBadge(r.status);}}
        ],
        rows.sort(function (a, b) {return (b.planned || '').localeCompare(a.planned || '');}),
        data.raw_log_total > data.raw_log.length ? 'Showing first ' + data.raw_log.length + ' of ' + data.raw_log_total + ' total rows in this range' : null
      );
    }

    function _claDrillDept(deptName) {
      var data = _D.claData;
      if (!data || !data.raw_log) {_toast('No detail data loaded', 'err'); return;}
      var rows = data.raw_log.filter(function (l) {return l.dept === deptName;});
      var done = rows.filter(function (l) {return l.status === 'Done';}).length;
      _showDrillModal(
        _esc(deptName) + ' — Task Breakdown',
        rows.length + ' tasks &middot; ' + done + ' done &middot; ' + (rows.length - done) + ' pending',
        [
          {label: 'Employee', key: 'name'},
          {label: 'Date', render: function (r) {return _fmtDateShort(r.planned);}},
          {label: 'Task', key: 'task'},
          {label: 'Status', render: function (r) {return _statusBadge(r.status);}}
        ],
        rows.sort(function (a, b) {return (b.planned || '').localeCompare(a.planned || '');})
      );
    }

    function _claDrillTask(taskName, deptName) {
      var data = _D.claData;
      if (!data || !data.raw_log) {_toast('No detail data loaded', 'err'); return;}
      var rows = data.raw_log.filter(function (l) {return l.task === taskName && (!deptName || l.dept === deptName);});
      _showDrillModal(
        _esc(taskName) + ' — Who has this task',
        rows.length + ' instances in this range',
        [
          {label: 'Employee', key: 'name'},
          {label: 'Date', render: function (r) {return _fmtDateShort(r.planned);}},
          {label: 'Dept', key: 'dept'},
          {label: 'Status', render: function (r) {return _statusBadge(r.status);}}
        ],
        rows.sort(function (a, b) {return (b.planned || '').localeCompare(a.planned || '');})
      );
    }

    function _filterClaEmps() {
      var q = ((document.getElementById('claEmpQ') || {}).value || '').toLowerCase().trim();
      document.querySelectorAll('#claEmpCards .da-emp-card').forEach(function (el) {
        el.style.display = (!q || el.textContent.toLowerCase().indexOf(q) >= 0) ? '' : 'none';
      });
    }

    function _exportClaCsv() {
      var data = _D.claData;
      if (!data) {_toast('Load analytics first', 'err'); return;}
      var view = (document.getElementById('claView') || {}).value || 'overview';
      var head, rows, name;

      if (view === 'task') {
        head = ['Task', 'Department', 'Frequency', 'Planned', 'Done', 'Pending', 'Completion %'];
        rows = (data.by_task || []).map(function (t) {return ['"' + (t.task || '') + '"', '"' + (t.dept || '') + '"', t.freq || '', t.planned || 0, t.done || 0, t.pending || 0, (t.completion_rate || 0) + '%'];});
        name = 'checklist_by_task';
      } else if (view === 'aging') {
        head = ['Employee', 'Department', 'Task', 'Frequency', 'Planned Date', 'Days Overdue'];
        rows = (data.overdue_tasks || []).map(function (o) {return ['"' + (o.name || '') + '"', '"' + (o.dept || '') + '"', '"' + (o.task || '') + '"', o.freq || '', o.planned || '', o.days_overdue || 0];});
        name = 'checklist_overdue';
      } else if (view === 'dept') {
        head = ['Department', 'Employees', 'Planned', 'Done', 'Pending', 'Completion %'];
        rows = (data.by_dept || []).map(function (d) {return ['"' + (d.dept || '') + '"', d.employees || 0, d.planned || 0, d.done || 0, d.pending || 0, (d.completion_rate || 0) + '%'];});
        name = 'checklist_by_dept';
      } else {
        head = ['Employee', 'Department', 'Planned', 'Done', 'Pending', 'Completion %', 'On-Time %', 'Avg Delay (days)'];
        rows = (data.by_employee || []).map(function (e) {return ['"' + (e.name || '') + '"', '"' + (e.dept || '') + '"', e.planned || 0, e.done || 0, e.pending || 0, (e.completion_rate || 0) + '%', (e.on_time_rate || 0) + '%', e.avg_lag_days || 0];});
        name = 'checklist_by_employee';
      }

      if (!rows.length) {_toast('No data to export', 'err'); return;}
      var csv = [head.join(',')].concat(rows.map(function (r) {return r.join(',');})).join('\n');
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFF' + csv);
      a.download = name + '_' + (data.from || _currMonth()) + '_to_' + (data.to || _today()) + '.csv';
      a.click();
      _toast('Exported!', 'ok');
    }




    function _getGiverOptions() {
      var givers = [];
      var seen = {};
      var src = (_D.empDir && _D.empDir.length) ? _D.empDir
        : (_D.doers && _D.doers.length) ? _D.doers
          : [];
      src.forEach(function (d) {
        var id = String(d.emp_id || d['Emp ID'] || '').trim();
        var name = String(d.name || d['Name'] || '').trim();
        if (id && name && !seen[id]) {seen[id] = true; givers.push({id: id, name: name});}
      });
      givers.sort(function (a, b) {return a.name.localeCompare(b.name);});
      return givers.map(function (g) {return '<option value="' + _esc(g.id) + '">' + _esc(g.name) + '</option>';}).join('');
    }

    function _vDelAna() {
      if (!_isManager()) {
        document.getElementById('content').innerHTML =
          '<div class="empty-state"><i class="fas fa-lock"></i><h4>Access Restricted</h4></div>';
        return;
      }
      if (!_D.empDir || !_D.empDir.length) {
        document.getElementById('content').innerHTML =
          '<div class="mod-head"><div><div class="mod-title">Delegation Analytics</div></div></div>' + _skel(4);
        _gas('getEmployeeDirectory', [], function (emps) {
          _D.empDir = emps || [];
          _vDelAnaBuild();
        }, function () {_vDelAnaBuild();});
        return;
      }
      _vDelAnaBuild();
    }

    function _vDelAnaBuild() {
      var defFrom = '2020-01-01';
      var defTo = _today();
      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div><div class="mod-title">Delegation Analytics</div>' +
        '<div class="mod-sub">Workload distribution, completion rates, on-time performance &amp; overdue analysis</div></div>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:var(--sur2);border-radius:12px;border:1px solid var(--bdr);margin-bottom:14px">' +

        '<select id="daPreset" class="ana-sel" style="min-width:110px" onchange="_daApplyPreset()">' +
        '<option value="alltime">All Time</option>' +
        '<option value="month">This Month</option>' +
        '<option value="last3m">Last 3 Months</option>' +
        '<option value="quarter">This Quarter</option>' +
        '<option value="year">This Year</option>' +
        '<option value="custom">Custom Range</option>' +
        '</select>' +
        '<input type="date" id="daFrom" class="ana-sel" style="max-width:130px" value="' + defFrom + '" onchange="_daMarkCustom();_loadDa()">' +
        '<span style="color:var(--tx3);font-size:11px;font-weight:700">→</span>' +
        '<input type="date" id="daTo" class="ana-sel" style="max-width:130px" value="' + defTo + '" onchange="_daMarkCustom();_loadDa()">' +
        '<div style="width:1px;height:24px;background:var(--bdr);flex-shrink:0"></div>' +
        '<select id="daDept" class="ana-sel" style="min-width:120px" onchange="_loadDa()">' +
        '<option value="all">All Depts</option>' +
        _getDeptOptions() +
        '</select>' +
        _ssHtml('daEmp', '<option value="all">All Assignees</option>' + _getEmpOptions(), 'All Assignees', '_loadDa') +
        _ssHtml('daGiver', '<option value="all">All Delegators</option>' + _getGiverOptions(), 'All Delegators', '_loadDa') +
        '<select id="daStatus" class="ana-sel" style="min-width:100px" onchange="_loadDa()">' +
        '<option value="all">All Status</option>' +
        '<option value="Pending">Pending</option>' +
        '<option value="Completed">Completed</option>' +
        '<option value="overdue">Overdue</option>' +
        '<option value="Cancelled">Cancelled</option>' +
        '<option value="Shifted">Shifted</option>' +
        '</select>' +
        '<div style="width:1px;height:24px;background:var(--bdr);flex-shrink:0"></div>' +
        '<select id="daView" class="ana-sel" style="min-width:130px" onchange="_renderDa()">' +
        '<option value="overview">Overview</option>' +
        '<option value="employee">By Employee</option>' +
        '<option value="dept">By Department</option>' +
        '<option value="giver">By Delegator</option>' +
        '<option value="trend">Trends &amp; Patterns</option>' +
        '<option value="aging">Pending &amp; Overdue</option>' +
        '</select>' +
        '<select id="daSort2" class="ana-sel" style="min-width:110px" onchange="_renderDa()">' +
        '<option value="assigned_desc">Assigned &darr;</option>' +
        '<option value="rate_desc">Completion % &darr;</option>' +
        '<option value="rate_asc">Completion % &uarr;</option>' +
        '<option value="overdue_desc">Overdue &darr;</option>' +
        '<option value="name_asc">Name A-Z</option>' +
        '</select>' +
        '<div style="flex:1"></div>' +
        '<button class="btn btn-sm" onclick="_loadDa()" style="white-space:nowrap"><i class="fas fa-chart-bar"></i> Analyze</button>' +
        '<button class="btn btn-sm btn-outline" onclick="_exportDaCSV()" style="white-space:nowrap"><i class="fas fa-file-export"></i> Export</button>' +
        '</div></div>' +
        '<div id="daRoot">' + _skel(4) + '</div>';

      _loadDa();
    }

    function _daMarkCustom() {
      var p = document.getElementById('daPreset');
      if (p) p.value = 'custom';
    }

    function _daApplyPreset() {
      var p = (document.getElementById('daPreset') || {}).value || 'alltime';
      if (p === 'custom') return;
      var t = new Date();
      function iso(d) {return d.toISOString().slice(0, 10);}
      var from, to = iso(t);
      if (p === 'alltime') {from = '2020-01-01';}
      else if (p === 'month') {from = iso(t).slice(0, 8) + '01';}
      else if (p === 'last3m') {var l3 = new Date(t); l3.setMonth(l3.getMonth() - 3); from = iso(l3);}
      else if (p === 'quarter') {from = iso(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1));}
      else if (p === 'year') {from = t.getFullYear() + '-01-01';}
      else {from = '2020-01-01';}
      document.getElementById('daFrom').value = from;
      document.getElementById('daTo').value = to;
      _loadDa();
    }

    function _loadDa() {
      var root = document.getElementById('daRoot');
      if (root) root.innerHTML = _skel(4);
      var from = (document.getElementById('daFrom') || {}).value || '2020-01-01';
      var to = (document.getElementById('daTo') || {}).value || _today();
      var dept = (document.getElementById('daDept') || {}).value || 'all';
      var emp = (document.getElementById('daEmp') || {}).value || 'all';
      var giver = (document.getElementById('daGiver') || {}).value || 'all';
      var status = (document.getElementById('daStatus') || {}).value || 'all';
      _gasX('getDelegationAnalyticsV2', [{from: from, to: to, dept: dept, empId: emp, giverId: giver, status: status}], 45000, function (data) {
        _D.daData = data;
        _renderDa();
      }, function (e) {
        if (root) root.innerHTML =
          '<div class="te"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) +
          '<br><br><button class="btn btn-sm" onclick="_loadDa()"><i class="fas fa-rotate-right"></i> Retry</button></div>';
      });
    }

    function _renderDa() {
      var data = _D.daData;
      if (!data) {_loadDa(); return;}
      var root = document.getElementById('daRoot');
      if (!root) return;

      var view = (document.getElementById('daView') || {}).value || 'overview';
      var sort = (document.getElementById('daSort2') || {}).value || 'assigned_desc';

      var emps = (data.by_employee || []).slice().sort(function (a, b) {
        if (sort === 'rate_desc') return (b.completion_rate || 0) - (a.completion_rate || 0);
        if (sort === 'rate_asc') return (a.completion_rate || 0) - (b.completion_rate || 0);
        if (sort === 'overdue_desc') return (b.overdue || 0) - (a.overdue || 0);
        if (sort === 'name_asc') return (a.name || '').localeCompare(b.name || '');
        return (b.assigned || 0) - (a.assigned || 0);
      });

      var depts = data.by_dept || [];
      var givers = data.by_giver || [];
      var monthly = data.monthly_trend || [];
      var weekday = data.weekday_pattern || [];
      var overdue = data.overdue_tasks || [];
      var empDetail = data.employee_detail;
      var sb = data.status_breakdown || {};

      var h = '';

      h += '<div style="font-size:12px;color:var(--tx3);font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<i class="fas fa-calendar-week"></i> ' + _fmtDate(data.from) + ' &rarr; ' + _fmtDate(data.to) + ' <span style="color:var(--tx3)">(due date)</span>' +
        (data.filters && data.filters.dept !== 'all' ? ' &middot; <span style="color:var(--P)">' + _esc(data.filters.dept) + '</span>' : '') +
        (data.filters && data.filters.status !== 'all' ? ' &middot; <span style="color:var(--O)">' + _esc(data.filters.status) + '</span>' : '') +
        (empDetail ? ' &middot; <span style="color:var(--T)">' + _esc(empDetail.name) + '</span>' : '') +
        '</div>';

      var compR = data.completion_rate || 0;
      var compClr = compR >= 80 ? 'var(--G)' : compR >= 50 ? 'var(--O)' : 'var(--R)';

      h += '<div class="da-kpi-strip">' + [
        {lbl: 'Total Assigned', val: data.total_assigned || 0, c: 'var(--P)', ico: 'fa-list-check', sub: (data.employees || 0) + ' employees'},
        {lbl: 'Completed', val: data.total_completed || 0, c: 'var(--G)', ico: 'fa-circle-check', sub: 'Done'},
        {lbl: 'Pending', val: data.total_pending || 0, c: 'var(--O)', ico: 'fa-clock', sub: 'Not yet done'},
        {lbl: 'Overdue Now', val: data.total_overdue || 0, c: data.total_overdue > 0 ? 'var(--R)' : 'var(--G)', ico: 'fa-triangle-exclamation', sub: 'Past due date'},
        {lbl: 'Cancelled', val: data.total_cancelled || 0, c: 'var(--tx3)', ico: 'fa-ban', sub: 'Called off'},
        {lbl: 'Shifted', val: data.total_shifted || 0, c: 'var(--V)', ico: 'fa-arrows-rotate', sub: 'Date moved'},
        {lbl: 'Completion Rate', val: compR + '%', c: compClr, ico: 'fa-chart-pie', sub: compR >= 80 ? 'Excellent' : compR >= 50 ? 'Average' : 'Needs attention'},
        {lbl: 'On-Time', val: (data.on_time_rate || 0) + '%', c: 'var(--G)', ico: 'fa-bolt', sub: (data.on_time_done || 0) + ' tasks'},
        {lbl: 'Late', val: (data.late_rate || 0) + '%', c: 'var(--O)', ico: 'fa-hourglass-half', sub: (data.late_done || 0) + ' tasks'},
        {lbl: 'Avg Delay', val: (data.avg_lag_days || 0) + 'd', c: (data.avg_lag_days || 0) > 3 ? 'var(--R)' : 'var(--tx2)', ico: 'fa-stopwatch', sub: 'When completed late'}
      ].map(function (k) {
        return '<div class="da-kpi">' +
          '<div class="da-kpi-row1"><div class="da-kpi-ico" style="--kc:' + k.c + '"><i class="fas ' + k.ico + '"></i></div>' +
          '<div class="da-kpi-val" style="color:' + k.c + '">' + k.val + '</div></div>' +
          '<div class="da-kpi-lbl">' + k.lbl + '</div>' +
          '<div class="da-kpi-sub">' + k.sub + '</div></div>';
      }).join('') + '</div>';

      var ta = data.total_assigned || 0;
      var ovClr = compR >= 80 ? 'var(--G)' : compR >= 50 ? 'var(--O)' : 'var(--R)';
      h += '<div class="da-banner">' +
        '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
        '<div class="da-banner-ring">' +
        '<svg viewBox="0 0 36 36" class="da-ring-svg">' +
        '<circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bdr)" stroke-width="2.5"/>' +
        '<circle cx="18" cy="18" r="15.9" fill="none" stroke="' + ovClr + '" stroke-width="2.5" stroke-dasharray="' + compR + ',100" stroke-dashoffset="25" stroke-linecap="round"/>' +
        '</svg><div class="da-ring-lbl" style="color:' + ovClr + '">' + compR + '%</div></div>' +
        '<div><div style="font-size:18px;font-weight:900;color:var(--tx)">' + compR + '% Completion Rate</div>' +
        '<div style="font-size:13px;color:var(--tx2);margin-top:3px">' + (data.total_completed || 0) + ' completed of ' + ta + ' assigned &middot; ' + (data.on_time_rate || 0) + '% on-time</div></div></div>' +
        '<div style="display:flex;gap:20px;flex-wrap:wrap">' +
        [
          {lbl: 'Completed', clr: 'var(--G)', val: data.total_completed || 0},
          {lbl: 'Pending', clr: 'var(--O)', val: data.total_pending || 0},
          {lbl: 'Overdue', clr: 'var(--R)', val: data.total_overdue || 0}
        ].map(function (s) {
          return '<div style="text-align:center">' +
            '<div style="font-size:20px;font-weight:900;color:' + s.clr + '">' + s.val + '</div>' +
            '<div style="font-size:10px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px">' + s.lbl + '</div></div>';
        }).join('') +
        '</div></div>';

      if (empDetail) {
        h += '<div class="card card-nohover card-sm" style="margin-bottom:16px">' +
          '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-user" style="color:var(--P)"></i> ' + _esc(empDetail.name) + ' &mdash; Delegation Log <span style="color:var(--tx3);font-weight:600">(' + _esc(empDetail.dept) + ')</span></div>' +
          '<div class="tw"><table><thead><tr><th>Task</th><th>Giver</th><th>Due</th><th>Status</th><th>Assigned On</th></tr></thead><tbody>' +
          (empDetail.log.length ? empDetail.log.map(function (r) {
            return '<tr><td style="font-weight:700">' + _esc(r.task) + '</td>' +
              '<td>' + _esc(r.giver || '') + '</td>' +
              '<td>' + (r.due ? _fmtDateShort(r.due) : '&mdash;') + '</td>' +
              '<td>' + _statusBadge(r.status) + '</td>' +
              '<td style="color:var(--tx3);font-size:11px">' + (r.timestamp ? _fmtDateTime(r.timestamp) : '&mdash;') + '</td></tr>';
          }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--tx3);padding:16px">No delegations in this range</td></tr>') +
          '</tbody></table></div></div>';
      }

      // ══ OVERVIEW view ═════════════════════════════════════════════════════
      if (view === 'overview') {
        h += '<div class="da-grid3">';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-building" style="color:var(--P)"></i> Dept Completion %</div>' +
          '<div style="height:200px"><canvas id="daChDept"></canvas></div></div>';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-chart-pie" style="color:var(--G)"></i> Status Breakdown</div>' +
          '<div style="height:200px"><canvas id="daChStatus"></canvas></div></div>';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-bolt" style="color:var(--G)"></i> On-Time vs Late</div>' +
          '<div style="height:200px"><canvas id="daChOnTime"></canvas></div></div>';
        h += '</div>';

        var top5 = (data.by_employee || []).slice().sort(function (a, b) {return (b.completion_rate || 0) - (a.completion_rate || 0);}).slice(0, 5);
        var bot5 = (data.by_employee || []).filter(function (e) {return e.overdue > 0;}).sort(function (a, b) {return (b.overdue || 0) - (a.overdue || 0);}).slice(0, 5);
        h += '<div class="da-grid2">';
        h += '<div class="card card-nohover card-sm">' +
          '<div class="sec-title" style="margin-bottom:14px;color:var(--G)"><i class="fas fa-trophy"></i> Top Performers</div>' +
          (top5.length ? top5.map(function (e, i) {
            var m = i === 0 ? '\uD83E\uDD47' : i === 1 ? '\uD83E\uDD48' : i === 2 ? '\uD83E\uDD49' : '#' + (i + 1);
            var r = e.completion_rate || 0;
            return '<div class="da-emp-row">' +
              '<div class="da-emp-rank">' + m + '</div>' +
              '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px">' + _esc(e.name) + '</div>' +
              '<div style="font-size:10px;color:var(--tx3)">' + _esc(e.dept || '') + '</div></div>' +
              '<div style="text-align:right"><div style="font-size:15px;font-weight:900;color:var(--G)">' + r + '%</div>' +
              '<div style="font-size:10px;color:var(--tx3)">' + e.completed + '/' + e.assigned + ' tasks</div></div></div>';
          }).join('') : '<div class="te">No data</div>') + '</div>';
        h += '<div class="card card-nohover card-sm">' +
          '<div class="sec-title" style="margin-bottom:14px;color:var(--R)"><i class="fas fa-triangle-exclamation"></i> Most Overdue</div>' +
          (!bot5.length
            ? '<div style="text-align:center;padding:24px;color:var(--G)"><i class="fas fa-circle-check" style="font-size:32px;margin-bottom:8px;display:block"></i><div style="font-weight:700">Nothing overdue!</div></div>'
            : bot5.map(function (e) {
              return '<div class="da-emp-row">' +
                '<div class="da-emp-avatar" style="background:var(--Rl);color:var(--R)">' + _esc((e.name || '?').charAt(0)) + '</div>' +
                '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px">' + _esc(e.name) + '</div>' +
                '<div style="font-size:10px;color:var(--tx3)">' + _esc(e.dept || '') + '</div></div>' +
                '<div style="text-align:right"><div style="font-size:15px;font-weight:900;color:var(--R)">' + e.overdue + '</div>' +
                '<div style="font-size:10px;color:var(--tx3)">avg ' + e.avg_overdue_by + 'd late</div></div></div>';
            }).join('')
          ) + '</div>';
        h += '</div>';
      }

      // ══ EMPLOYEE view ═════════════════════════════════════════════════════
      if (view === 'employee') {
        h += '<div class="da-emp-search-bar" style="margin-top:4px">' +
          '<input type="text" id="daEmpSearch" class="ana-sel" placeholder="\uD83D\uDD0D Search employee..." oninput="_filterDaEmps()" style="width:100%;max-width:220px">' +
          '<span style="font-size:12px;color:var(--tx3)">' + emps.length + ' employees</span></div>' +
          '<div class="da-emp-cards" id="daEmpCards">' +
          emps.map(function (e) {
            var r = e.completion_rate || 0;
            var rC = r >= 80 ? 'var(--G)' : r >= 50 ? 'var(--O)' : 'var(--R)';
            return '<div class="da-emp-card' + (e.overdue > 0 ? ' da-emp-card-alert' : '') + '" style="cursor:pointer" onclick="_daDrillEmployee(\'' + _esc(e.emp_id) + '\')" title="Click to see delegation details">' +
              '<div class="da-emp-card-head">' +
              '<div class="da-emp-avatar" style="background:var(--Pl);color:var(--P)">' + _esc((e.name || '?').charAt(0).toUpperCase()) + '</div>' +
              '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(e.name) + '</div>' +
              '<div style="font-size:11px;color:var(--tx3)">' + _esc(e.dept || '') + '</div></div>' +
              '<div style="font-size:20px;font-weight:900;color:' + rC + '">' + r + '%</div></div>' +
              '<div class="da-stat-row">' +
              [
                {lbl: 'Assigned', val: e.assigned || 0, c: 'var(--P)'},
                {lbl: 'Done', val: e.completed || 0, c: 'var(--G)'},
                {lbl: 'Overdue', val: e.overdue || 0, c: e.overdue > 0 ? 'var(--R)' : 'var(--tx3)'}
              ].map(function (s) {
                return '<div class="da-stat-cell"><div style="font-size:16px;font-weight:900;color:' + s.c + '">' + s.val + '</div>' +
                  '<div style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px">' + s.lbl + '</div></div>';
              }).join('') + '</div>' +
              '<div class="pbar-wrap" style="margin:8px 0"><div class="pbar" style="width:' + r + '%;background:' + rC + '"></div></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--tx3);margin-top:6px">' +
              '<span>' + e.pending + ' pending</span>' +
              '<span><i class="fas fa-stopwatch"></i> ' + (e.avg_lag_days || 0) + 'd avg delay</span></div>' +
              '</div>';
          }).join('') + '</div>';
        if (!emps.length) h += '<div class="te" style="margin-top:16px"><i class="fas fa-search"></i> No employees match this filter</div>';
      }

      // ══ DEPT view ═════════════════════════════════════════════════════════
      if (view === 'dept') {
        h += '<div class="da-grid-dept" style="margin-top:4px">';
        depts.forEach(function (d) {
          var r = d.completion_rate || 0;
          var rC = r >= 80 ? 'var(--G)' : r >= 50 ? 'var(--O)' : 'var(--R)';
          h += '<div class="da-dept-card" style="cursor:pointer" onclick="_daDrillDept(\'' + _esc(d.dept).replace(/'/g, "\\'") + '\')" title="Click to see delegation details">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
            '<div><div style="font-weight:800;font-size:14px">' + _esc(d.dept) + '</div>' +
            '<div style="font-size:10px;color:var(--tx3)">' + (d.employees || 0) + ' employees</div></div>' +
            '<div style="font-size:20px;font-weight:900;color:' + rC + '">' + r + '%</div></div>' +
            '<div class="pbar-wrap" style="margin-bottom:10px"><div class="pbar" style="width:' + r + '%;background:' + rC + '"></div></div>' +
            '<div style="display:flex;justify-content:space-between;font-size:12px">' +
            '<span style="color:var(--tx2)"><b>' + d.assigned + '</b> assigned</span>' +
            '<span style="color:var(--G)"><b>' + d.completed + '</b> done</span>' +
            '<span style="color:' + (d.overdue > 0 ? 'var(--R)' : 'var(--tx3)') + '"><b>' + d.overdue + '</b> overdue</span>' +
            '</div></div>';
        });
        h += '</div>';
        if (!depts.length) h += '<div class="te"><i class="fas fa-building"></i> No department data in this range</div>';

        h += '<div class="da-chart-card" style="margin-top:16px">' +
          '<div class="da-chart-ttl"><i class="fas fa-building" style="color:var(--P)"></i> Department Comparison</div>' +
          '<div style="height:220px"><canvas id="daChDeptBig"></canvas></div></div>';
      }

      // ══ GIVER view (By Delegator) ═════════════════════════════════════════
      if (view === 'giver') {
        h += '<div class="card card-nohover card-sm" style="margin-top:4px">' +
          '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-user-tie" style="color:var(--P)"></i> Delegators (' + givers.length + ')</div>' +
          '<div class="tw"><table><thead><tr><th>Delegator</th>' +
          '<th style="text-align:center">Given</th><th style="text-align:center">Completed</th>' +
          '<th style="text-align:center">Pending</th><th style="text-align:center">Overdue</th><th style="text-align:center">Rate</th></tr></thead><tbody>' +
          (givers.length ? givers.map(function (g) {
            var c = g.completion_rate >= 80 ? 'var(--G)' : g.completion_rate >= 50 ? 'var(--O)' : 'var(--R)';
            return '<tr style="cursor:pointer" onclick="_daDrillGiver(\'' + _esc(g.emp_id) + '\')" title="Click to see delegation details"><td style="font-weight:700">' + _esc(g.name) + '</td>' +
              '<td style="text-align:center;font-weight:800">' + g.given + '</td>' +
              '<td style="text-align:center;color:var(--G);font-weight:700">' + g.completed + '</td>' +
              '<td style="text-align:center;color:var(--O);font-weight:700">' + g.pending + '</td>' +
              '<td style="text-align:center;color:' + (g.overdue > 0 ? 'var(--R)' : 'var(--tx3)') + ';font-weight:700">' + g.overdue + '</td>' +
              '<td style="text-align:center;font-weight:900;color:' + c + '">' + g.completion_rate + '%</td></tr>';
          }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--tx3);padding:16px">No delegators in this range</td></tr>') +
          '</tbody></table></div></div>';

        h += '<div class="da-chart-card" style="margin-top:16px">' +
          '<div class="da-chart-ttl"><i class="fas fa-user-tie" style="color:var(--V)"></i> Top Delegators by Volume</div>' +
          '<div style="height:220px"><canvas id="daChGiver"></canvas></div></div>';
      }

      // ══ TREND view (Trends & Patterns) ════════════════════════════════════
      if (view === 'trend') {
        h += '<div class="da-grid2" style="margin-top:4px">';
        h += '<div class="da-chart-card da-chart-wide-2">' +
          '<div class="da-chart-ttl"><i class="fas fa-chart-line" style="color:var(--T)"></i> Monthly Assigned vs Completed</div>' +
          '<div style="height:230px"><canvas id="daChTrend"></canvas></div></div>';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-hourglass-half" style="color:var(--O)"></i> Completion Delay Distribution</div>' +
          '<div style="height:230px"><canvas id="daChLag"></canvas></div></div>';
        h += '</div>';

        h += '<div class="da-grid2" style="margin-top:16px">';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-calendar-day" style="color:var(--P)"></i> Day-of-Week Pattern (assigned)</div>' +
          '<div style="height:220px"><canvas id="daChWeekday"></canvas></div></div>';
        h += '<div class="card card-nohover card-sm">' +
          '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-calendar-days" style="color:var(--P)"></i> Monthly Detail</div>' +
          '<div class="tw"><table><thead><tr><th>Month</th><th style="text-align:center;color:var(--I)">Assigned</th>' +
          '<th style="text-align:center;color:var(--G)">Completed</th><th style="text-align:center">Rate</th></tr></thead><tbody>' +
          (monthly.length ? monthly.slice().reverse().map(function (m) {
            var c2 = m.completion_rate >= 80 ? 'var(--G)' : m.completion_rate >= 50 ? 'var(--O)' : 'var(--R)';
            return '<tr><td style="font-weight:700">' + _esc(m.month) + '</td>' +
              '<td style="text-align:center;font-weight:800">' + m.assigned + '</td>' +
              '<td style="text-align:center;font-weight:800;color:var(--G)">' + m.completed + '</td>' +
              '<td style="text-align:center"><span style="font-weight:900;color:' + c2 + '">' + m.completion_rate + '%</span></td></tr>';
          }).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--tx3);padding:16px">No data</td></tr>') +
          '</tbody></table></div></div>';
        h += '</div>';
      }

      // ══ AGING view — Pending & Overdue (NEW) ═════════════════════════════
      if (view === 'aging') {
        var ag = data.pending_aging || {d0_3: 0, d4_7: 0, d8_14: 0, d15plus: 0};
        h += '<div class="da-grid2" style="margin-top:4px">';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-hourglass-half" style="color:var(--R)"></i> Overdue Aging Buckets</div>' +
          '<div style="height:220px"><canvas id="daChAging"></canvas></div></div>';
        h += '<div class="card card-nohover card-sm">' +
          '<div class="sec-title" style="margin-bottom:12px;color:var(--R)"><i class="fas fa-triangle-exclamation"></i> Aging Summary</div>' +
          [
            {lbl: '0-3 days overdue', val: ag.d0_3, c: 'var(--O)'},
            {lbl: '4-7 days overdue', val: ag.d4_7, c: 'var(--O)'},
            {lbl: '8-14 days overdue', val: ag.d8_14, c: 'var(--R)'},
            {lbl: '15+ days overdue', val: ag.d15plus, c: 'var(--R)'}
          ].map(function (b) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--bdr)">' +
              '<span style="font-size:13px;color:var(--tx2)">' + b.lbl + '</span>' +
              '<span style="font-size:16px;font-weight:900;color:' + b.c + '">' + b.val + '</span></div>';
          }).join('') + '</div>';
        h += '</div>';

        h += '<div class="card card-nohover card-sm" style="margin-top:16px">' +
          '<div class="sec-title" style="margin-bottom:12px;color:var(--R)"><i class="fas fa-list-ol"></i> Most Overdue Delegations (' + (data.overdue_count || 0) + ' total)</div>' +
          '<div class="tw"><table><thead><tr><th>Assignee</th><th>Dept</th><th>Task</th><th>Delegator</th>' +
          '<th style="text-align:center">Due</th><th style="text-align:center">Overdue</th></tr></thead><tbody>' +
          (overdue.length ? overdue.map(function (o) {
            var c = o.days_overdue >= 14 ? 'var(--R)' : o.days_overdue >= 7 ? 'var(--O)' : 'var(--tx2)';
            return '<tr style="cursor:pointer" onclick="_daDrillEmployee(\'' + _esc(o.emp_id) + '\')" title="Click to see this employee\'s delegations"><td style="font-weight:700">' + _esc(o.name) + '</td>' +
              '<td style="color:var(--tx2)">' + _esc(o.dept || '') + '</td>' +
              '<td>' + _esc(o.task) + '</td>' +
              '<td style="color:var(--tx3);font-size:11px">' + _esc(o.giver || '') + '</td>' +
              '<td style="text-align:center">' + _fmtDateShort(o.due) + '</td>' +
              '<td style="text-align:center;font-weight:900;color:' + c + '">' + o.days_overdue + 'd</td></tr>';
          }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--G);padding:16px"><i class="fas fa-circle-check"></i> Nothing overdue — all caught up!</td></tr>') +
          '</tbody></table></div></div>';
      }

      root.innerHTML = h;

      // ── Charts ────────────────────────────────────────────────────────────
      _whenChart(function () {
        var isDk = document.body.classList.contains('dark');
        var gc = isDk ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', tc = isDk ? '#94a3b8' : '#64748b';

        function mkC(id, type, labels, datasets, extra) {
          var cv = document.getElementById(id); if (!cv) return;
          if (cv._ci) {try {cv._ci.destroy();} catch (e) { } }
          function dm(a, b) {var r = Object.assign({}, a); Object.keys(b || {}).forEach(function (k) {r[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) ? dm(a[k] || {}, b[k]) : b[k];}); return r;}
          var isR = type === 'pie' || type === 'doughnut';
          var base = {
            responsive: true, maintainAspectRatio: false,
            plugins: {legend: {labels: {color: tc, font: {size: 11}, boxWidth: 12}}},
            scales: isR ? {} : {x: {ticks: {color: tc, font: {size: 10}}, grid: {color: gc}}, y: {ticks: {color: tc, font: {size: 10}}, grid: {color: gc}}}
          };
          cv._ci = new Chart(cv, {type: type, data: {labels: labels, datasets: datasets}, options: dm(base, extra || {})});
        }

        if (depts.length) {
          mkC('daChDept', 'bar', depts.map(function (d) {return d.dept;}),
            [{
              label: '%', data: depts.map(function (d) {return d.completion_rate || 0;}),
              backgroundColor: depts.map(function (d) {return (d.completion_rate || 0) >= 80 ? 'rgba(47,158,68,.8)' : (d.completion_rate || 0) >= 50 ? 'rgba(245,158,11,.8)' : 'rgba(220,38,38,.8)';}),
              borderRadius: 5, borderSkipped: false
            }],
            {plugins: {legend: {display: false}}, scales: {y: {min: 0, max: 100}}});
          mkC('daChDeptBig', 'bar', depts.map(function (d) {return d.dept;}),
            [{label: 'Completed', data: depts.map(function (d) {return d.completed || 0;}), backgroundColor: 'rgba(47,158,68,.8)', borderRadius: 5, borderSkipped: false},
            {label: 'Overdue', data: depts.map(function (d) {return d.overdue || 0;}), backgroundColor: 'rgba(220,38,38,.7)', borderRadius: 5, borderSkipped: false}],
            {plugins: {legend: {position: 'bottom'}}});
        }

        var sb2 = data.status_breakdown || {};
        var sbLabels = Object.keys(sb2);
        if (sbLabels.length) {
          var sColors = {Pending: 'rgba(245,158,11,.8)', Completed: 'rgba(47,158,68,.8)', Cancelled: 'rgba(148,163,184,.7)', Shifted: 'rgba(112,72,232,.8)'};
          mkC('daChStatus', 'doughnut', sbLabels, [{data: sbLabels.map(function (k) {return sb2[k];}), backgroundColor: sbLabels.map(function (k) {return sColors[k] || 'rgba(96,165,250,.8)';}), borderWidth: 0, hoverOffset: 10}],
            {cutout: '60%', plugins: {legend: {position: 'bottom'}}});
        }

        mkC('daChOnTime', 'doughnut', ['On-Time', 'Late', 'Pending'],
          [{
            data: [data.on_time_done || 0, data.late_done || 0, data.total_pending || 0],
            backgroundColor: ['rgba(47,158,68,.85)', 'rgba(245,158,11,.85)', 'rgba(148,163,184,.6)'], borderWidth: 0, hoverOffset: 10
          }],
          {cutout: '60%', plugins: {legend: {position: 'bottom'}}});

        if (givers.length) {
          var topG = givers.slice(0, 10);
          mkC('daChGiver', 'bar', topG.map(function (g) {return g.name;}),
            [{label: 'Given', data: topG.map(function (g) {return g.given;}), backgroundColor: 'rgba(112,72,232,.8)', borderRadius: 5, borderSkipped: false}],
            {plugins: {legend: {display: false}}, indexAxis: 'y'});
        }

        if (monthly.length) {
          mkC('daChTrend', 'line',
            monthly.map(function (m) {return m.month;}),
            [
              {label: 'Assigned', data: monthly.map(function (m) {return m.assigned;}), borderColor: 'rgba(14,165,233,.9)', backgroundColor: 'rgba(14,165,233,.1)', fill: true, tension: 0.4, pointRadius: 3},
              {label: 'Completed', data: monthly.map(function (m) {return m.completed;}), borderColor: 'rgba(47,158,68,.9)', backgroundColor: 'rgba(47,158,68,.1)', fill: true, tension: 0.4, pointRadius: 3}
            ],
            {scales: {y: {beginAtZero: true}}, plugins: {legend: {position: 'bottom'}}});
        }

        var ld = data.lag_distribution || {same_day: 0, day1_3: 0, day4_7: 0, day8_14: 0, day15plus: 0};
        mkC('daChLag', 'bar', ['Same day', '1-3 days', '4-7 days', '8-14 days', '15+ days'],
          [{
            label: 'Completions', data: [ld.same_day || 0, ld.day1_3 || 0, ld.day4_7 || 0, ld.day8_14 || 0, ld.day15plus || 0],
            backgroundColor: ['rgba(47,158,68,.8)', 'rgba(96,165,250,.8)', 'rgba(245,158,11,.8)', 'rgba(251,146,60,.8)', 'rgba(220,38,38,.8)'],
            borderRadius: 5, borderSkipped: false
          }],
          {plugins: {legend: {display: false}}});

        if (weekday.length) {
          mkC('daChWeekday', 'bar', weekday.map(function (w) {return w.day.substring(0, 3);}),
            [{label: 'Assigned', data: weekday.map(function (w) {return w.assigned;}), backgroundColor: 'rgba(14,165,233,.75)', borderRadius: 5, borderSkipped: false}],
            {plugins: {legend: {display: false}}});
        }

        var ag2 = data.pending_aging || {d0_3: 0, d4_7: 0, d8_14: 0, d15plus: 0};
        mkC('daChAging', 'bar', ['0-3 days', '4-7 days', '8-14 days', '15+ days'],
          [{
            label: 'Overdue tasks', data: [ag2.d0_3 || 0, ag2.d4_7 || 0, ag2.d8_14 || 0, ag2.d15plus || 0],
            backgroundColor: ['rgba(245,158,11,.7)', 'rgba(245,158,11,.9)', 'rgba(220,38,38,.75)', 'rgba(220,38,38,.95)'],
            borderRadius: 5, borderSkipped: false
          }],
          {plugins: {legend: {display: false}}});
      }, 80);
    }

    // ── Click-to-drill-down: employee / dept / giver cards ─────────────────────
    function _daDrillEmployee(empId) {
      var data = _D.daData;
      if (!data || !data.raw_log) {_toast('No detail data loaded', 'err'); return;}
      var rows = data.raw_log.filter(function (l) {return l.emp_id === empId;});
      var empName = rows.length ? rows[0].name : empId;
      var done = rows.filter(function (l) {return l.status === 'Completed';}).length;
      _showDrillModal(
        _esc(empName) + ' — Delegation Breakdown',
        rows.length + ' assigned &middot; ' + done + ' completed &middot; ' + (rows.length - done) + ' open',
        [
          {label: 'Task', key: 'task'},
          {label: 'Delegator', key: 'giver'},
          {label: 'Due', render: function (r) {return r.due ? _fmtDateShort(r.due) : '—';}},
          {label: 'Status', render: function (r) {return _statusBadge(r.status);}}
        ],
        rows.sort(function (a, b) {return (b.due || '').localeCompare(a.due || '');}),
        data.raw_log_total > data.raw_log.length ? 'Showing first ' + data.raw_log.length + ' of ' + data.raw_log_total + ' total rows in this range' : null
      );
    }

    function _daDrillDept(deptName) {
      var data = _D.daData;
      if (!data || !data.raw_log) {_toast('No detail data loaded', 'err'); return;}
      var rows = data.raw_log.filter(function (l) {return l.dept === deptName;});
      var done = rows.filter(function (l) {return l.status === 'Completed';}).length;
      _showDrillModal(
        _esc(deptName) + ' — Delegation Breakdown',
        rows.length + ' assigned &middot; ' + done + ' completed &middot; ' + (rows.length - done) + ' open',
        [
          {label: 'Employee', key: 'name'},
          {label: 'Task', key: 'task'},
          {label: 'Due', render: function (r) {return r.due ? _fmtDateShort(r.due) : '—';}},
          {label: 'Status', render: function (r) {return _statusBadge(r.status);}}
        ],
        rows.sort(function (a, b) {return (b.due || '').localeCompare(a.due || '');})
      );
    }

    function _daDrillGiver(giverId) {
      var data = _D.daData;
      if (!data || !data.raw_log) {_toast('No detail data loaded', 'err'); return;}
      var rows = data.raw_log.filter(function (l) {return l.giver_id === giverId;});
      var giverName = rows.length ? rows[0].giver : giverId;
      var done = rows.filter(function (l) {return l.status === 'Completed';}).length;
      _showDrillModal(
        _esc(giverName) + ' — Delegations Given',
        rows.length + ' given &middot; ' + done + ' completed &middot; ' + (rows.length - done) + ' open',
        [
          {label: 'Assignee', key: 'name'},
          {label: 'Task', key: 'task'},
          {label: 'Due', render: function (r) {return r.due ? _fmtDateShort(r.due) : '—';}},
          {label: 'Status', render: function (r) {return _statusBadge(r.status);}}
        ],
        rows.sort(function (a, b) {return (b.due || '').localeCompare(a.due || '');})
      );
    }

    function _filterDaEmps() {
      var q = ((document.getElementById('daEmpSearch') || {}).value || '').toLowerCase().trim();
      document.querySelectorAll('#daEmpCards .da-emp-card').forEach(function (el) {
        el.style.display = (!q || el.textContent.toLowerCase().indexOf(q) >= 0) ? '' : 'none';
      });
    }

    function _exportDaCSV() {
      var data = _D.daData;
      if (!data) {_toast('Load analytics first', 'err'); return;}
      var view = (document.getElementById('daView') || {}).value || 'overview';
      var head, rows, name;

      if (view === 'giver') {
        head = ['Delegator', 'Given', 'Completed', 'Pending', 'Overdue', 'Completion %'];
        rows = (data.by_giver || []).map(function (g) {return ['"' + (g.name || '') + '"', g.given || 0, g.completed || 0, g.pending || 0, g.overdue || 0, (g.completion_rate || 0) + '%'];});
        name = 'delegation_by_giver';
      } else if (view === 'aging') {
        head = ['Assignee', 'Department', 'Task', 'Delegator', 'Due Date', 'Days Overdue'];
        rows = (data.overdue_tasks || []).map(function (o) {return ['"' + (o.name || '') + '"', '"' + (o.dept || '') + '"', '"' + (o.task || '') + '"', '"' + (o.giver || '') + '"', o.due || '', o.days_overdue || 0];});
        name = 'delegation_overdue';
      } else if (view === 'dept') {
        head = ['Department', 'Employees', 'Assigned', 'Completed', 'Overdue', 'Completion %'];
        rows = (data.by_dept || []).map(function (d) {return ['"' + (d.dept || '') + '"', d.employees || 0, d.assigned || 0, d.completed || 0, d.overdue || 0, (d.completion_rate || 0) + '%'];});
        name = 'delegation_by_dept';
      } else {
        head = ['Employee', 'Department', 'Assigned', 'Completed', 'Pending', 'Overdue', 'Completion %', 'Avg Delay (days)'];
        rows = (data.by_employee || []).map(function (e) {return ['"' + (e.name || '') + '"', '"' + (e.dept || '') + '"', e.assigned || 0, e.completed || 0, e.pending || 0, e.overdue || 0, (e.completion_rate || 0) + '%', e.avg_lag_days || 0];});
        name = 'delegation_by_employee';
      }

      if (!rows.length) {_toast('No data to export', 'err'); return;}
      var csv = [head.join(',')].concat(rows.map(function (r) {return r.join(',');})).join('\n');
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFF' + csv);
      a.download = name + '_' + (data.from || 'all') + '_to_' + (data.to || _today()) + '.csv';
      a.click();
      _toast('Exported!', 'ok');
    }

    /* ══════════════════════════════════════════════════════════════════════
       ATTENDANCE ANALYTICS MODULE (EXTENDED)
       Manager-only. Attendance presence % by dept + daily trend + muster
       summary chart. Extends the basic _vAttAna.
    ══════════════════════════════════════════════════════════════════════ */
    // ════════════════════════════════════════════════════════════════════════
    // ATTENDANCE ANALYTICS — Standalone Manager Module
    // Full dashboard: filters, 5 charts, KPIs, employee detail
    // ════════════════════════════════════════════════════════════════════════
    function _vAttAna() {
      if (!_isManager()) {
        document.getElementById('content').innerHTML =
          '<div class="empty-state"><i class="fas fa-lock"></i><h4>Access Restricted</h4></div>';
        return;
      }
      if (!_D.empDir || !_D.empDir.length) {
        document.getElementById('content').innerHTML =
          '<div class="mod-head"><div><div class="mod-title">Attendance Analytics</div></div></div>' + _skel(4);
        _gas('getEmployeeDirectory', [], function (emps) {
          _D.empDir = emps || [];
          _vAttAnaBuild();
        }, function () {_vAttAnaBuild();});
        return;
      }
      _vAttAnaBuild();
    }

    function _vAttAnaBuild() {
      var defFrom = _currMonth() + '-01';
      var defTo = _today();
      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div><div class="mod-title">Attendance Analytics</div>' +
        '<div class="mod-sub">Presence rates, late arrivals, work hours &amp; department trends</div></div>' +
        '</div>' +

        // ── Single-row filter bar ─────────────────────────────────────────
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px;padding:12px 14px;background:var(--sur2);border-radius:12px;border:1px solid var(--bdr)">' +
        '<select id="attPreset" class="ana-sel" style="min-width:110px" onchange="_attApplyPreset()">' +
        '<option value="month">This Month</option><option value="lastmonth">Last Month</option>' +
        '<option value="quarter">This Quarter</option><option value="year">This Year</option>' +
        '<option value="custom">Custom</option></select>' +
        '<input type="date" id="attFrom" class="ana-sel" value="' + defFrom + '" style="min-width:120px" onchange="_attMarkCustom();_loadAtt()">' +
        '<span style="color:var(--tx3);font-size:11px;font-weight:700;white-space:nowrap">→</span>' +
        '<input type="date" id="attTo" class="ana-sel" value="' + defTo + '" style="min-width:120px" onchange="_attMarkCustom();_loadAtt()">' +
        '<div style="width:1px;height:26px;background:var(--bdr);flex-shrink:0"></div>' +
        '<select id="attDept" class="ana-sel" style="min-width:130px" onchange="_loadAtt()">' +
        '<option value="all">All Depts</option>' + _getDeptOptions() + '</select>' +
        _ssHtml('attEmp', '<option value="all">All Employees</option>' + _getEmpOptions(), 'All Employees', '_loadAtt') +
        '<select id="attStatus" class="ana-sel" style="min-width:100px" onchange="_loadAtt()">' +
        '<option value="all">All Status</option>' +
        '<option value="P">Present</option><option value="HD">Half Day</option>' +
        '<option value="A">Absent</option><option value="WO">Week Off</option><option value="H">Holiday</option>' +
        '</select>' +
        '<div style="width:1px;height:26px;background:var(--bdr);flex-shrink:0"></div>' +
        '<select id="attView" class="ana-sel" style="min-width:130px" onchange="_renderAtt()">' +
        '<option value="overview">Overview</option>' +
        '<option value="employee">By Employee</option>' +
        '<option value="dept">By Department</option>' +
        '<option value="trend">Trends &amp; Patterns</option>' +
        '<option value="late">Late Arrivals</option>' +
        '<option value="detail">📅 Detailed Log</option>' +
        '<option value="muster">🗂️ Muster Grid</option>' +
        '</select>' +
        '<select id="attSort" class="ana-sel" style="min-width:110px" onchange="_renderAtt()">' +
        '<option value="pct_desc">Presence % ↓</option><option value="pct_asc">Presence % ↑</option>' +
        '<option value="absent_desc">Absent ↓</option><option value="late_desc">Late ↓</option>' +
        '<option value="name_asc">Name A-Z</option></select>' +
        '<div style="flex:1;min-width:8px"></div>' +
        '<button class="btn btn-sm" onclick="_loadAtt()" style="white-space:nowrap"><i class="fas fa-chart-bar"></i> Analyze</button>' +
        '</div>' +

        '<div id="attRoot">' + _skel(4) + '</div>';

      _loadAtt();
    }

    function _attMarkCustom() {
      var p = document.getElementById('attPreset');
      if (p) p.value = 'custom';
    }

    function _attApplyPreset() {
      var p = (document.getElementById('attPreset') || {}).value || 'month';
      if (p === 'custom') return;
      var t = new Date();
      function iso(d) {return d.toISOString().slice(0, 10);}
      var from, to = iso(t);
      if (p === 'lastmonth') {
        var lm = new Date(t.getFullYear(), t.getMonth() - 1, 1);
        var lmEnd = new Date(t.getFullYear(), t.getMonth(), 0);
        from = iso(lm); to = iso(lmEnd);
      }
      else if (p === 'quarter') {from = iso(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1));}
      else if (p === 'year') {from = t.getFullYear() + '-01-01';}
      else {from = iso(t).slice(0, 8) + '01';}
      document.getElementById('attFrom').value = from;
      document.getElementById('attTo').value = to;
      _loadAtt();
    }

    // ── Muster Grid embedded in Attendance Analytics ─────────────────────────
    function _loadAttMusterInline(month, dept) {
      var root = document.getElementById('attRoot');
      if (!root) return;
      root.innerHTML = _skel(6);
      _gas('getMusterGrid', [dept || 'All', month || _currMonth()], function (res) {
        res = res || {};
        var allRows = res.rows || [], dates = res.dates || [];
        // res.holidays is an array of date strings — convert to lookup set
        var holArr = res.holidays || [];
        var hols = {};
        holArr.forEach(function (h) {hols[h] = true;});

        if (!allRows.length) {
          root.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-xmark"></i><h4>No Data</h4><p>No muster records for ' + month + '</p></div>';
          return;
        }
        _D.musterData = allRows;

        // KPI strip
        var totP = 0, totHD = 0, totA = 0, totWO = 0, totHol = 0;
        allRows.forEach(function (r) {totP += r.days_present || 0; totHD += r.days_hd || 0; totA += r.days_absent || 0; totWO += r.days_wo || 0; totHol += r.days_holiday || 0;});
        var wd = totP + totHD * 0.5 + totA, avgPct = wd > 0 ? Math.round((totP + totHD * 0.5) / wd * 100) : 0;
        var kpis = [
          {lbl: 'Employees', val: allRows.length, c: 'var(--P)', ico: 'fa-users'},
          {lbl: 'Present', val: totP, c: 'var(--G)', ico: 'fa-calendar-check'},
          {lbl: 'Half Day', val: totHD, c: 'var(--O)', ico: 'fa-clock'},
          {lbl: 'Absent', val: totA, c: 'var(--R)', ico: 'fa-calendar-times'},
          {lbl: 'Avg Presence', val: avgPct + '%', c: avgPct >= 80 ? 'var(--G)' : avgPct >= 60 ? 'var(--O)' : 'var(--R)', ico: 'fa-chart-pie'}
        ];
        var kHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
          kpis.map(function (k) {
            return '<div style="flex:1;min-width:100px;padding:10px 14px;background:var(--sur2);border:1.5px solid var(--bdr);border-radius:12px;border-left:3px solid ' + k.c + '">' +
              '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px"><i class="fas ' + k.ico + '" style="color:' + k.c + ';font-size:12px"></i><div style="font-size:10px;font-weight:700;color:var(--tx3);text-transform:uppercase">' + k.lbl + '</div></div>' +
              '<div style="font-size:18px;font-weight:900;color:' + k.c + '">' + k.val + '</div></div>';
          }).join('') + '</div>';

        // Search + export bar
        var barHtml = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
          '<input type="text" id="attMustSearch" placeholder="Search employee…" oninput="_filterMuster(this.value)" ' +
          'style="flex:1;min-width:160px;padding:6px 10px;border:1.5px solid var(--bdr);border-radius:8px;font-size:12px;background:var(--bg);color:var(--tx);outline:none">' +
          '<button class="btn btn-sm btn-outline" onclick="_exportMuster()"><i class="fas fa-download"></i> Export CSV</button>' +
          '</div>';

        // Grid table
        var colStatusMap = {P: 'var(--G)', HD: 'var(--O)', A: 'var(--R)', WO: 'var(--tx3)', H: '#7c3aed', L: '#a16207'};
        var colLblMap = {P: 'P', HD: '½', A: 'A', WO: 'W', H: 'H', L: 'L'};
        var tblHtml = '<div style="overflow-x:auto"><table class="muster-tbl" id="mstrGridTable"><thead><tr>' +
          '<th class="mst-emp">Employee</th><th class="mst-pct">%</th>' +
          dates.map(function (dt) {
            var d = new Date(dt + 'T00:00:00'); var dow = d.getDay();
            var isH = hols[dt] || false;
            var bg = isH ? '#e0e7ff' : (dow === 0 || dow === 6) ? 'var(--sur3)' : '';
            return '<th class="mst-day" style="' + (bg ? 'background:' + bg + ';' : '') + '"><div>' + ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dow] + '</div><div style="font-size:9px">' + d.getDate() + '</div></th>';
          }).join('') +
          '<th style="text-align:center;min-width:40px">P</th><th style="text-align:center;min-width:40px">A</th>' +
          '</tr></thead><tbody id="mstrBody">' +
          allRows.map(function (r) {
            var pct = r.pct || 0, pClr = pct >= 80 ? 'var(--G)' : pct >= 60 ? 'var(--O)' : 'var(--R)';
            return '<tr class="mstr-row">' +
              '<td class="mst-emp"><div style="font-weight:700;font-size:12px">' + _esc(r.emp_name || '') + '</div><div style="font-size:10px;color:var(--tx3)">' + _esc(r.dept || '') + '</div></td>' +
              '<td class="mst-pct" style="color:' + pClr + ';font-size:11px">' + pct + '%</td>' +
              dates.map(function (dt) {
                var cell = r[dt] || '';  // getMusterGrid stores status directly on row object
                var c = colStatusMap[cell] || 'var(--tx4)'; var lbl = colLblMap[cell] || '·';
                return '<td class="mst-cell" style="color:' + c + '">' + lbl + '</td>';
              }).join('') +
              '<td class="mst-cell" style="color:var(--G);font-weight:900">' + (r.days_present || 0) + '</td>' +
              '<td class="mst-cell" style="color:var(--R);font-weight:900">' + (r.days_absent || 0) + '</td>' +
              '</tr>';
          }).join('') +
          '</tbody></table></div>';

        root.innerHTML = kHtml + barHtml + tblHtml;
      }, function (e) {
        if (root) root.innerHTML = '<div class="te"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) + '</div>';
      });
    }
    function _attExportSumm() {
      var data = _D.attData;
      if (!data || !data.by_employee || !data.by_employee.length) {
        _toast('Pehle Analyze button dabao', 'warn'); return;
      }
      function q(v) {return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';}
      var head = ['Emp ID', 'Name', 'Department', 'From', 'To', 'Working Days', 'Present', 'Half Day', 'Absent', 'Week Off', 'Holiday', 'Late', 'Attendance %', 'Avg Hours/Day'];
      var rows = [head.map(q).join(',')];
      data.by_employee.forEach(function (e) {
        var wd = (e.present || 0) + (e.half_day || 0) * 0.5 + (e.absent || 0);
        var pct = e.presence_pct != null ? e.presence_pct : (wd > 0 ? Math.round(((e.present || 0) + (e.half_day || 0) * 0.5) / wd * 100) : 0);
        rows.push([
          e.emp_id || '', e.name || '', e.dept || '',
          data.from || '', data.to || '',
          wd, e.present || 0, e.half_day || 0, e.absent || 0,
          e.week_off || 0, e.holiday || 0, e.late || 0,
          pct + '%',
          e.avg_hours != null ? (Math.round((e.avg_hours || 0) * 10) / 10) + 'h' : '—'
        ].map(q).join(','));
      });
      var csv = rows.join('\n');
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
      a.download = 'attendance_summary_' + (data.from || _today()) + '_to_' + (data.to || _today()) + '.csv';
      a.click();
      _toast('Attendance summary exported — ' + data.by_employee.length + ' employees!', 'ok');
    }

    function _attExportDetail() {
      var data = _D.attData;
      if (!data) {_toast('Pehle Analyze karo', 'warn'); return;}
      // Flatten by_employee → log entries into a flat records array
      var allRecs = [];
      (data.by_employee || []).forEach(function (e) {
        (e.log || []).forEach(function (r) {
          allRecs.push({
            emp_id: e.emp_id, name: e.name, dept: e.dept,
            date: r.date, check_in: r.check_in, check_out: r.check_out,
            status: r.status, total_hours: r.total_hours,
            late_mins: r.late_mins, is_late: r.is_late,
            hours_short: r.hours_short, full_day_thresh_hrs: r.full_day_thresh_hrs
          });
        });
      });
      if (!allRecs.length) {_toast('No detail records found — check filters', 'warn'); return;}
      function q(v) {return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';}
      var DAY_N = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      var head = ['Emp ID', 'Name', 'Department', 'Date', 'Day', 'Status', 'IN Time', 'OUT Time', 'Hours Worked', 'Hours Short', 'Late (mins)'];
      var rows = [head.map(q).join(',')];
      allRecs.sort(function (a, b) {return (a.date || '').localeCompare(b.date || '') || (a.name || '').localeCompare(b.name || '');});
      allRecs.forEach(function (r) {
        var dow = DAY_N[new Date((r.date || '2000-01-01') + 'T00:00:00').getDay()];
        var stLabel = r.status === 'P' ? 'Present' : r.status === 'HD' ? 'Half Day' : r.status === 'A' ? 'Absent' : r.status === 'WO' ? 'Week Off' : r.status === 'H' ? 'Holiday' : r.status || '';
        rows.push([
          r.emp_id || '', r.name || '', r.dept || '',
          r.date || '', dow, stLabel,
          r.check_in || '—', r.check_out || '—',
          r.total_hours || '—',
          r.hours_short ? (Math.round(r.hours_short * 100) / 100) + 'h' : '—',
          r.late_mins != null ? r.late_mins : '—'
        ].map(q).join(','));
      });
      var csv = rows.join('\n');
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
      a.download = 'attendance_detail_' + _today() + '.csv';
      a.click();
      _toast('Full detail exported — ' + allRecs.length + ' records!', 'ok');
    }

    function _loadAtt() {
      var root = document.getElementById('attRoot');
      if (root) root.innerHTML = _skel(4);
      var from = (document.getElementById('attFrom') || {}).value || (_currMonth() + '-01');
      var to = (document.getElementById('attTo') || {}).value || _today();
      var dept = (document.getElementById('attDept') || {}).value || 'all';
      var emp = _ssVal('attEmp') || 'all';
      var status = (document.getElementById('attStatus') || {}).value || 'all';
      var view = (document.getElementById('attView') || {}).value || 'overview';

      // Detailed Log view — load attendance records directly, not analytics summary
      if (view === 'detail') {
        _loadAttDetailedLog(from, to, dept, emp, status);
        return;
      }

      // Muster Grid view — use getMusterGrid (needs month, not from/to)
      if (view === 'muster') {
        var musterMonth = from.substring(0, 7); // yyyy-MM
        _loadAttMusterInline(musterMonth, dept === 'all' ? 'All' : dept);
        return;
      }

      _gasX('getAttendanceAnalyticsV2', [{from: from, to: to, dept: dept, empId: emp, status: status}], 45000, function (data) {
        _D.attData = data;
        _renderAtt();
      }, function (e) {
        if (root) root.innerHTML =
          '<div class="te"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) +
          '<br><br><button class="btn btn-sm" onclick="_loadAtt()"><i class="fas fa-rotate-right"></i> Retry</button></div>';
      });
    }

    function _renderAtt() {
      var data = _D.attData;
      if (!data) {_loadAtt(); return;}
      var root = document.getElementById('attRoot');
      if (!root) return;

      var view = (document.getElementById('attView') || {}).value || 'overview';
      if (view === 'detail') {_loadAtt(); return;} // re-route

      var sort = (document.getElementById('attSort') || {}).value || 'pct_desc';

      var emps = (data.by_employee || []).slice().sort(function (a, b) {
        if (sort === 'pct_desc') return (b.presence_pct || 0) - (a.presence_pct || 0);
        if (sort === 'pct_asc') return (a.presence_pct || 0) - (b.presence_pct || 0);
        if (sort === 'absent_desc') return (b.absent || 0) - (a.absent || 0);
        if (sort === 'late_desc') return (b.late || 0) - (a.late || 0);
        if (sort === 'name_asc') return (a.name || '').localeCompare(b.name || '');
        return (b.presence_pct || 0) - (a.presence_pct || 0);
      });

      var depts = data.by_dept || [];
      var trend = data.daily_trend || [];
      var weekday = data.weekday_pattern || [];
      var empDetail = data.employee_detail;
      var sb = data.status_breakdown || {};

      var h = '';

      h += '<div style="font-size:12px;color:var(--tx3);font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<i class="fas fa-calendar-week"></i> ' + _fmtDate(data.from) + ' &rarr; ' + _fmtDate(data.to) +
        (data.filters && data.filters.dept !== 'all' ? ' &middot; <span style="color:var(--P)">' + _esc(data.filters.dept) + '</span>' : '') +
        (empDetail ? ' &middot; <span style="color:var(--T)">' + _esc(empDetail.name) + '</span>' : '') +
        '</div>';

      var presR = data.presence_pct || 0;
      var presClr = presR >= 90 ? 'var(--G)' : presR >= 75 ? 'var(--O)' : 'var(--R)';

      h += '<div class="da-kpi-strip">' + [
        {lbl: 'Employees', val: data.employees || 0, c: 'var(--P)', ico: 'fa-users', sub: (data.total_working_days || 0) + ' working days'},
        {lbl: 'Present', val: data.total_present || 0, c: 'var(--G)', ico: 'fa-circle-check', sub: 'Full day'},
        {lbl: 'Half Day', val: data.total_half_day || 0, c: 'var(--O)', ico: 'fa-adjust', sub: 'Partial'},
        {lbl: 'Absent', val: data.total_absent || 0, c: data.total_absent > 0 ? 'var(--R)' : 'var(--G)', ico: 'fa-circle-xmark', sub: 'Not present'},
        {lbl: 'Week Off', val: data.total_week_off || 0, c: 'var(--tx3)', ico: 'fa-bed', sub: 'Off days'},
        {lbl: 'Holidays', val: data.total_holiday || 0, c: '#4338ca', ico: 'fa-umbrella-beach', sub: 'Holiday days'},
        {lbl: 'Presence Rate', val: presR + '%', c: presClr, ico: 'fa-chart-pie', sub: presR >= 90 ? 'Excellent' : presR >= 75 ? 'Average' : 'Needs attention'},
        {lbl: 'Late Arrivals', val: data.total_late || 0, c: data.total_late > 0 ? 'var(--O)' : 'var(--G)', ico: 'fa-clock', sub: 'Past start time'},
        {lbl: 'Avg Work Hours', val: (data.avg_hours || 0) + 'h', c: 'var(--V)', ico: 'fa-hourglass-half', sub: 'Per present day'}
      ].map(function (k) {
        return '<div class="da-kpi">' +
          '<div class="da-kpi-row1"><div class="da-kpi-ico" style="--kc:' + k.c + '"><i class="fas ' + k.ico + '"></i></div>' +
          '<div class="da-kpi-val" style="color:' + k.c + '">' + k.val + '</div></div>' +
          '<div class="da-kpi-lbl">' + k.lbl + '</div>' +
          '<div class="da-kpi-sub">' + k.sub + '</div></div>';
      }).join('') + '</div>';

      var ovClr = presR >= 90 ? 'var(--G)' : presR >= 75 ? 'var(--O)' : 'var(--R)';
      h += '<div class="da-banner">' +
        '<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
        '<div class="da-banner-ring">' +
        '<svg viewBox="0 0 36 36" class="da-ring-svg">' +
        '<circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bdr)" stroke-width="2.5"/>' +
        '<circle cx="18" cy="18" r="15.9" fill="none" stroke="' + ovClr + '" stroke-width="2.5" stroke-dasharray="' + presR + ',100" stroke-dashoffset="25" stroke-linecap="round"/>' +
        '</svg><div class="da-ring-lbl" style="color:' + ovClr + '">' + presR + '%</div></div>' +
        '<div><div style="font-size:18px;font-weight:900;color:var(--tx)">' + presR + '% Presence Rate</div>' +
        '<div style="font-size:13px;color:var(--tx2);margin-top:3px">' + (data.total_present || 0) + ' present of ' + (data.total_working_days || 0) + ' working days &middot; ' + (data.total_late || 0) + ' late arrivals</div></div></div>' +
        '<div style="display:flex;gap:20px;flex-wrap:wrap">' +
        [
          {lbl: 'Present', clr: 'var(--G)', val: data.total_present || 0},
          {lbl: 'Absent', clr: 'var(--R)', val: data.total_absent || 0},
          {lbl: 'Late', clr: 'var(--O)', val: data.total_late || 0}
        ].map(function (s) {
          return '<div style="text-align:center">' +
            '<div style="font-size:20px;font-weight:900;color:' + s.clr + '">' + s.val + '</div>' +
            '<div style="font-size:10px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px">' + s.lbl + '</div></div>';
        }).join('') +
        '</div></div>';

      if (empDetail) {
        h += '<div class="card card-nohover card-sm" style="margin-bottom:16px">' +
          '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-user" style="color:var(--P)"></i> ' + _esc(empDetail.name) + ' &mdash; Daily Log <span style="color:var(--tx3);font-weight:600">(' + _esc(empDetail.dept) + ')</span></div>' +
          '<div class="tw"><table><thead><tr><th>Date</th><th>Status</th><th>Punctuality</th>' +
          '<th style="color:var(--P)"><i class="fas fa-calendar-clock"></i> Plan IN</th>' +
          '<th style="color:var(--G)"><i class="fas fa-check-circle"></i> Actual OUT</th>' +
          '<th>Hours</th></tr></thead><tbody>' +
          (empDetail.log.length ? empDetail.log.map(function (r) {
            // Sanitise office_in_used — when served from cache, _extractTimeStr
            // may not have run (the value arrives as an ISO string). Strip it
            // down to HH:mm here as a guaranteed-safe fallback on the frontend.
            var officeInDisplay = r.office_in_used || '';
            if (officeInDisplay.indexOf('T') > 0) {
              var mOff = officeInDisplay.match(/T(\d{2}):(\d{2})/);
              if (mOff) {
                // UTC offset +5:30 adjustment for IST (best effort on frontend)
                var utcH = parseInt(mOff[1], 10), utcM = parseInt(mOff[2], 10);
                var istM = utcH * 60 + utcM + 330;
                istM = istM % (24 * 60);
                officeInDisplay = Math.floor(istM / 60) + ':' + (istM % 60 < 10 ? '0' : '') + (istM % 60);
              }
            }
            var punct = _lateBadge(r.is_late, r.status, officeInDisplay);
            var parsedHrsStr = (r.parsed_hours != null && !isNaN(r.parsed_hours)) ? (Math.round(r.parsed_hours * 10) / 10) + 'h' : '';
            var threshStr = (r.full_day_thresh_hrs != null && !isNaN(r.full_day_thresh_hrs)) ? (Math.round(r.full_day_thresh_hrs * 10) / 10) + 'h needed' : '';
            var hdDiag = (parsedHrsStr && threshStr) ? '<div style="font-size:9px;color:var(--tx3);margin-top:2px">' + parsedHrsStr + ' vs ' + threshStr + '</div>' : '';
            var ciDisplay = (!r.check_in || r.check_in === '-') ? '—' : r.check_in;
            var coDisplay = (!r.check_out || r.check_out === '-') ? '—' : r.check_out;
            return '<tr><td style="font-weight:700">' + _fmtDateShort(r.date) + '</td>' +
              '<td>' + _statusBadge(r.status) + '</td>' +
              '<td>' + (punct
                ? punct + (officeInDisplay ? '<div style="font-size:9px;color:var(--tx3);margin-top:2px">Office IN: ' + _esc(officeInDisplay) + '</div>' : '')
                : '<span style="color:var(--tx3)">—</span>') + '</td>' +
              '<td style="font-weight:700;color:var(--G)">' + _esc(ciDisplay) + '</td>' +
              '<td style="font-weight:700;color:var(--R)">' + _esc(coDisplay) + '</td>' +
              '<td style="color:var(--P);font-weight:700">' + _cleanHours(r.total_hours) + hdDiag + '</td></tr>';
          }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--tx3);padding:16px">No attendance records in this range</td></tr>') +
          '</tbody></table></div></div>';
      }

      // ══ OVERVIEW view ═════════════════════════════════════════════════════
      if (view === 'overview') {
        h += '<div class="da-grid3">';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-building" style="color:var(--P)"></i> Dept Presence %</div>' +
          '<div style="height:200px"><canvas id="attChDept"></canvas></div></div>';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-chart-pie" style="color:var(--G)"></i> Status Breakdown</div>' +
          '<div style="height:200px"><canvas id="attChStatus"></canvas></div></div>';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-chart-line" style="color:var(--T)"></i> Daily Presence Trend</div>' +
          '<div style="height:200px"><canvas id="attChTrendMini"></canvas></div></div>';
        h += '</div>';

        var top5 = (data.by_employee || []).slice().sort(function (a, b) {return (b.presence_pct || 0) - (a.presence_pct || 0);}).slice(0, 5);
        var bot5 = (data.by_employee || []).filter(function (e) {return e.absent > 0 || e.late > 0;}).sort(function (a, b) {return (b.absent || 0) - (a.absent || 0) || (b.late || 0) - (a.late || 0);}).slice(0, 5);
        h += '<div class="da-grid2">';
        h += '<div class="card card-nohover card-sm">' +
          '<div class="sec-title" style="margin-bottom:14px;color:var(--G)"><i class="fas fa-trophy"></i> Best Attendance</div>' +
          (top5.length ? top5.map(function (e, i) {
            var m = i === 0 ? '\uD83E\uDD47' : i === 1 ? '\uD83E\uDD48' : i === 2 ? '\uD83E\uDD49' : '#' + (i + 1);
            return '<div class="da-emp-row" style="cursor:pointer" onclick="_attDrillEmployee(\'' + _esc(e.emp_id) + '\')">' +
              '<div class="da-emp-rank">' + m + '</div>' +
              '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px">' + _esc(e.name) + '</div>' +
              '<div style="font-size:10px;color:var(--tx3)">' + _esc(e.dept || '') + '</div></div>' +
              '<div style="text-align:right"><div style="font-size:15px;font-weight:900;color:var(--G)">' + e.presence_pct + '%</div>' +
              '<div style="font-size:10px;color:var(--tx3)">' + e.present + '/' + e.working_days + ' days</div></div></div>';
          }).join('') : '<div class="te">No data</div>') + '</div>';
        h += '<div class="card card-nohover card-sm">' +
          '<div class="sec-title" style="margin-bottom:14px;color:var(--R)"><i class="fas fa-triangle-exclamation"></i> Needs Attention</div>' +
          (!bot5.length
            ? '<div style="text-align:center;padding:24px;color:var(--G)"><i class="fas fa-circle-check" style="font-size:32px;margin-bottom:8px;display:block"></i><div style="font-weight:700">No absences or late arrivals!</div></div>'
            : bot5.map(function (e) {
              return '<div class="da-emp-row" style="cursor:pointer" onclick="_attDrillEmployee(\'' + _esc(e.emp_id) + '\')">' +
                '<div class="da-emp-avatar" style="background:var(--Rl);color:var(--R)">' + _esc((e.name || '?').charAt(0)) + '</div>' +
                '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:13px">' + _esc(e.name) + '</div>' +
                '<div style="font-size:10px;color:var(--tx3)">' + _esc(e.dept || '') + '</div></div>' +
                '<div style="text-align:right"><div style="font-size:15px;font-weight:900;color:var(--R)">' + e.absent + ' absent</div>' +
                '<div style="font-size:10px;color:var(--O)">' + e.late + ' late</div></div></div>';
            }).join('')
          ) + '</div>';
        h += '</div>';
      }

      // ══ EMPLOYEE view ═════════════════════════════════════════════════════
      if (view === 'employee') {
        h += '<div class="da-emp-search-bar" style="margin-top:4px">' +
          '<input type="text" id="attEmpSearch" class="ana-sel" placeholder="\uD83D\uDD0D Search employee..." oninput="_filterAttEmps()" style="width:100%;max-width:220px">' +
          '<span style="font-size:12px;color:var(--tx3)">' + emps.length + ' employees</span></div>' +
          '<div class="da-emp-cards" id="attEmpCards">' +
          emps.map(function (e) {
            var r = e.presence_pct || 0;
            var rC = r >= 90 ? 'var(--G)' : r >= 75 ? 'var(--O)' : 'var(--R)';
            return '<div class="da-emp-card' + (e.absent > 2 ? ' da-emp-card-alert' : '') + '" style="cursor:pointer" onclick="_attDrillEmployee(\'' + _esc(e.emp_id) + '\')" title="Click to see daily log">' +
              '<div class="da-emp-card-head">' +
              '<div class="da-emp-avatar" style="background:var(--Pl);color:var(--P)">' + _esc((e.name || '?').charAt(0).toUpperCase()) + '</div>' +
              '<div style="flex:1;min-width:0"><div style="font-weight:800;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + _esc(e.name) + '</div>' +
              '<div style="font-size:11px;color:var(--tx3)">' + _esc(e.dept || '') + '</div></div>' +
              '<div style="font-size:20px;font-weight:900;color:' + rC + '">' + r + '%</div></div>' +
              '<div class="da-stat-row">' +
              [
                {lbl: 'Present', val: e.present || 0, c: 'var(--G)'},
                {lbl: 'Absent', val: e.absent || 0, c: e.absent > 0 ? 'var(--R)' : 'var(--tx3)'},
                {lbl: 'Late', val: e.late || 0, c: e.late > 0 ? 'var(--O)' : 'var(--tx3)'}
              ].map(function (s) {
                return '<div class="da-stat-cell"><div style="font-size:16px;font-weight:900;color:' + s.c + '">' + s.val + '</div>' +
                  '<div style="font-size:9px;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px">' + s.lbl + '</div></div>';
              }).join('') + '</div>' +
              '<div class="pbar-wrap" style="margin:8px 0"><div class="pbar" style="width:' + r + '%;background:' + rC + '"></div></div>' +
              '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--tx3);margin-top:6px">' +
              '<span>' + e.half_day + ' half-day</span>' +
              '<span><i class="fas fa-hourglass-half"></i> ' + (e.avg_hours || 0) + 'h avg</span></div>' +
              '</div>';
          }).join('') + '</div>';
        if (!emps.length) h += '<div class="te" style="margin-top:16px"><i class="fas fa-search"></i> No employees match this filter</div>';
      }

      // ══ DEPT view ═════════════════════════════════════════════════════════
      if (view === 'dept') {
        h += '<div class="da-grid-dept" style="margin-top:4px">';
        depts.forEach(function (d) {
          var r = d.presence_pct || 0;
          var rC = r >= 90 ? 'var(--G)' : r >= 75 ? 'var(--O)' : 'var(--R)';
          h += '<div class="da-dept-card" style="cursor:pointer" onclick="_attDrillDept(\'' + _esc(d.dept).replace(/'/g, "\\'") + '\')" title="Click to see employee details">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
            '<div><div style="font-weight:800;font-size:14px">' + _esc(d.dept) + '</div>' +
            '<div style="font-size:10px;color:var(--tx3)">' + (d.employees || 0) + ' employees</div></div>' +
            '<div style="font-size:20px;font-weight:900;color:' + rC + '">' + r + '%</div></div>' +
            '<div class="pbar-wrap" style="margin-bottom:10px"><div class="pbar" style="width:' + r + '%;background:' + rC + '"></div></div>' +
            '<div style="display:flex;justify-content:space-between;font-size:12px">' +
            '<span style="color:var(--G)"><b>' + d.present + '</b> present</span>' +
            '<span style="color:var(--O)"><b>' + d.half_day + '</b> half-day</span>' +
            '<span style="color:' + (d.absent > 0 ? 'var(--R)' : 'var(--tx3)') + '"><b>' + d.absent + '</b> absent</span>' +
            '</div></div>';
        });
        h += '</div>';
        if (!depts.length) h += '<div class="te"><i class="fas fa-building"></i> No department data in this range</div>';

        h += '<div class="da-chart-card" style="margin-top:16px">' +
          '<div class="da-chart-ttl"><i class="fas fa-building" style="color:var(--P)"></i> Department Comparison</div>' +
          '<div style="height:220px"><canvas id="attChDeptBig"></canvas></div></div>';
      }

      // ══ TREND view (Trends & Patterns) ════════════════════════════════════
      if (view === 'trend') {
        h += '<div class="da-grid2" style="margin-top:4px">';
        h += '<div class="da-chart-card da-chart-wide-2">' +
          '<div class="da-chart-ttl"><i class="fas fa-chart-line" style="color:var(--T)"></i> Daily Presence % Trend</div>' +
          '<div style="height:230px"><canvas id="attChTrend"></canvas></div></div>';
        h += '<div class="da-chart-card">' +
          '<div class="da-chart-ttl"><i class="fas fa-calendar-day" style="color:var(--P)"></i> Day-of-Week Absence %</div>' +
          '<div style="height:230px"><canvas id="attChWeekday"></canvas></div></div>';
        h += '</div>';

        h += '<div class="card card-nohover card-sm" style="margin-top:16px">' +
          '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-calendar-days" style="color:var(--P)"></i> Daily Detail (last 30)</div>' +
          '<div class="tw"><table><thead><tr><th>Date</th><th style="text-align:center;color:var(--G)">Present</th>' +
          '<th style="text-align:center;color:var(--O)">Half Day</th><th style="text-align:center;color:var(--R)">Absent</th><th style="text-align:center">Presence %</th></tr></thead><tbody>' +
          (trend.length ? trend.slice(-30).reverse().map(function (t) {
            var c2 = t.presence_pct >= 90 ? 'var(--G)' : t.presence_pct >= 75 ? 'var(--O)' : 'var(--R)';
            return '<tr><td style="font-weight:700">' + _fmtDate(t.date) + '</td>' +
              '<td style="text-align:center;font-weight:800;color:var(--G)">' + t.present + '</td>' +
              '<td style="text-align:center;font-weight:800;color:var(--O)">' + t.half_day + '</td>' +
              '<td style="text-align:center;font-weight:800;color:var(--R)">' + t.absent + '</td>' +
              '<td style="text-align:center"><span style="font-weight:900;color:' + c2 + '">' + t.presence_pct + '%</span></td></tr>';
          }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--tx3);padding:16px">No data</td></tr>') +
          '</tbody></table></div></div>';
      }

      // ══ LATE view — Late Arrivals (NEW) ═══════════════════════════════════
      if (view === 'late') {
        var lateEmps = (data.by_employee || []).filter(function (e) {return e.late > 0;}).sort(function (a, b) {return b.late - a.late;});
        h += '<div class="card card-nohover card-sm" style="margin-top:4px">' +
          '<div class="sec-title" style="margin-bottom:12px;color:var(--O)"><i class="fas fa-clock"></i> Late Arrivals by Employee (' + (data.total_late || 0) + ' total instances)</div>' +
          '<div class="tw"><table><thead><tr><th>Employee</th><th>Dept</th>' +
          '<th style="text-align:center">Late Count</th><th style="text-align:center">Working Days</th><th style="text-align:center">Late %</th></tr></thead><tbody>' +
          (lateEmps.length ? lateEmps.map(function (e) {
            var latePct = e.working_days > 0 ? Math.round(e.late / e.working_days * 100) : 0;
            var c = latePct >= 30 ? 'var(--R)' : latePct >= 15 ? 'var(--O)' : 'var(--tx2)';
            return '<tr style="cursor:pointer" onclick="_attDrillEmployee(\'' + _esc(e.emp_id) + '\')" title="Click to see daily log"><td style="font-weight:700">' + _esc(e.name) + '</td>' +
              '<td style="color:var(--tx2)">' + _esc(e.dept || '') + '</td>' +
              '<td style="text-align:center;font-weight:900;color:' + c + '">' + e.late + '</td>' +
              '<td style="text-align:center">' + e.working_days + '</td>' +
              '<td style="text-align:center;font-weight:800;color:' + c + '">' + latePct + '%</td></tr>';
          }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--G);padding:16px"><i class="fas fa-circle-check"></i> No late arrivals in this range!</td></tr>') +
          '</tbody></table></div></div>';
      }

      root.innerHTML = h;

      // ── Charts ────────────────────────────────────────────────────────────
      _whenChart(function () {
        var isDk = document.body.classList.contains('dark');
        var gc = isDk ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', tc = isDk ? '#94a3b8' : '#64748b';

        function mkC(id, type, labels, datasets, extra) {
          var cv = document.getElementById(id); if (!cv) return;
          if (cv._ci) {try {cv._ci.destroy();} catch (e) { } }
          function dm(a, b) {var r = Object.assign({}, a); Object.keys(b || {}).forEach(function (k) {r[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) ? dm(a[k] || {}, b[k]) : b[k];}); return r;}
          var isR = type === 'pie' || type === 'doughnut';
          var base = {
            responsive: true, maintainAspectRatio: false,
            plugins: {legend: {labels: {color: tc, font: {size: 11}, boxWidth: 12}}},
            scales: isR ? {} : {x: {ticks: {color: tc, font: {size: 10}}, grid: {color: gc}}, y: {ticks: {color: tc, font: {size: 10}}, grid: {color: gc}}}
          };
          cv._ci = new Chart(cv, {type: type, data: {labels: labels, datasets: datasets}, options: dm(base, extra || {})});
        }

        if (depts.length) {
          mkC('attChDept', 'bar', depts.map(function (d) {return d.dept;}),
            [{
              label: '%', data: depts.map(function (d) {return d.presence_pct || 0;}),
              backgroundColor: depts.map(function (d) {return (d.presence_pct || 0) >= 90 ? 'rgba(47,158,68,.8)' : (d.presence_pct || 0) >= 75 ? 'rgba(245,158,11,.8)' : 'rgba(220,38,38,.8)';}),
              borderRadius: 5, borderSkipped: false
            }],
            {plugins: {legend: {display: false}}, scales: {y: {min: 0, max: 100}}});
          mkC('attChDeptBig', 'bar', depts.map(function (d) {return d.dept;}),
            [{label: 'Present', data: depts.map(function (d) {return d.present || 0;}), backgroundColor: 'rgba(47,158,68,.8)', borderRadius: 5, borderSkipped: false},
            {label: 'Absent', data: depts.map(function (d) {return d.absent || 0;}), backgroundColor: 'rgba(220,38,38,.7)', borderRadius: 5, borderSkipped: false}],
            {plugins: {legend: {position: 'bottom'}}});
        }

        var sb2 = data.status_breakdown || {};
        var sLabelMap = {P: 'Present', HD: 'Half Day', A: 'Absent', WO: 'Week Off', H: 'Holiday'};
        var sbKeys = Object.keys(sb2);
        if (sbKeys.length) {
          var sColors = {P: 'rgba(47,158,68,.8)', HD: 'rgba(245,158,11,.8)', A: 'rgba(220,38,38,.8)', WO: 'rgba(148,163,184,.7)', H: 'rgba(67,56,202,.8)'};
          mkC('attChStatus', 'doughnut', sbKeys.map(function (k) {return sLabelMap[k] || k;}),
            [{data: sbKeys.map(function (k) {return sb2[k];}), backgroundColor: sbKeys.map(function (k) {return sColors[k] || 'rgba(96,165,250,.8)';}), borderWidth: 0, hoverOffset: 10}],
            {cutout: '60%', plugins: {legend: {position: 'bottom'}}});
        }

        if (trend.length) {
          mkC('attChTrendMini', 'line', trend.map(function (t) {var p = t.date.split('-'); return p[2] + '/' + p[1];}),
            [{label: 'Presence %', data: trend.map(function (t) {return t.presence_pct;}), borderColor: 'rgba(47,158,68,.9)', backgroundColor: 'rgba(47,158,68,.1)', fill: true, tension: 0.4, pointRadius: 1}],
            {scales: {y: {min: 0, max: 100}}, plugins: {legend: {display: false}}});
          mkC('attChTrend', 'line', trend.map(function (t) {var p = t.date.split('-'); return p[2] + '/' + p[1];}),
            [{label: 'Presence %', data: trend.map(function (t) {return t.presence_pct;}), borderColor: 'rgba(47,158,68,.9)', backgroundColor: 'rgba(47,158,68,.1)', fill: true, tension: 0.4, pointRadius: 2}],
            {scales: {y: {min: 0, max: 100}}, plugins: {legend: {display: false}}});
        }

        if (weekday.length) {
          mkC('attChWeekday', 'bar', weekday.map(function (w) {return w.day.substring(0, 3);}),
            [{
              label: 'Absence %', data: weekday.map(function (w) {return w.absence_pct || 0;}),
              backgroundColor: weekday.map(function (w) {return (w.absence_pct || 0) >= 15 ? 'rgba(220,38,38,.8)' : (w.absence_pct || 0) >= 5 ? 'rgba(245,158,11,.8)' : 'rgba(47,158,68,.8)';}),
              borderRadius: 5, borderSkipped: false
            }],
            {plugins: {legend: {display: false}}});
        }
      }, 80);
    }

    // ── Click-to-drill-down: employee / dept cards ─────────────────────────────
    function _attDrillEmployee(empId) {
      var data = _D.attData;
      if (!data || !data.raw_log) {_toast('No detail data loaded', 'err'); return;}
      var rows = data.raw_log.filter(function (l) {return l.emp_id === empId;});
      var empName = rows.length ? rows[0].name : empId;
      var present = rows.filter(function (l) {return l.status === 'P';}).length;
      var absent = rows.filter(function (l) {return l.status === 'A';}).length;
      _showDrillModal(
        _esc(empName) + ' — Attendance Log',
        rows.length + ' records &middot; ' + present + ' present &middot; ' + absent + ' absent (' + _fmtDate(data.from) + ' &rarr; ' + _fmtDate(data.to) + ')',
        [
          {label: 'Date', render: function (r) {return _fmtDateShort(r.date);}},
          {label: 'Status', render: function (r) {return _statusBadge(r.status);}},
          {label: 'Punctuality', render: function (r) {return _lateBadge(r.is_late, r.status, r.office_in_used) || '<span style="color:var(--tx3)">—</span>';}},
          {label: 'Check In', key: 'check_in'},
          {label: 'Check Out', key: 'check_out'},
          {label: 'Hours', key: 'total_hours'}
        ],
        rows.sort(function (a, b) {return (b.date || '').localeCompare(a.date || '');}),
        data.raw_log_total > data.raw_log.length ? 'Showing first ' + data.raw_log.length + ' of ' + data.raw_log_total + ' total rows in this range' : null
      );
    }

    function _attDrillDept(deptName) {
      var data = _D.attData;
      if (!data || !data.raw_log) {_toast('No detail data loaded', 'err'); return;}
      var rows = data.raw_log.filter(function (l) {return l.dept === deptName;});
      var present = rows.filter(function (l) {return l.status === 'P';}).length;
      var absent = rows.filter(function (l) {return l.status === 'A';}).length;
      _showDrillModal(
        _esc(deptName) + ' — Attendance Breakdown',
        rows.length + ' records &middot; ' + present + ' present &middot; ' + absent + ' absent',
        [
          {label: 'Employee', key: 'name'},
          {label: 'Date', render: function (r) {return _fmtDateShort(r.date);}},
          {label: 'Status', render: function (r) {return _statusBadge(r.status);}},
          {label: 'Punctuality', render: function (r) {return _lateBadge(r.is_late, r.status, r.office_in_used) || '<span style="color:var(--tx3)">—</span>';}},
          {label: 'Check In', key: 'check_in'}
        ],
        rows.sort(function (a, b) {return (b.date || '').localeCompare(a.date || '');})
      );
    }

    function _filterAttEmps() {
      var q = ((document.getElementById('attEmpSearch') || {}).value || '').toLowerCase().trim();
      document.querySelectorAll('#attEmpCards .da-emp-card').forEach(function (el) {
        el.style.display = (!q || el.textContent.toLowerCase().indexOf(q) >= 0) ? '' : 'none';
      });
    }

    /* ══════════════════════════════════════════════════════════
       ATTENDANCE DETAILED LOG (in Attendance Analytics)
       Month → Date grouping. Each date shows all staff present
       with their Check IN / Check OUT / Hours / Status.
       Managers can see the full team picture per day.
    ══════════════════════════════════════════════════════════ */
    var _adlData = [];
    var _adlSort = {key: 'date', dir: 1};

    function _loadAttDetailedLog(from, to, dept, emp, status) {
      var root = document.getElementById('attRoot');
      if (!root) return;
      root.innerHTML = _skel(4);
      _gasX('getAttendanceAnalyticsV2',
        [{from: from, to: to, dept: dept, empId: emp, status: status}], 45000,
        function (data) {
          if (!root) return;
          var allRows = [];
          (data.by_employee || []).forEach(function (e) {
            (e.log || []).forEach(function (r) {
              allRows.push({
                emp_id: e.emp_id, name: e.name, dept: e.dept,
                date: r.date, check_in: r.check_in, check_out: r.check_out,
                total_hours: r.total_hours, status: r.status,
                is_late: r.is_late, parsed_hours: r.parsed_hours
              });
            });
          });
          if (!allRows.length) {
            root.innerHTML = '<div class="empty-state" style="padding:40px;text-align:center">' +
              '<i class="fas fa-calendar-xmark" style="font-size:40px;opacity:.15;color:var(--P)"></i>' +
              '<div style="margin-top:12px;font-size:14px;color:var(--tx3);font-weight:600">No attendance records found</div>' +
              '<div style="font-size:12px;color:var(--tx3);margin-top:4px">Adjust the date range or filters and click Analyze</div></div>';
            return;
          }
          _adlData = allRows;
          _adlSort = {key: 'date', dir: 1};
          _renderAdl(root, allRows);
        },
        function (e) {
          if (root) root.innerHTML = '<div class="te"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) +
            '<br><br><button class="btn btn-sm" onclick="_loadAtt()"><i class="fas fa-rotate-right"></i> Retry</button></div>';
        }
      );
    }

    function _adlSortBy(key) {
      if (_adlSort.key === key) {_adlSort.dir *= -1;}
      else {_adlSort.key = key; _adlSort.dir = 1;}
      var root = document.getElementById('attRoot');
      if (root && _adlData.length) _renderAdl(root, _adlData);
    }

    function _adlExpandAllFn(exp) {
      document.querySelectorAll('#attRoot .adm-body').forEach(function (b) {b.classList.toggle('adm-open', exp);});
      document.querySelectorAll('#attRoot [id^="adli_"]').forEach(function (i) {
        i.className = 'fas fa-chevron-' + (exp ? 'down' : 'right') + ' fa-fw';
      });
    }

    function _renderAdl(root, rows) {
      var sorted = rows.slice().sort(function (a, b) {
        var va, vb;
        if (_adlSort.key === 'name') {va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase();}
        else if (_adlSort.key === 'dept') {va = (a.dept || '').toLowerCase(); vb = (b.dept || '').toLowerCase();}
        else if (_adlSort.key === 'checkin') {va = a.check_in || '99:99'; vb = b.check_in || '99:99';}
        else if (_adlSort.key === 'status') {va = a.status || ''; vb = b.status || '';}
        else {va = a.date || ''; vb = b.date || '';}
        return va < vb ? -_adlSort.dir : va > vb ? _adlSort.dir : 0;
      });
      var totP = rows.filter(function (r) {return r.status === 'P';}).length;
      var totHD = rows.filter(function (r) {return r.status === 'HD';}).length;
      var totA = rows.filter(function (r) {return r.status === 'A';}).length;
      var totL = rows.filter(function (r) {return r.is_late;}).length;

      function sortBtn(key, lbl, ico) {
        var active = _adlSort.key === key;
        var arr = active ? (_adlSort.dir === 1 ? ' ↑' : ' ↓') : '';
        return '<button onclick="_adlSortBy(\'' + key + '\')" style="display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid ' + (active ? 'var(--P)' : 'var(--bdr)') + ';background:' + (active ? 'var(--Pl)' : 'var(--bg)') + ';color:' + (active ? 'var(--P)' : 'var(--tx2)') + '"><i class="fas ' + ico + '" style="font-size:10px"></i>' + lbl + arr + '</button>';
      }

      var html = '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px;padding:10px 14px;background:var(--sur);border:1px solid var(--bdr);border-radius:12px;position:sticky;top:0;z-index:10;box-shadow:0 2px 8px rgba(0,0,0,.06)">' +
        '<span style="font-size:10.5px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px;white-space:nowrap">Sort:</span>' +
        sortBtn('date', 'Date', 'fa-calendar') + sortBtn('name', 'Name', 'fa-user') +
        sortBtn('dept', 'Dept', 'fa-building') + sortBtn('checkin', 'Check-in', 'fa-sign-in-alt') +
        sortBtn('status', 'Status', 'fa-circle-check') +
        '<div style="width:1px;height:22px;background:var(--bdr);flex-shrink:0;margin:0 2px"></div>' +
        '<button onclick="_adlExpandAllFn(true)" style="display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx2)"><i class="fas fa-angles-down" style="font-size:10px"></i>Expand All</button>' +
        '<button onclick="_adlExpandAllFn(false)" style="display:inline-flex;align-items:center;gap:4px;padding:5px 11px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid var(--bdr);background:var(--bg);color:var(--tx2)"><i class="fas fa-angles-right" style="font-size:10px"></i>Collapse All</button>' +
        '<div style="flex:1"></div>' +
        '<div style="display:flex;gap:5px">' +
        '<span style="padding:4px 10px;border-radius:20px;background:var(--Gl);color:var(--G);font-size:11px;font-weight:800"><i class="fas fa-circle-check"></i> ' + totP + '</span>' +
        (totHD ? '<span style="padding:4px 10px;border-radius:20px;background:var(--Ol);color:var(--O);font-size:11px;font-weight:800"><i class="fas fa-circle-half-stroke"></i> ' + totHD + '</span>' : '') +
        (totA ? '<span style="padding:4px 10px;border-radius:20px;background:var(--Rl);color:var(--R);font-size:11px;font-weight:800"><i class="fas fa-circle-xmark"></i> ' + totA + '</span>' : '') +
        (totL ? '<span style="padding:4px 10px;border-radius:20px;background:var(--Ol);color:var(--O);font-size:11px;font-weight:800"><i class="fas fa-clock"></i> ' + totL + ' Late</span>' : '') +
        '<span style="padding:4px 10px;border-radius:20px;background:var(--Pl);color:var(--P);font-size:11px;font-weight:800"><i class="fas fa-calendar-days"></i> ' + rows.length + '</span>' +
        '</div></div>';

      var byMonth = {}, mOrder = [];
      sorted.forEach(function (r) {
        var m = String(r.date || '').slice(0, 7), d = String(r.date || '');
        if (!byMonth[m]) {byMonth[m] = {}; mOrder.push(m);}
        if (!byMonth[m][d]) byMonth[m][d] = [];
        byMonth[m][d].push(r);
      });
      mOrder = mOrder.filter(function (m, i, a) {return a.indexOf(m) === i;});
      if (_adlSort.key === 'date' && _adlSort.dir === -1) mOrder.reverse();

      mOrder.forEach(function (m, mi) {
        var mDates = byMonth[m], dOrder = Object.keys(mDates);
        if (_adlSort.key === 'date') dOrder.sort(function (a, b) {return _adlSort.dir * (a < b ? -1 : a > b ? 1 : 0);});
        var mRecs = []; dOrder.forEach(function (d) {mRecs = mRecs.concat(mDates[d]);});
        var mP = mRecs.filter(function (r) {return r.status === 'P';}).length;
        var mHD = mRecs.filter(function (r) {return r.status === 'HD';}).length;
        var mA = mRecs.filter(function (r) {return r.status === 'A';}).length;
        var mL = mRecs.filter(function (r) {return r.is_late;}).length;
        var mLbl = new Date(m + '-01T00:00:00').toLocaleDateString('en-IN', {month: 'long', year: 'numeric'});
        var uid = 'adl' + mi, open = mi === 0;

        html += '<div style="margin-bottom:14px;border-radius:14px;overflow:hidden;border:1px solid var(--bdr2);box-shadow:0 2px 12px rgba(0,0,0,.06)">' +
          '<div id="adlh_' + uid + '" onclick="_adlToggle(\'' + uid + '\')" style="display:flex;align-items:center;gap:12px;padding:14px 18px;background:linear-gradient(135deg,var(--P),color-mix(in srgb,var(--P) 70%,var(--T)));cursor:pointer;user-select:none">' +
          '<i id="adli_' + uid + '" class="fas fa-chevron-' + (open ? 'down' : 'right') + ' fa-fw" style="color:rgba(255,255,255,.9);font-size:13px"></i>' +
          '<span style="font-weight:900;font-size:16px;flex:1;color:#fff">' + mLbl + '</span>' +
          '<div style="display:flex;gap:6px">' +
          '<span style="padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;font-size:11.5px;font-weight:800"><i class="fas fa-circle-check"></i> ' + mP + '</span>' +
          (mHD ? '<span style="padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;font-size:11.5px;font-weight:800"><i class="fas fa-circle-half-stroke"></i> ' + mHD + '</span>' : '') +
          (mA ? '<span style="padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.2);color:#fff;font-size:11.5px;font-weight:800"><i class="fas fa-circle-xmark"></i> ' + mA + '</span>' : '') +
          (mL ? '<span style="padding:3px 10px;border-radius:20px;background:rgba(0,0,0,.15);color:#fff;font-size:11px;font-weight:700"><i class="fas fa-clock"></i> ' + mL + ' late</span>' : '') +
          '<span style="padding:3px 10px;border-radius:20px;background:rgba(0,0,0,.2);color:#fff;font-size:11px;font-weight:700">' + dOrder.length + ' days</span></div></div>' +
          '<div id="' + uid + '" class="adm-body' + (open ? ' adm-open' : '') + '">';

        dOrder.forEach(function (d, di) {
          var dRecs = mDates[d].slice();
          if (_adlSort.key !== 'date') dRecs.sort(function (a, b) {
            var va, vb;
            if (_adlSort.key === 'name') {va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase();}
            else if (_adlSort.key === 'dept') {va = (a.dept || '').toLowerCase(); vb = (b.dept || '').toLowerCase();}
            else if (_adlSort.key === 'checkin') {va = a.check_in || '99:99'; vb = b.check_in || '99:99';}
            else if (_adlSort.key === 'status') {va = a.status || ''; vb = b.status || '';}
            return va < vb ? -_adlSort.dir : va > vb ? _adlSort.dir : 0;
          });
          var dDate = new Date(d + 'T00:00:00');
          var dDay = dDate.toLocaleDateString('en-IN', {weekday: 'long'});
          var dShort = dDate.toLocaleDateString('en-IN', {day: '2-digit', month: 'short'});
          var dP = dRecs.filter(function (r) {return r.status === 'P';}).length;
          var dHD = dRecs.filter(function (r) {return r.status === 'HD';}).length;
          var dA = dRecs.filter(function (r) {return r.status === 'A';}).length;
          var dL = dRecs.filter(function (r) {return r.is_late;}).length;
          var duid = uid + '_d' + di;
          var isSun = dDate.getDay() === 0;

          html +=
            '<div id="adldh_' + duid + '" onclick="_adlToggle(\'' + duid + '\')"' +
            ' style="display:flex;align-items:center;gap:10px;padding:9px 18px 9px 20px;background:' + (isSun ? 'rgba(239,68,68,.06)' : 'var(--bg)') + ';border-top:1px solid var(--bdr);cursor:pointer;user-select:none;transition:background .12s"' +
            ' onmouseover="this.style.background=\'var(--Pl)\'" onmouseout="this.style.background=\'' + (isSun ? 'rgba(239,68,68,.06)' : 'var(--bg)') + '\'">' +
            '<i id="adli_' + duid + '" class="fas fa-chevron-down fa-fw" style="color:var(--P);font-size:11px;flex-shrink:0"></i>' +
            '<div style="flex-shrink:0;min-width:95px">' +
            '<div style="font-weight:900;font-size:14px;color:' + (isSun ? 'var(--R)' : 'var(--tx)') + '">' + dShort + '</div>' +
            '<div style="font-size:10px;font-weight:700;color:' + (isSun ? 'var(--R)' : 'var(--tx3)') + ';text-transform:uppercase">' + dDay + '</div>' +
            '</div>' +
            '<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">' +
            (dP ? '<span style="padding:2px 8px;border-radius:12px;background:var(--Gl);color:var(--G);font-size:10.5px;font-weight:800">' + dP + ' P</span>' : '') +
            (dHD ? '<span style="padding:2px 8px;border-radius:12px;background:var(--Ol);color:var(--O);font-size:10.5px;font-weight:800">' + dHD + ' HD</span>' : '') +
            (dA ? '<span style="padding:2px 8px;border-radius:12px;background:var(--Rl);color:var(--R);font-size:10.5px;font-weight:800">' + dA + ' A</span>' : '') +
            (dL ? '<span style="padding:2px 8px;border-radius:12px;background:var(--Ol);color:var(--O);font-size:10.5px;font-weight:700"><i class="fas fa-clock" style="font-size:9px"></i> ' + dL + '</span>' : '') +
            '</div><div style="flex:1"></div>' +
            '<span style="font-size:11px;color:var(--tx3);font-weight:600">' + dRecs.length + ' staff</span></div>' +
            '<div id="' + duid + '" class="adm-body adm-open">' +
            '<table style="width:100%;border-collapse:collapse">' +
            '<thead><tr style="background:var(--sur2)">' +
            '<th style="padding:8px 10px 8px 24px;font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px;text-align:left;min-width:160px">Employee</th>' +
            '<th style="padding:8px 10px;font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px;text-align:left">Dept</th>' +
            '<th style="padding:8px 10px;font-size:10px;font-weight:800;color:var(--P);text-transform:uppercase;letter-spacing:.4px;text-align:center;width:80px"><i class="fas fa-calendar-clock"></i> Plan IN</th>' +
            '<th style="padding:8px 10px;font-size:10px;font-weight:800;color:var(--G);text-transform:uppercase;letter-spacing:.4px;text-align:center;width:80px"><i class="fas fa-check-circle"></i> Actual OUT</th>' +
            '<th style="padding:8px 10px;font-size:10px;font-weight:800;color:var(--T);text-transform:uppercase;letter-spacing:.4px;text-align:center;width:70px">Hrs</th>' +
            '<th style="padding:8px 16px;font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px;text-align:center;width:100px">Status</th>' +
            '</tr></thead><tbody>' +
            dRecs.map(function (r, ri) {
              var isP = r.status === 'P', isHD = r.status === 'HD', isA = r.status === 'A';
              var stBg = isP ? 'var(--Gl)' : isHD ? 'var(--Ol)' : isA ? 'var(--Rl)' : 'var(--sur2)';
              var stFc = isP ? 'var(--G)' : isHD ? 'var(--O)' : isA ? 'var(--R)' : 'var(--tx3)';
              var stLbl = isP ? 'Present' : isHD ? 'Half Day' : isA ? 'Absent' : (r.status || '—');
              var ci = (!r.check_in || r.check_in === '-') ? '—' : r.check_in;
              var co = (!r.check_out || r.check_out === '-') ? '—' : r.check_out;
              var hr = r.parsed_hours != null ? (Math.round(r.parsed_hours * 10) / 10) + 'h' : ((!r.total_hours || r.total_hours === '-') ? '—' : r.total_hours);
              var rowBg = ri % 2 === 0 ? 'var(--bg)' : 'var(--sur2)';
              return '<tr style="background:' + rowBg + ';transition:background .1s" onmouseover="this.style.background=\'var(--Pl)\'" onmouseout="this.style.background=\'' + rowBg + '\'">' +
                '<td style="padding:10px 10px 10px 24px;font-weight:700;font-size:13px">' + _esc(r.name || '') +
                (r.is_late ? '<span style="margin-left:6px;padding:1px 6px;border-radius:4px;background:var(--Ol);color:var(--O);font-size:9px;font-weight:900;vertical-align:middle">LATE</span>' : '') +
                '</td><td style="padding:10px;font-size:11.5px;color:var(--tx2)">' + _esc(r.dept || '') + '</td>' +
                '<td style="padding:10px;text-align:center;font-weight:800;font-size:13px;color:' + (ci === '—' ? 'var(--tx3)' : 'var(--G)') + '">' + ci + '</td>' +
                '<td style="padding:10px;text-align:center;font-weight:800;font-size:13px;color:' + (co === '—' ? 'var(--tx3)' : 'var(--R)') + '">' + co + '</td>' +
                '<td style="padding:10px;text-align:center;font-weight:800;font-size:13px;color:' + (hr === '—' ? 'var(--tx3)' : 'var(--P)') + '">' + _esc(String(hr)) + '</td>' +
                '<td style="padding:10px 16px;text-align:center"><span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;background:' + stBg + ';color:' + stFc + '">' + stLbl + '</span></td></tr>';
            }).join('') +
            '</tbody></table></div>';
        });
        html += '</div></div>';
      });
      root.innerHTML = html;
    }

    function _adlToggle(uid) {
      var b = document.getElementById(uid), ic = document.getElementById('adli_' + uid);
      if (!b) return;
      var open = b.classList.toggle('adm-open');
      if (ic) ic.className = 'fas fa-chevron-' + (open ? 'down' : 'right') + ' fa-fw';
    }

    function _adlToggle(uid) {
      var b = document.getElementById(uid);
      var ic = document.getElementById('adli_' + uid);
      if (!b) return;
      var open = b.classList.toggle('adm-open');
      if (ic) ic.className = 'fas fa-chevron-' + (open ? 'down' : 'right') + ' fa-fw';
    }

    function _exportAttCSV() {
      var data = _D.attData;
      if (!data) {_toast('Load analytics first', 'err'); return;}
      var view = (document.getElementById('attView') || {}).value || 'overview';
      var head, rows, name;

      if (view === 'dept') {
        head = ['Department', 'Employees', 'Present', 'Half Day', 'Absent', 'Presence %'];
        rows = (data.by_dept || []).map(function (d) {return ['"' + (d.dept || '') + '"', d.employees || 0, d.present || 0, d.half_day || 0, d.absent || 0, (d.presence_pct || 0) + '%'];});
        name = 'attendance_by_dept';
      } else if (view === 'late') {
        head = ['Employee', 'Department', 'Late Count', 'Working Days'];
        rows = (data.by_employee || []).filter(function (e) {return e.late > 0;}).map(function (e) {return ['"' + (e.name || '') + '"', '"' + (e.dept || '') + '"', e.late || 0, e.working_days || 0];});
        name = 'attendance_late_arrivals';
      } else {
        head = ['Employee', 'Department', 'Present', 'Half Day', 'Absent', 'Week Off', 'Late', 'Presence %', 'Avg Hours'];
        rows = (data.by_employee || []).map(function (e) {return ['"' + (e.name || '') + '"', '"' + (e.dept || '') + '"', e.present || 0, e.half_day || 0, e.absent || 0, e.week_off || 0, e.late || 0, (e.presence_pct || 0) + '%', e.avg_hours || 0];});
        name = 'attendance_by_employee';
      }

      if (!rows.length) {_toast('No data to export', 'err'); return;}
      var csv = [head.join(',')].concat(rows.map(function (r) {return r.join(',');})).join('\n');
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFF' + csv);
      a.download = name + '_' + (data.from || _currMonth()) + '_to_' + (data.to || _today()) + '.csv';
      a.click();
      _toast('Exported!', 'ok');
    }
    /* ══════════════════════════════════════════════════════════════════════
       BOOT SEQUENCE — Called after successful login
       Loads user data, populates UI, starts polls.
    ══════════════════════════════════════════════════════════════════════ */
    // function _bootApp(user) {
    //   _U = user;

    //   // Show app, hide login
    //   document.getElementById('loginScreen').style.display = 'none';
    //   document.getElementById('sApp').style.display = 'flex';

    //   // Populate user info
    //   var nameEls = document.querySelectorAll('.sidebar-user-name');
    //   nameEls.forEach(function (el) { el.textContent = (_U&&_U.name)||'User'; });
    //   var roleEls = document.querySelectorAll('.sidebar-user-role');
    //   roleEls.forEach(function (el) { el.textContent = _U.role || 'STAFF'; });
    //   var deptEls = document.querySelectorAll('.sidebar-user-dept');
    //   deptEls.forEach(function (el) { el.textContent = _U.dept || ''; });

    //   // Show manager nav items
    //   if (_isManager()) {
    //     var mgrNav = document.getElementById('mgrNav');
    //     if (mgrNav) mgrNav.style.display = 'block';
    //   }

    //   // Set user avatar
    //   var avaEls = document.querySelectorAll('.sidebar-ava');
    //   avaEls.forEach(function (el) {
    //     if (_U.photo) {
    //       el.innerHTML = '<img src="' + _esc(_U.photo) + '" alt="' + _esc(_U.name) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.outerHTML=\'' + _initials(_U.name) + '\'">';
    //     } else {
    //       el.textContent = _initials(_U.name);
    //     }
    //   });

    //   // Start background processes
    //   _loadAnnBadge();
    //   _startBadgePoll();

    //   // Pre-fetch employee directory for global search index
    //   setTimeout(function () {
    //     _gas('getEmployeeDirectory', [], function (emps) { _D.empDir = emps || []; _buildSearchIndex(); }, function () { });
    //     _gas('getAnnouncements', [], function (anns) { _D.announcements = anns || []; }, function () { });
    //   }, 2000);

    //   // Try to restore last session
    //   var lastSession = _restoreNavState();
    //   if (lastSession && lastSession.view) {
    //     _loadV(lastSession.view, lastSession.sub);
    //   } else {
    //     _loadV('dash');
    //   }

    //   // Show onboarding tip
    //   setTimeout(_showNextTip, 3000);
    // }

    /* ══════════════════════════════════════════════════════════════════════
       GAS BRIDGE — The single entry point for ALL backend calls.
       Automatically appends the _U (logged-in user) object as the last
       argument so every GAS function gets passedUser for auth verification.
    ══════════════════════════════════════════════════════════════════════ */
    /* ══════════════════════════════════════════════════════════════════════
       SIGN-OUT OVERLAY HELPERS
    ══════════════════════════════════════════════════════════════════════ */
    function _soShow() {
      try {
        var u = (typeof _safeU === 'function') ? _safeU() : (_U || {});
        var sbNm = document.getElementById('sbName');
        var sbRl = document.getElementById('sbRole');
        var nm = (u.name && String(u.name).trim() && u.name !== 'User' && u.name !== 'Staff')
          ? u.name
          : (sbNm && sbNm.textContent && sbNm.textContent.trim() && sbNm.textContent !== 'Joolry Staff' ? sbNm.textContent.trim() : '');
        if (!nm) nm = (u.email || 'Staff Member');
        var role = (u.role || 'STAFF');
        var dept = (u.dept || '');
        var rl = dept ? (role + ' · ' + dept) : role;
        if (sbRl && sbRl.textContent && sbRl.textContent.trim() && (!u.role || !u.dept)) {
          rl = sbRl.textContent.trim();
        }
        var nEl = document.getElementById('soUserName');
        var rEl = document.getElementById('soUserDept');
        if (nEl) nEl.textContent = nm;
        if (rEl) rEl.textContent = rl;
        // Avatar initial
        var av = document.querySelector('#soOv .so-box [style*="border-radius:50%"]');
        if (av) {
          var ini = (nm && nm !== 'Staff Member') ? nm.replace(/[^A-Za-z ]/g,'').split(' ').filter(Boolean).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase() : '?';
          av.innerHTML = ini || '<i class="fas fa-user" style="font-size:15px"></i>';
        }
      } catch (e) { console.warn('soShow', e); }
      var ov = document.getElementById('soOv');
      if (ov) {
        ov.style.display = 'flex';
        ov.classList.add('on');
      }
      document.body.style.overflow = 'hidden';
    }
    function _soHide() {
      var ov = document.getElementById('soOv');
      if (ov) {
        ov.classList.remove('on');
        ov.style.display = 'none';
      }
      document.body.style.overflow = '';
    }

    /* ══════════════════════════════════════════════════════════════════════
       NOTIFICATION CENTER
       _addNtf: push a notification to the panel
       _markAllRead: mark all as read
       _clearNtfs: remove all
    ══════════════════════════════════════════════════════════════════════ */
    function _addNtf(msg, ico, bg, c) {
      var ntf = {
        id: Date.now(),
        msg: msg,
        ico: ico || 'fa-bell',
        bg: bg || 'var(--Pl)',
        c: c || 'var(--P)',
        ts: new Date().toISOString(),
        read: false
      };
      _ntfs.unshift(ntf);
      if (_ntfs.length > 40) _ntfs.pop();
      _ntfU++;
      _updateNtfBadge();
      _renderNtfList();
    }

    function _updateNtfBadge() {
      var badge = document.getElementById('ntfBadge');
      if (!badge) return;
      badge.textContent = _ntfU > 0 ? (_ntfU > 9 ? '9+' : _ntfU) : '';
      badge.style.display = _ntfU > 0 ? 'inline-flex' : 'none';
    }

    function _renderNtfList() {
      var el = document.getElementById('ntfList');
      if (!el) return;
      if (!_ntfs.length) {
        el.innerHTML = '<div class="ntf-empty"><i class="fas fa-bell-slash" style="font-size:22px;display:block;margin-bottom:10px;opacity:.4"></i>No notifications yet</div>';
        return;
      }
      el.innerHTML = _ntfs.map(function (n) {
        return '<div class="ntf-item' + (n.read ? ' read' : '') + '" onclick="_readNtf(' + n.id + ')">' +
          '<div class="ntf-ico" style="background:' + n.bg + ';color:' + n.c + '"><i class="fas ' + n.ico + '"></i></div>' +
          '<div class="ntf-body">' +
          '<div class="ntf-msg">' + _esc(n.msg) + '</div>' +
          '<div class="ntf-time">' + _fmtTimestamp(n.ts) + '</div>' +
          '</div>' +
          '</div>';
      }).join('');
      var cntEl = document.getElementById('ntfCnt');
      if (cntEl) {
        cntEl.textContent = _ntfs.length;
        cntEl.style.display = _ntfs.length > 0 ? 'inline-flex' : 'none';
      }
    }

    function _readNtf(id) {
      var n = _ntfs.find(function (x) {return x.id === id;});
      if (n && !n.read) {n.read = true; _ntfU = Math.max(0, _ntfU - 1); _updateNtfBadge();}
      _renderNtfList();
    }

    function _markAllRead() {
      _ntfs.forEach(function (n) {n.read = true;});
      _ntfU = 0;
      _updateNtfBadge();
      _renderNtfList();
    }

    function _clearNtfs() {
      _ntfs = []; _ntfU = 0;
      _updateNtfBadge();
      _renderNtfList();
    }

    function _toggleNtfPanel() {
      var p = document.getElementById('ntfPanel');
      if (!p) return;
      var isOpen = p.classList.contains('open');
      if (!isOpen) {
        p.classList.add('open');
        _markAllRead();
        _renderNtfList();
        setTimeout(function () {
          document.addEventListener('click', function closeNtf(e) {
            if (!p.contains(e.target) && !e.target.closest('#ntfBtn')) {
              p.classList.remove('open');
              document.removeEventListener('click', closeNtf);
            }
          });
        }, 100);
      } else {
        p.classList.remove('open');
      }
    }

    /* ══════════════════════════════════════════════════════════════════════
       DARK MODE TOGGLE
    ══════════════════════════════════════════════════════════════════════ */
    function _toggleDark() {
      _dark = !_dark;
      document.body.classList.toggle('dark', _dark);
      localStorage.setItem('fk_dark', _dark ? '1' : '0');
      var ico = document.getElementById('darkIco');
      if (ico) ico.className = _dark ? 'fas fa-sun' : 'fas fa-moon';

      // Rebuild charts with updated theme colors
      if (_V) {
        setTimeout(function () {
          var view = _V;
          _loadV(view, _ST);
        }, 150);
      }
    }

    /* ══════════════════════════════════════════════════════════════════════
       CSV DOWNLOAD UTILITY
       Creates a UTF-8 BOM CSV and triggers browser download.
       UTF-8 BOM is prepended so Excel opens it correctly.
    ══════════════════════════════════════════════════════════════════════ */
    function _downloadCSV(filename, rows) {
      var csv = '\uFEFF' + rows.map(function (row) {
        return row.map(function (cell) {
          var s = String(cell == null ? '' : cell);
          if (s.indexOf(',') > -1 || s.indexOf('"') > -1 || s.indexOf('\n') > -1)
            s = '"' + s.replace(/"/g, '""') + '"';
          return s;
        }).join(',');
      }).join('\r\n');

      var blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename; a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    /* ══════════════════════════════════════════════════════════════════════
       TAB SYSTEM — Build tab headers + pane containers
    ══════════════════════════════════════════════════════════════════════ */
    function _mkTabs(tabs, active) {
      return '<div class="tabs">' +
        tabs.map(function (t) {
          return '<button class="tab' + (t.id === active ? ' active' : '') + '" ' +
            'onclick="event.preventDefault();_switchTab(\'' + t.id + '\')" data-tab="' + t.id + '">' +
            t.lbl +
            '</button>';
        }).join('') +
        '</div>';
    }

    function _mkPanes(tabs, active, contents) {
      return '<div class="tab-panes">' +
        tabs.map(function (t, i) {
          return '<div id="' + t.id + 'Pane" class="tab-pane' + (t.id === active ? ' active' : '') + '">' +
            (contents[i] || '') +
            '</div>';
        }).join('') +
        '</div>';
    }

    function _switchTab(tabId) {
      _ST = tabId;

      // Tab buttons
      document.querySelectorAll('.tab').forEach(function (el) {
        el.classList.toggle('active', el.getAttribute('data-tab') === tabId);
      });

      // Panes — switch active, NO animation on mobile (causes scroll jump)
      var isMob = window.innerWidth <= 768;
      document.querySelectorAll('.tab-pane').forEach(function (el) {
        var isActive = el.id === tabId + 'Pane';
        if (isActive && !el.classList.contains('active') && !isMob) {
          // Only animate on desktop — mobile animation causes page jump
          el.classList.remove('tab-enter');
          el.classList.add('tab-enter');
        }
        el.classList.toggle('active', isActive);
      });

      // Dispatch sub-tab loaders
      var loaders = {
        // Checklist
        ctoday: _loadToday, cweek: _loadWeek, chist: _loadHist, csetup: _loadSetupTasks,
        // Delegation
        dmine: _loadDelMine, dout: _loadDelOut, dall: _loadDelAll, dcr: _loadDelCreate,
        // Attendance — all tab IDs mapped to correct loader functions
        amy: _loadMyAtt,
        areg: _loadMyRegularizations, ala: _loadLeaveApprovals,
        arega: _loadRegApprovals, aana: _loadAttAnalytics,
        cmteam: _loadTeamChecklist,
        amteam: _loadTeamAtt,
        // legacy aliases kept for safety
        amyatt: _loadMyAtt, amstr: _loadMustTab,
        // Performance Reports module removed — pteam loader kept as a
        // harmless no-op stub since nothing currently routes to it.
        pteam: _loadTeamPerf,
        // Leave management
        lreq: _loadMyLeaves, lbal: _loadLeaveBalance, lcal: _loadLeaveCalView, lsumm: _loadLeaveSummTab, lapprv: _loadLeaveApprovals,
        // EM Weekly Meeting
        emwm: _vEMWeeklyMeeting,
        // EM Increment Appraisal
        emap: _vEMAppraisal
      };

      if (loaders[tabId]) {
        try {loaders[tabId]();} catch (e) {console.warn('[_switchTab] loader error for ' + tabId + ': ' + e.message);}
      }
      // Apply responsive post-render fixes after tab switches
      _debouncedPostRender();
    }

    /* ── _responsivePostRender ───────────────────────────────────────────────
       Called after every view/tab load. Ensures all dynamically rendered
       content is properly wrapped for mobile responsiveness.
    ── */
    /* Debounce wrapper for _responsivePostRender — prevents redundant calls */
    var _prTimer = null;
    function _debouncedPostRender() {
      clearTimeout(_prTimer);
      _prTimer = setTimeout(_responsivePostRender, 100);
    }

    function _responsivePostRender() {
      var content = document.getElementById('content');
      if (!content) return;

      // 1. Wrap bare <table> in .tw for scrollable + animated rows
      content.querySelectorAll('table').forEach(function (tbl) {
        if (tbl.closest('.tw')) return;
        var wrapper = document.createElement('div');
        wrapper.className = 'tw';
        tbl.parentNode.insertBefore(wrapper, tbl);
        wrapper.appendChild(tbl);
      });

      // 2. Content visible immediately — subtle slide for item-level animations only
      // Removed: content.classList.add('view-enter') was causing blank screen on slow mobile

      // 3. Stagger .anim-item cards — reset animation to replay
      var items = content.querySelectorAll('.anim-item');
      items.forEach(function (el, i) {
        if (window.innerWidth <= 768) return; // skip stagger on mobile
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
        el.style.animationDelay = Math.min(i * 55, 420) + 'ms';
      });

      // 4. KPI number: just add animation class (counter animation in CSS via transform/opacity)
      content.querySelectorAll('.kpi-val').forEach(function (el) {
        el.classList.add('kpi-counting');
      });

      // 5. Animate progress bars — find width-set divs
      content.querySelectorAll('[style*="width:"][style*="background"]').forEach(function (el) {
        if (el.style.height && parseInt(el.style.height) <= 12) {
          el.classList.add('prog-fill-anim');
        }
      });

      // 6. On mobile — fix sort bars + filter grids
      if (window.innerWidth <= 640) {
        content.querySelectorAll('[id$="SortBar"], .sort-bar').forEach(function (bar) {
          bar.style.flexWrap = 'nowrap';
          bar.style.overflowX = 'auto';
          bar.style.paddingBottom = '4px';
          bar.style.scrollbarWidth = 'none';
        });
        content.querySelectorAll('[id$="Filters"], [id$="filters"]').forEach(function (fb) {
          if (fb.style.display !== 'grid') {
            fb.style.display = 'grid';
            fb.style.gridTemplateColumns = '1fr 1fr';
            fb.style.gap = '6px';
          }
        });
        content.querySelectorAll('.em-heat-col, th[data-heat], td[data-heat]').forEach(function (el) {
          el.style.display = 'none';
        });
      }
    }

    /* Muster tab within attendance — reads mustDept/mustMonth elements */
    function _loadMusterTab() {
      if (!_isManager()) return;
      _loadMustTab();
    }

    /* ══════════════════════════════════════════════════════════════════════
       MODAL SYSTEM — Generic modal with title, body, confirm, cancel
    ══════════════════════════════════════════════════════════════════════ */
    // ── Generic click-to-drill-down popup ─────────────────────────────────────
    // Used by Checklist / Delegation / Attendance Analytics: click any card
    // showing a number, and this shows the underlying records behind it.
    // columns: [{label, key, align, render(row)->html}], rows: array of objects.
    function _showDrillModal(title, subtitle, columns, rows, truncatedNote) {
      var modal = document.getElementById('modal');
      if (modal) modal.className = 'modal-box wide';

      var body = '';
      if (subtitle) body += '<div style="font-size:12px;color:var(--tx3);margin-bottom:12px">' + subtitle + '</div>';
      body += '<div style="max-height:55vh;overflow-y:auto">';
      body += '<div class="tw"><table><thead><tr>' +
        columns.map(function (c) {return '<th' + (c.align ? ' style="text-align:' + c.align + '"' : '') + '>' + _esc(c.label) + '</th>';}).join('') +
        '</tr></thead><tbody>';
      if (!rows.length) {
        body += '<tr><td colspan="' + columns.length + '" style="text-align:center;color:var(--tx3);padding:18px">No underlying records found</td></tr>';
      } else {
        rows.forEach(function (r) {
          body += '<tr>' + columns.map(function (c) {
            var v = c.render ? c.render(r) : _esc(r[c.key] === null || r[c.key] === undefined ? '' : String(r[c.key]));
            return '<td' + (c.align ? ' style="text-align:' + c.align + '"' : '') + '>' + v + '</td>';
          }).join('') + '</tr>';
        });
      }
      body += '</tbody></table></div></div>';
      if (truncatedNote) body += '<div style="font-size:11px;color:var(--tx3);margin-top:10px;text-align:center">' + truncatedNote + '</div>';

      _openModal('<i class="fas fa-magnifying-glass-chart" style="color:var(--P)"></i> ' + title, body);
    }

    function _openModal(title, body, onConfirm, confirmLabel, noClose) {
      var ov = document.getElementById('mOv');
      var modal = document.getElementById('modal');
      var tEl = document.getElementById('mTitle');
      var bEl = document.getElementById('mBody');
      var fEl = document.getElementById('mFoot');
      if (!modal || !ov) return;

      if (tEl) tEl.innerHTML = title || 'Confirm';
      if (bEl) bEl.innerHTML = body || '';
      if (fEl) fEl.innerHTML =
        '<button class="btn btn-outline" onclick="_closeModal()"><i class="fas fa-times"></i> Cancel</button>' +
        (onConfirm ? '<button class="btn" id="mConfirmBtn">' + (confirmLabel || 'Confirm') + '</button>' : '');

      // Show overlay + modal (use class-based show for CSS centering to work)
      ov.style.display = 'flex';
      ov.style.alignItems = 'center';
      ov.style.justifyContent = 'center';
      ov.style.padding = '20px';
      modal.style.display = 'flex';
      modal.classList.add('open');

      setTimeout(function () {
        var cb = document.getElementById('mConfirmBtn');
        if (cb) {
          if (onConfirm) cb.onclick = onConfirm; // ← closure se uid milega
          cb.focus();
        }
      }, 100);
    }

    function _closeModal() {
      var ov = document.getElementById('mOv');
      var modal = document.getElementById('modal');
      if (ov) ov.style.display = 'none';
      if (modal) {modal.style.display = 'none'; modal.classList.remove('open'); modal.classList.remove('wide', 'xl');}
    }

    /* Close modal on ESC key */
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        _closeGS();
        _closeModal();
        var sp = document.getElementById('settingsPanel');
        if (sp) {sp.remove(); _settingsOpen = false;}
        var fab = document.getElementById('fabMenu');
        if (fab) fab.remove();
      }
    });

    /* ══════════════════════════════════════════════════════════════════════
       LOGIN HANDLER
    ══════════════════════════════════════════════════════════════════════ */
    function _login() {
      var emailEl = document.getElementById('femail');
      var pwEl = document.getElementById('fpw') || document.getElementById('fpass');
      var btnEl = document.getElementById('btnLogin');
      var errEl = document.getElementById('loginErr');
      if (!emailEl || !pwEl) return;

      var email = emailEl.value.trim().toLowerCase();
      var pw = pwEl.value.trim();

      if (!email) {if (errEl) {errEl.textContent = 'Email is required.'; errEl.classList.add('on');} emailEl.focus(); return;}
      if (!pw) {if (errEl) {errEl.textContent = 'Password is required.'; errEl.classList.add('on');} pwEl.focus(); return;}
      if (errEl) {errEl.textContent = ''; errEl.classList.remove('on');}

      if (btnEl) {btnEl.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Signing in…'; btnEl.disabled = true;}

      fetch('/api/rpc', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({fn: 'processLogin', args: [email, pw]})})
        .then(function (r) {return r.json();})
        .then(function (res) {
          if (btnEl) {btnEl.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Sign In'; btnEl.disabled = false;}
          if (res && res.success && res.user) {
            _U = res.user;
            _TOKEN = res.token || '';
            _bootApp(res.user);
          } else {
            if (errEl) {errEl.textContent = (res && res.error) || 'Login failed.'; errEl.classList.add('on');}
            if (pwEl) pwEl.focus();
          }
        })
        .catch(function (e) {
          if (btnEl) {btnEl.innerHTML = '<i class="fas fa-arrow-right-to-bracket"></i> Sign In'; btnEl.disabled = false;}
          if (errEl) {errEl.textContent = 'Network error. Check connection.'; errEl.classList.add('on');}
        });
    }

    /* Allow Enter key to submit login form */
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && document.getElementById('loginScreen') &&
        document.getElementById('loginScreen').style.display !== 'none') {
        _login();
      }
    });

    /* ══════════════════════════════════════════════════════════════════════
       TASK FILTER — Client-side filter for today's task cards
    ══════════════════════════════════════════════════════════════════════ */
    function _filterTaskCards(q) {
      q = (q || '').toLowerCase();
      document.querySelectorAll('.task-card,.krow-task').forEach(function (el) {
        el.style.display = !q || el.textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none';
      });
    }

    /* ══════════════════════════════════════════════════════════════════════
       EXPORT TASKS — CSV download for checklist data
    ══════════════════════════════════════════════════════════════════════ */
    function _exportTasks() {
      var tasks = _D.todayTasks || [];
      if (!tasks.length) {_toast('No task data to export', 'err'); return;}
      var rows = [['Task UID', 'Task Name', 'Frequency', 'Employee ID', 'Department', 'Status', 'Actual Date', 'Log ID']];
      tasks.forEach(function (t) {
        rows.push([t.task_uid, t.task_name, t.frequency, t.emp_id, t.dept, t.status, t.actual_dt, t.log_id]);
      });
      _downloadCSV('tasks_' + _today() + '.csv', rows);
      _toast('Tasks exported!', 'ok');
    }


    var _ckSortKey = 'status'; // status | name | plan
    var _ckSortDir = 'asc';

    function _ckSort(key) {
      if (_ckSortKey === key) {
        _ckSortDir = (_ckSortDir === 'asc') ? 'desc' : 'asc';
      } else {
        _ckSortKey = key;
        _ckSortDir = (key === 'name') ? 'asc' : 'asc';
      }
      _renderCkList();
    }

    function _ckSortedTasks(tasks) {
      var key = _ckSortKey || 'status';
      var dir = _ckSortDir === 'asc' ? 1 : -1;
      var arr = (tasks || []).slice();

      function statusRank(t) {
        if (t.status === 'Done') return 2;
        if (t.is_transferred) return 3;
        return 1; // pending
      }
      function planMins(t) {
        var s = t.scheduled_time || '';
        if (!s || s.indexOf(':') < 0) return 9999;
        var p = s.split(':');
        return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
      }

      arr.sort(function (a, b) {
        var av, bv;
        if (key === 'name') {
          av = String(a.task_name || '').toLowerCase();
          bv = String(b.task_name || '').toLowerCase();
          return av < bv ? -dir : av > bv ? dir : 0;
        }
        if (key === 'plan') {
          return (planMins(a) - planMins(b)) * dir;
        }
        // status: Pending → Done → Transferred
        return (statusRank(a) - statusRank(b)) * dir;
      });
      return arr;
    }

    function _ckSortBarHtml() {
      var key = _ckSortKey || 'status';
      var arrow = _ckSortDir === 'asc' ? '↑' : '↓';
      function btn(id, label, icon) {
        var on = key === id;
        return '<button type="button" onclick="_ckSort(\'' + id + '\')" style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid ' +
          (on ? 'var(--P)' : 'var(--bdr)') + ';background:' + (on ? 'var(--Pl)' : 'var(--bg)') +
          ';color:' + (on ? 'var(--P)' : 'var(--tx2)') + '">' +
          (icon ? '<i class="fas ' + icon + '" style="font-size:10px;margin-right:4px"></i>' : '') +
          label + (on ? ' ' + arrow : '') + '</button>';
      }
      return '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px">' +
        '<span style="font-size:10.5px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px">Sort:</span>' +
        btn('status', 'Status', 'fa-tag') +
        btn('name', 'Task', 'fa-font') +
        btn('plan', 'Plan time', 'fa-clock') +
        '</div>';
    }

    /* ══════════════════════════════════════════════════════════════════════
       STUB LOADERS — Fallbacks for modules not yet fully implemented
       These are called by _switchTab and prevent console errors.
    ══════════════════════════════════════════════════════════════════════ */
    function _ckRenderProgress(tasks) {
      var prog = document.getElementById('ckProgress');
      if (!prog) return;
      tasks = tasks || [];
      var done = tasks.filter(function (t) {return t.status === 'Done';}).length;
      var total = tasks.length;
      var pct = total > 0 ? Math.round(done / total * 100) : 0;
      prog.innerHTML =
        '<div style="display:flex;align-items:center;gap:14px;background:var(--bg);border:1px solid var(--bdr);border-radius:10px;padding:12px 16px">' +
        '<div style="flex:1">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:6px">' +
        '<span style="font-size:12px;font-weight:700;color:var(--tx2)">Today\'s Progress</span>' +
        '<span style="font-size:12px;font-weight:900;color:var(--P)">' + done + ' / ' + total + ' done</span>' +
        '</div>' +
        '<div class="pbar-wrap"><div class="pbar" style="width:' + pct + '%;background:' +
        (pct === 100 ? 'var(--G)' : pct >= 60 ? 'var(--P)' : 'var(--O)') + '"></div></div>' +
        '</div>' +
        '<div style="font-size:22px;font-weight:900;color:' +
        (pct === 100 ? 'var(--G)' : pct >= 60 ? 'var(--P)' : 'var(--O)') + '">' + pct + '%</div>' +
        '</div>';
    }

    function _loadToday() {
      var empId = document.getElementById('ckEmp') ? document.getElementById('ckEmp').value : (_U ? _U.emp_code : '');
      var date = document.getElementById('ckDate') ? document.getElementById('ckDate').value : _today();
      var el = document.getElementById('ckList');
      if (!el) return;

      // Default date = today when empty
      if (!date) {
        date = _today();
        var de = document.getElementById('ckDate');
        if (de) de.value = date;
      }

      // SWR: show cached data instantly when it matches current emp+date
      var cacheKey = String(empId || '') + '|' + String(date || '');
      var hasCache = _D.todayTasks && _D._ckTodayKey === cacheKey && Array.isArray(_D.todayTasks);
      if (hasCache) {
        _ckRenderProgress(_D.todayTasks);
        _renderCkList();
      } else {
        el.innerHTML = _skel(4);
      }

      _gasX('getTodayTasks', [empId, date], 35000, function (tasks) {
        tasks = tasks || [];
        _D.todayTasks = tasks;
        _D._ckTodayKey = cacheKey;
        _lcSave();
        _ckRenderProgress(tasks);
        _renderCkList();
      }, function (e) {
        if (hasCache) return;
        var msg = (e && e.message) ? e.message : 'Server se connect nahi ho pa raha';
        el.innerHTML =
          '<div style="text-align:center;padding:28px 16px">' +
          '<div style="font-size:28px;margin-bottom:8px">📡</div>' +
          '<div style="font-weight:700;color:var(--tx);margin-bottom:6px;font-size:15px">Connection Error</div>' +
          '<div style="font-size:12px;color:var(--tx2);margin-bottom:14px;line-height:1.5;max-width:320px;margin-left:auto;margin-right:auto">' +
          _esc(msg) + '</div>' +
          '<button class="btn btn-sm" onclick="_loadToday()">' +
          '<i class="fas fa-rotate-right"></i> Retry</button>' +
          '<div style="font-size:11px;color:var(--tx3);margin-top:12px">Past dates pe pehli baar 10–20s lag sakta hai</div>' +
          '</div>';
      });
    }


    var _delSortKey = 'due'; // due | name | status
    var _delSortDir = 'asc';
    var _delLastArgs = null; // { dels, el, isOut }

    function _delSort(key) {
      if (_delSortKey === key) {
        _delSortDir = (_delSortDir === 'asc') ? 'desc' : 'asc';
      } else {
        _delSortKey = key;
        _delSortDir = 'asc';
      }
      if (_delLastArgs) {
        _renderDelegCardsEl(_delLastArgs.dels, _delLastArgs.el, _delLastArgs.isOut);
      }
    }

    function _delSortItems(items) {
      var key = _delSortKey || 'due';
      var dir = _delSortDir === 'asc' ? 1 : -1;
      var arr = (items || []).slice();

      function dueVal(d) {
        var fd = String(d.final_date || d.first_date || '');
        return fd || '9999-99-99';
      }
      function stRank(d) {
        if (d.is_overdue && d.status !== 'Completed') return 0;
        if (d.status === 'Pending') return 1;
        if (d.status === 'Shifted') return 2;
        if (d.status === 'Completed') return 3;
        if (d.status === 'Cancelled') return 4;
        return 5;
      }

      arr.sort(function (a, b) {
        if (key === 'name') {
          var av = String(a.task_desc || a.task || '').toLowerCase();
          var bv = String(b.task_desc || b.task || '').toLowerCase();
          return av < bv ? -dir : av > bv ? dir : 0;
        }
        if (key === 'status') {
          return (stRank(a) - stRank(b)) * dir;
        }
        // due date
        var ad = dueVal(a), bd = dueVal(b);
        return ad < bd ? -dir : ad > bd ? dir : 0;
      });
      return arr;
    }

    function _delSortBarHtml() {
      var key = _delSortKey || 'due';
      var arrow = _delSortDir === 'asc' ? '↑' : '↓';
      function btn(id, label, icon) {
        var on = key === id;
        return '<button type="button" onclick="_delSort(\'' + id + '\')" style="padding:5px 10px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer;border:1.5px solid ' +
          (on ? 'var(--P)' : 'var(--bdr)') + ';background:' + (on ? 'var(--Pl)' : 'var(--bg)') +
          ';color:' + (on ? 'var(--P)' : 'var(--tx2)') + '">' +
          (icon ? '<i class="fas ' + icon + '" style="font-size:10px;margin-right:4px"></i>' : '') +
          label + (on ? ' ' + arrow : '') + '</button>';
      }
      return '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px">' +
        '<span style="font-size:10.5px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px">Sort:</span>' +
        btn('due', 'Due date', 'fa-calendar') +
        btn('name', 'Task', 'fa-font') +
        btn('status', 'Status', 'fa-tag') +
        '</div>';
    }


    function _renderCkList() {
      var el = document.getElementById('ckList');
      if (!el) return;
      var date = document.getElementById('ckDate') ? document.getElementById('ckDate').value : _today();
      var tasks = _ckSortedTasks(_D.todayTasks || []);

      if (!tasks.length) {
        el.innerHTML = _ckSortBarHtml() +
          '<div class="empty-state"><i class="fas fa-list-check"></i><h4>No Tasks</h4>' +
          '<p>No tasks are scheduled for ' + _fmtDate(date) + '.</p></div>';
        return;
      }

      el.innerHTML = _ckSortBarHtml() + tasks.map(function (t) {
        var isDone = t.status === 'Done';
        var isTransOut = !!(t.is_transferred);
        var isReceived = !!(t.is_received);
        var canDo = !isDone && !isTransOut;
        var isTodayView = (date === _today());
        var canEditRemark = isDone && !isTransOut && isTodayView;

        var actualFmt = t.actual ? _tsShort(t.actual) : '';
        var planFmt = '';
        if (t.scheduled_time && t.planned) {
          planFmt = _fmtDate(t.planned) + ' ' + t.scheduled_time;
        } else if (t.scheduled_time) {
          planFmt = t.scheduled_time;
        }

        var rowId = 'ckrow_' + t.row_num + '_' + Math.random().toString(36).slice(2, 7);
        var sc = _colorForStatus(t.status);
        var rowBorder = isReceived ? 'border-left:3px solid var(--V)' : '';

        var actionBtn = '';
        if (canDo) {
          actionBtn = '<button class="ck-btn btn btn-sm btn-xs" onclick="_markDone(\'' + rowId + '\')"><i class="fas fa-check"></i> Done</button>';
        } else if (canEditRemark) {
          var safeRemark = String(t.remark || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          actionBtn = '<button class="btn btn-outline btn-sm btn-xs" onclick="_editDoneRemark(\'' + rowId + '\',\'' + safeRemark + '\')"><i class="fas fa-pen"></i> Edit remark</button>';
        }

        return '<div class="anim-item" id="' + rowId + '" data-row="' + t.row_num + '" data-occ="' + t.occ +
          '" data-uid="' + _esc(t.task_uid || '') + '" data-planned="' + _esc(t.planned || '') +
          '" data-name="' + _esc(t.task_name || '') + '" data-dt="' + _esc(date) +
          '" style="display:flex;align-items:flex-start;gap:12px;padding:13px 16px;background:var(--sur);border:1px solid var(--bdr);border-radius:12px;margin-bottom:8px;' + rowBorder + '">' +
          '<div class="ck-circle" style="width:24px;height:24px;border-radius:50%;border:2px solid ' + sc +
          ';background:' + (isDone ? sc : 'transparent') +
          ';flex-shrink:0;display:flex;align-items:center;justify-content:center;cursor:' +
          (canDo ? 'pointer' : 'default') + ';margin-top:1px" ' +
          (canDo ? 'onclick="_markDone(\'' + rowId + '\')"' : '') + '>' +
          (isDone ? '<i class="fas fa-check" style="font-size:10px;color:#fff"></i>' : '') +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13.5px;font-weight:700;' +
          (isDone || isTransOut ? 'text-decoration:line-through;color:var(--tx3)' : '') +
          ';word-break:break-word">' + _esc(t.task_name) + '</div>' +
          '<div style="font-size:11px;color:var(--tx3);margin-top:4px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">' +
          _freqBadge(t.frequency) +
          (isTransOut ? '<span style="padding:2px 8px;border-radius:10px;background:var(--Ol);color:var(--O);font-weight:700;font-size:10.5px"><i class="fas fa-share"></i> Transferred away</span>' : '') +
          (isReceived ? '<span style="padding:2px 8px;border-radius:10px;background:var(--Vl);color:var(--V);font-weight:700;font-size:10.5px"><i class="fas fa-arrow-right-arrow-left"></i> Transferred to you</span>' +
            (t.transfer_by ? '<span style="color:var(--tx3);font-size:10.5px"> by ' + _esc(t.transfer_by) + '</span>' : '') : '') +
          (t.remark ? '<span style="padding:2px 8px;border-radius:8px;background:var(--Il);color:var(--I);font-size:10.5px;font-weight:600"><i class="fas fa-comment-dots"></i> ' + _esc(t.remark) + '</span>' : '') +
          '<div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;align-items:center">' +
          (planFmt ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:8px;background:var(--Pl);color:var(--P);font-size:10.5px;font-weight:800"><i class="fas fa-calendar-clock" style="font-size:10px"></i> Plan: <strong>' + _esc(planFmt) + '</strong></span>' : '') +
          (actualFmt
            ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:8px;background:var(--Gl);color:var(--G);font-size:10.5px;font-weight:800"><i class="fas fa-check-circle" style="font-size:10px"></i> Actual: <strong>' + actualFmt + '</strong></span>'
            : (planFmt && !isDone ? '<span style="padding:2px 9px;border-radius:8px;background:var(--sur2);color:var(--tx3);font-size:10.5px;border:1px solid var(--bdr)">Actual: pending</span>' : '')) +
          '</div></div></div>' +
          '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0">' +
          _statusBadge(t.status) + actionBtn +
          '</div></div>';
      }).join('');
    }


    function _editDoneRemark(rowId, currentRemark) {
      var row = document.getElementById(rowId);
      if (!row) return;
      var rowNum = row.dataset.row || '';
      var occ = row.dataset.occ || '0';
      var taskUid = row.dataset.uid || '';
      var taskName = row.dataset.name || '';
      var taskPlanned = row.dataset.planned || '';
      var date = row.dataset.dt || '';

      _openModal(
        '<i class="fas fa-pen" style="color:var(--P)"></i> Edit Remark',
        '<div style="font-size:14px;font-weight:700;margin-bottom:12px;word-break:break-word">' + _esc(taskName) + '</div>' +
        '<div style="font-size:12px;color:var(--tx3);margin-bottom:10px">Sirf aaj complete kiye tasks ka remark change ho sakta hai.</div>' +
        '<label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Remark</label>' +
        '<textarea id="doneRemarkEl" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;background:var(--bg);color:var(--tx);outline:none;resize:vertical;font-family:inherit">' +
        _esc(currentRemark || '') + '</textarea>',
        function () {
          var remark = ((document.getElementById('doneRemarkEl') || {}).value || '').trim();
          _closeModal();
          _gas('markTaskDone', [rowNum, occ, taskUid, taskName, taskPlanned, date, remark], function (r) {
            if (r && r.success === false) {
              _toast('❌ ' + (r.error || 'Update nahi hua'), 'err');
            } else {
              _toast('✅ Remark updated', 'ok');
              _loadToday();
            }
          }, function (e) {
            var msg = (e && e.message) ? e.message : 'Error';
            if (msg.indexOf('DONE_LOCKED') > -1) {
              _toast('⚠️ Sirf aaj ke completed tasks edit ho sakte hain', 'warn');
            } else {
              _toast('❌ ' + msg, 'err');
            }
          });
        },
        '<i class="fas fa-save"></i> Save'
      );
    }

    function _markDone(rowId) {
      var row = document.getElementById(rowId);
      if (!row) return;
      var rowNum = row.dataset.row || '';
      var occ = row.dataset.occ || '0';
      var taskUid = row.dataset.uid || '';
      var taskName = row.dataset.name || '';
      var taskPlanned = row.dataset.planned || '';
      var date = row.dataset.dt || '';

      _openModal(
        '<i class="fas fa-check-circle" style="color:var(--G)"></i> Mark as Done',
        '<div style="font-size:14px;font-weight:700;margin-bottom:12px;word-break:break-word">' + _esc(taskName) + '</div>' +
        '<div style="font-size:12px;color:var(--tx3);margin-bottom:10px">Task is done? Optionally add a completion remark.</div>' +
        '<label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Remark <span style="font-weight:400;text-transform:none">(optional)</span></label>' +
        '<textarea id="doneRemarkEl" rows="3" placeholder="e.g. Completed — stock counted, 3 items found short" style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;background:var(--bg);color:var(--tx);outline:none;resize:vertical;font-family:inherit"></textarea>',
        function () {
          var remark = ((document.getElementById('doneRemarkEl') || {}).value || '').trim();
          _closeModal();

          var circle = row.querySelector('.ck-circle');
          var btn = row.querySelector('.ck-btn');

          // ── Optimistic UI ──────────────────────────────────────
          row.style.opacity = '0.55';
          row.style.pointerEvents = 'none';
          if (circle) {
            circle.style.pointerEvents = 'none';
            circle.classList.add('done');
            circle.innerHTML = '<i class="fas fa-check"></i>';
          }
          if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-check"></i> Done';
          }
          var statusEl = row.querySelector('.ck-status, .status-badge, [data-status]');
          if (statusEl) {
            statusEl.textContent = 'Done';
            statusEl.className = (statusEl.className || '').replace(/pending|open|todo/gi, '') + ' done';
          }

          // Optimistically update local cache so SWR stays correct
          if (Array.isArray(_D.todayTasks)) {
            _D.todayTasks.forEach(function (t) {
              if ((t.task_uid && t.task_uid === taskUid) || (t.task_name === taskName && String(t.planned || '').slice(0, 10) === String(date).slice(0, 10))) {
                t.status = 'Done';
                t.actual = new Date().toISOString();
                t.remark = remark || t.remark || '';
              }
            });
            if (typeof _ckRenderProgress === 'function') _ckRenderProgress(_D.todayTasks);
          }

          _gas('markTaskDone', [rowNum, occ, taskUid, taskName, taskPlanned, date, remark], function (r) {
            if (r && r.success === false) {
              // Rollback
              row.style.opacity = '';
              row.style.pointerEvents = '';
              if (circle) {
                circle.style.pointerEvents = '';
                circle.classList.remove('done');
                circle.innerHTML = '';
              }
              if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check"></i> Done';
              }
              _toast('❌ ' + (r.error || 'Task update nahi hui'), 'err');
              _loadToday();
            } else {
              _toast('✅ Done!', 'ok');
              // Soft refresh so KPIs / sort sync (SWR = instant)
              _loadToday();
            }
          }, function (e) {
            // Rollback on network error
            row.style.opacity = '';
            row.style.pointerEvents = '';
            if (circle) {
              circle.style.pointerEvents = '';
              circle.classList.remove('done');
              circle.innerHTML = '';
            }
            if (btn) {
              btn.disabled = false;
              btn.innerHTML = '<i class="fas fa-check"></i> Done';
            }
            _toast('❌ Error: ' + ((e && e.message) || 'Network error'), 'err');
            _loadToday();
          });
        },
        '<i class="fas fa-check"></i> Mark Done'
      );

      setTimeout(function () {
        var el = document.getElementById('doneRemarkEl');
        if (el) el.focus();
      }, 180);
    }



    function _editDoneRemark(rowId, currentRemark) {
      var row = document.getElementById(rowId);
      if (!row) return;
      var rowNum = row.dataset.row || '';
      var occ = row.dataset.occ || '0';
      var taskUid = row.dataset.uid || '';
      var taskName = row.dataset.name || '';
      var taskPlanned = row.dataset.planned || '';
      var date = row.dataset.dt || '';

      _openModal(
        '<i class="fas fa-pen" style="color:var(--P)"></i> Edit Remark',
        '<div style="font-size:14px;font-weight:700;margin-bottom:12px;word-break:break-word">' + _esc(taskName) + '</div>' +
        '<div style="font-size:12px;color:var(--tx3);margin-bottom:10px">Sirf aaj complete kiye tasks ka remark change ho sakta hai.</div>' +
        '<label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.4px;display:block;margin-bottom:6px">Remark</label>' +
        '<textarea id="doneRemarkEl" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--bdr);border-radius:8px;font-size:13px;background:var(--bg);color:var(--tx);outline:none;resize:vertical;font-family:inherit">' +
        _esc(currentRemark || '') + '</textarea>',
        function () {
          var remark = ((document.getElementById('doneRemarkEl') || {}).value || '').trim();
          _closeModal();
          _gas('markTaskDone', [rowNum, occ, taskUid, taskName, taskPlanned, date, remark], function (r) {
            if (r && r.success === false) {
              _toast('❌ ' + (r.error || 'Update nahi hua'), 'err');
            } else {
              _toast('✅ Remark updated', 'ok');
              _loadToday();
            }
          }, function (e) {
            var msg = e && e.message ? e.message : 'Error';
            if (msg.indexOf('DONE_LOCKED') > -1) {
              _toast('⚠️ Sirf aaj ke completed tasks edit ho sakte hain', 'warn');
            } else {
              _toast('❌ ' + msg, 'err');
            }
          });
        },
        '<i class="fas fa-save"></i> Save'
      );
    }

    function _loadDelMine() {if (typeof _loadDMine === 'function') _loadDMine();}
    function _loadDelOut() {if (typeof _loadDOut === 'function') _loadDOut();}
    function _loadDelAll() {if (typeof _loadDAll === 'function') _loadDAll();}
    function _loadDelCreate() { /* dcr form is static */}
    // Attendance tab aliases — kept for backward compat (switchTab uses them)
    function _loadLeaveReq() {_loadMyLeaveReqs();}
    function _loadLeaveSumm() {_loadLeave();}
    function _loadTeamPerf() { /* Handled in pteam pane */}

    /* ══════════════════════════════════════════════════════════════════════
       INITIALIZATION — Final setup (must be at end of script)
    ══════════════════════════════════════════════════════════════════════ */
    (function init() {
      // Apply saved dark mode on page load
      if (localStorage.getItem('fk_dark') === '1') {
        _dark = true;
        document.body.classList.add('dark');
        var ico = document.getElementById('darkIco');
        if (ico) ico.className = 'fas fa-sun';
      }

      // Apply saved dense layout preference
      if (_store.get('dense', false)) {
        document.body.classList.add('dense');
      }

      console.log('[Joolry Daily v3.0] Initialized. Ready for login.');
      console.log('[Joolry Daily v3.0] Press ? for keyboard shortcuts, ⌘K for search.');
      console.log('[Joolry Daily v3.0] Navigation routes:', _navRoutes.length, 'views registered.');
    }());

    /* ══════════════════════════════════════════════════════════════════════
       EM DASHBOARD — combined Checklist + Delegation + Attendance view
       across all doers. One Plan/Actual pair per module, an overall
       progress bar, and a recent-days completion heatmap, with date
       preset/custom-range, department, employee and sort filters.
       Reuses _gasX/_mkTabs/_mkPanes/.da-kpi/.pbar-wrap/.tw patterns already
       used elsewhere in the app — no other module's code is touched here.
    ══════════════════════════════════════════════════════════════════════ */
    function _vEM() {
      if (!_isManager()) {
        document.getElementById('content').innerHTML =
          '<div class="empty-state"><i class="fas fa-lock"></i><h4>Access Restricted</h4></div>';
        return;
      }
      if (!_D.empDir || !_D.empDir.length) {
        document.getElementById('content').innerHTML =
          '<div class="mod-head"><div><div class="mod-title">EM Dashboard</div></div></div>' + _skel(6);
        _gas('getEmployeeDirectory', [], function (emps) {
          _D.empDir = emps || [];
          _vEMBuild();
        }, function () {_vEMBuild();});
        return;
      }
      _vEMBuild();
    }

    var _emView = 'table'; // 'table' | 'cards' — Summary tab's All Doers display mode

    function _vEMBuild() {
      var at = _ST || 'emsumm';
      var tabs = [
        {id: 'emsumm', lbl: '<i class="fas fa-table-cells-large"></i> Summary'},
        {id: 'emcl', lbl: '<i class="fas fa-list-check"></i> Checklist'},
        {id: 'emdl', lbl: '<i class="fas fa-diagram-project"></i> Delegation <span style="font-size:9px;opacity:.7;font-weight:600">(Due/Shifted)</span>'},
        {id: 'emat', lbl: '<i class="fas fa-user-clock"></i> Attendance'},
        {id: 'emwm', lbl: '<i class="fas fa-handshake"></i> Weekly Meeting'},
        {id: 'emap', lbl: '<i class="fas fa-medal"></i> Increment Appraisal'}
      ];
      var defFrom = _currMonth() + '-01';
      var defTo = _today();

      document.getElementById('content').innerHTML =
        '<div class="mod-head"><div><div class="mod-title">EM Dashboard</div>' +
        '<div class="mod-sub">Checklist + Delegation + Attendance — all doers in one view</div></div></div>' +

        // ── Row 1: Date + Filters ─────────────────────────────────────────────
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;padding:10px 14px;background:var(--sur2);border-radius:12px;border:1px solid var(--bdr)">' +
        '<select id="emPreset" class="ana-sel" style="min-width:110px;max-width:130px" onchange="_emApplyPreset()">' +
        '<option value="month">This Month</option>' +
        '<option value="lastmonth">Last Month</option>' +
        '<option value="quarter">This Quarter</option>' +
        '<option value="year">This Year</option>' +
        '<option value="custom">Custom</option>' +
        '</select>' +
        '<input type="date" id="emFrom" class="ana-sel" style="max-width:130px" value="' + defFrom + '" onchange="_emMarkCustom();_loadEM()">' +
        '<span style="color:var(--tx3);font-size:11px;font-weight:700">→</span>' +
        '<input type="date" id="emTo" class="ana-sel" style="max-width:130px" value="' + defTo + '" onchange="_emMarkCustom();_loadEM()">' +
        '<div style="width:1px;height:24px;background:var(--bdr);flex-shrink:0"></div>' +
        '<div style="min-width:150px;max-width:200px;flex:1">' +
        _ssHtml('emDept', '<option value="all">All Departments</option>' + _getDeptOptions(), 'All Depts', '_loadEM') +
        '</div>' +
        '<div style="min-width:160px;max-width:220px;flex:1">' +
        _ssHtml('emEmp', '<option value="all">All Employees</option>' + _getEmpOptions(), 'All Employees', '_loadEM') +
        '</div>' +
        '<div style="width:1px;height:24px;background:var(--bdr);flex-shrink:0"></div>' +
        '<select id="emHeatDays" class="ana-sel" style="max-width:130px" onchange="_loadEM()">' +
        '<option value="7">Heat: 7d</option>' +
        '<option value="14" selected>Heat: 14d</option>' +
        '<option value="30">Heat: 30d</option>' +
        '</select>' +
        '<button class="btn btn-sm btn-teal" onclick="_loadEM()" style="white-space:nowrap"><i class="fas fa-rotate-right"></i> Refresh</button>' +
        '<button class="btn btn-sm" onclick="_exportEM()" style="white-space:nowrap"><i class="fas fa-file-export"></i> Export</button>' +
        '</div>' +

        // ── Row 2: Search + Performance filters ───────────────────────────────
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:14px">' +
        '<input type="text" id="emSearch" class="ana-sel" placeholder="🔍 Search doer..." oninput="_renderEM()" style="min-width:160px;max-width:200px">' +
        '<select id="emBand" class="ana-sel" style="max-width:180px" onchange="_renderEM()">' +
        '<option value="all">All Performance</option>' +
        '<option value="good">🟢 Good (≥-20%)</option>' +
        '<option value="warn">🟡 Warning (-50 to -21%)</option>' +
        '<option value="crit">🔴 Critical (&lt;-50%)</option>' +
        '</select>' +
        '<select id="emSort" class="ana-sel" style="max-width:170px" onchange="_renderEM()">' +
        '<option value="name">Sort: Name</option>' +
        '<option value="score_asc">Sort: Worst First</option>' +
        '<option value="score_desc">Sort: Best First</option>' +
        '<option value="dept">Sort: Department</option>' +
        '</select>' +
        '<select id="emTopN" class="ana-sel" style="max-width:120px" onchange="_renderEM()">' +
        '<option value="all">Show: All</option>' +
        '<option value="10">Show: Top 10</option>' +
        '<option value="25">Show: Top 25</option>' +
        '<option value="50">Show: Top 50</option>' +
        '</select>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx2);cursor:pointer;white-space:nowrap;padding:0 4px">' +
        '<input type="checkbox" id="emHideZero" onchange="_renderEM()"> Hide zero-activity</label>' +
        '<div style="flex:1"></div>' +
        '<div style="display:flex;gap:3px;background:var(--sur2);border-radius:8px;padding:3px;border:1px solid var(--bdr)">' +
        '<button class="btn btn-sm" id="emViewTableBtn" onclick="_emSetView(\'table\')" style="padding:5px 10px" title="Table view"><i class="fas fa-table"></i></button>' +
        '<button class="btn btn-sm" id="emViewCardsBtn" onclick="_emSetView(\'cards\')" style="padding:5px 10px" title="Cards view"><i class="fas fa-grip"></i></button>' +
        '</div>' +
        '</div>' +

        _mkTabs(tabs, at) +
        _mkPanes(tabs, at, [
          '<div id="emRoot">' + _skel(6) + '</div>',
          '<div id="emClRoot">' + _skel(4) + '</div>',
          '<div id="emDlRoot">' + _skel(4) + '</div>',
          '<div id="emAtRoot">' + _skel(4) + '</div>',
          '<div id="emWmRoot"><div style="padding:8px 0">' + _skel(4) + '</div></div>',
          '<div id="emApRoot"><div style="padding:8px 0">' + _skel(4) + '</div></div>'
        ]);

      _switchTab(at);
      _emRefreshViewBtns();
      if (at === 'emwm') _vEMWeeklyMeeting();
      else if (at === 'emap') _vEMAppraisal();
      else _loadEM();
    }

    function _emMarkCustom() {
      var p = document.getElementById('emPreset');
      if (p) p.value = 'custom';
    }

    function _emApplyPreset() {
      var p = (document.getElementById('emPreset') || {}).value || 'month';
      if (p === 'custom') return;
      var t = new Date();
      function iso(d) {return d.toISOString().slice(0, 10);}
      var from, to = iso(t);
      if (p === 'lastmonth') {
        var lm = new Date(t.getFullYear(), t.getMonth() - 1, 1);
        var lmEnd = new Date(t.getFullYear(), t.getMonth(), 0);
        from = iso(lm); to = iso(lmEnd);
      }
      else if (p === 'quarter') {from = iso(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1));}
      else if (p === 'year') {from = t.getFullYear() + '-01-01';}
      else {from = iso(t).slice(0, 8) + '01';}
      document.getElementById('emFrom').value = from;
      document.getElementById('emTo').value = to;
      _loadEM();
    }

    function _emSetView(v) {
      _emView = v;
      _emRefreshViewBtns();
      if (_D.emData) _renderEMSummary(_D.emData);
    }

    function _emRefreshViewBtns() {
      var tBtn = document.getElementById('emViewTableBtn');
      var cBtn = document.getElementById('emViewCardsBtn');
      if (tBtn) {tBtn.style.background = _emView === 'table' ? 'var(--P)' : ''; tBtn.style.color = _emView === 'table' ? '#fff' : '';}
      if (cBtn) {cBtn.style.background = _emView === 'cards' ? 'var(--P)' : ''; cBtn.style.color = _emView === 'cards' ? '#fff' : '';}
    }

    function _loadEM() {
      var root = document.getElementById('emRoot');
      if (root) root.innerHTML = _skel(6);
      var from = (document.getElementById('emFrom') || {}).value || (_currMonth() + '-01');
      var to = (document.getElementById('emTo') || {}).value || _today();
      var dept = (document.getElementById('emDept') || {}).value || 'all';
      var emp = (document.getElementById('emEmp') || {}).value || 'all';
      var heatDays = parseInt((document.getElementById('emHeatDays') || {}).value, 10) || 14;

      _gasX('getEMDashboard', [{from: from, to: to, dept: dept, empId: emp, heatDays: heatDays}], 45000, function (data) {
        _D.emData = data;
        _renderEM();
      }, function (e) {
        if (root) root.innerHTML =
          '<div class="te"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) +
          '<br><br><button class="btn btn-sm" onclick="_loadEM()"><i class="fas fa-rotate-right"></i> Retry</button></div>';
      });
    }

    // Score: 0 = fully done (good), -100 = nothing done (bad). Negative
    // numbers read as "how far short of 100% complete" — e.g. -35 means
    // 35% of planned work is still outstanding. A doer who somehow exceeds
    // their plan shows a positive score (ahead of target).
    function _emScore(e) {return e.progress - 100;}

    function _emScoreColor(score) {
      return score >= -20 ? 'var(--G)' : score >= -50 ? 'var(--O)' : 'var(--R)';
    }

    function _emScoreBand(score) {
      return score >= -20 ? 'good' : score >= -50 ? 'warn' : 'crit';
    }

    function _emScoreLabel(score) {
      return (score > 0 ? '+' : '') + score + '%';
    }

    // Visual bar fill — represents the shortfall magnitude (0 when score is
    // 0 or positive/no shortfall, up to 100 as score approaches -100).
    function _emBarWidth(score) {
      return Math.min(100, Math.max(0, -score));
    }

    function _emFilteredDoers() {
      var data = _D.emData;
      if (!data || !data.doers) return [];
      var doers = data.doers.slice();

      var q = ((document.getElementById('emSearch') || {}).value || '').toLowerCase().trim();
      if (q) doers = doers.filter(function (e) {return (e.name || '').toLowerCase().indexOf(q) !== -1;});

      var band = (document.getElementById('emBand') || {}).value || 'all';
      if (band !== 'all') doers = doers.filter(function (e) {return _emScoreBand(_emScore(e)) === band;});

      var hideZero = (document.getElementById('emHideZero') || {}).checked;
      if (hideZero) doers = doers.filter(function (e) {return e.total_plan > 0;});

      var sort = (document.getElementById('emSort') || {}).value || 'name';
      if (sort === 'score_asc') doers.sort(function (a, b) {return _emScore(a) - _emScore(b);});        // worst first
      else if (sort === 'score_desc') doers.sort(function (a, b) {return _emScore(b) - _emScore(a);});  // best first
      else if (sort === 'dept') doers.sort(function (a, b) {return a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name);});
      else doers.sort(function (a, b) {return a.name.localeCompare(b.name);});

      var topN = (document.getElementById('emTopN') || {}).value || 'all';
      if (topN !== 'all') doers = doers.slice(0, parseInt(topN, 10));

      return doers;
    }

    // Wrapped name + dept block, used inside table cells and cards alike.
    // No onclick of its own — the containing row/card carries the click so
    // there's only ever one handler, not two competing ones.
    function _emAvatar(emp) {
      return '<div style="display:flex;align-items:flex-start;gap:8px;min-width:150px;max-width:230px">' +
        '<div class="da-emp-avatar" style="background:var(--Pl);color:var(--P);flex-shrink:0">' + _esc((emp.name || '?').charAt(0).toUpperCase()) + '</div>' +
        '<div style="min-width:0;overflow:hidden">' +
        '<div style="font-weight:700;white-space:normal;word-break:break-word;overflow-wrap:break-word;line-height:1.3;color:var(--P)">' + _esc(emp.name) + '</div>' +
        '<div style="font-size:10px;color:var(--tx3);white-space:normal;word-break:break-word;overflow-wrap:break-word">' + _esc(emp.dept) + '</div>' +
        '</div></div>';
    }

    function _emKpiStrip(cards) {
      return '<div class="da-kpi-strip">' + cards.map(function (k) {
        return '<div class="da-kpi">' +
          '<div class="da-kpi-row1"><div class="da-kpi-ico" style="--kc:' + k.c + '"><i class="fas ' + k.ico + '"></i></div>' +
          '<div class="da-kpi-val" style="color:' + k.c + '">' + k.val + '</div></div>' +
          '<div class="da-kpi-lbl">' + k.lbl + '</div>' +
          '<div class="da-kpi-sub">' + k.sub + '</div></div>';
      }).join('') + '</div>';
    }

    function _renderEM() {
      var data = _D.emData;
      if (!data) {_loadEM(); return;}
      _renderEMSummary(data);
      _renderEMModule('cl', data);
      _renderEMModule('dl', data);
      _renderEMModule('at', data);
    }

    function _fmtAttTime(hhmm, fullTs) {
      // Prefer clean HH:mm from backend
      if (hhmm && /^\d{1,2}:\d{2}/.test(String(hhmm))) {
        return String(hhmm).slice(0, 5) + ' IST';
      }
      // fullTs: "yyyy-MM-dd HH:mm:ss" (backend) OR legacy "dd-MM-yyyy HH:mm:ss"
      if (fullTs && String(fullTs).length >= 16) {
        var parts = String(fullTs).trim().split(/\s+/);
        if (parts.length >= 2) {
          var dp = parts[0].split('-');
          var timePart = parts[1].slice(0, 5); // HH:mm
          var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          var day, mo, yr;
          if (dp[0].length === 4) {
            // yyyy-MM-dd
            yr = dp[0]; mo = months[parseInt(dp[1], 10) - 1] || dp[1]; day = dp[2];
          } else {
            // dd-MM-yyyy
            day = dp[0]; mo = months[parseInt(dp[1], 10) - 1] || dp[1]; yr = dp[2];
          }
          return day + ' ' + mo + ' ' + yr + ', ' + timePart + ' IST';
        }
      }
      return hhmm || '—';
    }


    function _renderEMSummary(data) {
      var root = document.getElementById('emRoot');
      if (!root || !data) return;
      var t = data.totals;
      var doers = _emFilteredDoers();
      var heatDates = data.heat_dates || [];
      var scoreTotal = t.overall_pct - 100;

      var h = '<div style="font-size:12px;color:var(--tx3);font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<i class="fas fa-calendar-week"></i> ' + _fmtDate(data.from) + ' &rarr; ' + _fmtDate(data.to) +
        (data.filters && data.filters.dept !== 'all' ? ' &middot; <span style="color:var(--P)">' + _esc(data.filters.dept) + '</span>' : '') +
        ' &middot; <span>' + doers.length + ' doer' + (doers.length === 1 ? '' : 's') + ' shown</span>' +
        '</div>';

      h += _emKpiStrip([
        {lbl: 'Total Plan', val: t.total_plan, c: 'var(--P)', ico: 'fa-clipboard-list', sub: 'Checklist + Delegation + Attendance'},
        {lbl: 'Total Actual', val: t.total_actual, c: 'var(--G)', ico: 'fa-circle-check', sub: t.overall_pct + '% done'},
        {lbl: 'Checklist Plan', val: t.cl_plan, c: 'var(--V)', ico: 'fa-list-check', sub: (t.cl_plan - t.cl_actual) + ' pending of ' + t.cl_plan},
        {lbl: 'Delegation Plan', val: t.dl_plan, c: 'var(--T)', ico: 'fa-diagram-project', sub: (t.dl_plan - t.dl_actual) + ' pending of ' + t.dl_plan},
        {lbl: 'Attendance Plan', val: t.at_plan, c: 'var(--O)', ico: 'fa-user-clock', sub: (t.at_plan - t.at_actual) + ' absent of ' + t.at_plan},
        {lbl: 'Score', val: _emScoreLabel(scoreTotal), c: _emScoreColor(scoreTotal), ico: 'fa-gauge-high', sub: '0% = fully done'}
      ]);

      if (doers.length === 0) {
        h += '<div class="empty-state" style="padding:24px;margin-top:16px"><i class="fas fa-inbox"></i><p>No doers match these filters.</p></div>';
        root.innerHTML = h;
        return;
      }

      if (_emView === 'cards') {
        h += '<div class="da-emp-cards" style="margin-top:16px">' +
          doers.map(function (e) {
            var score = _emScore(e);
            var c2 = _emScoreColor(score);
            return '<div class="card card-nohover" style="cursor:pointer" onclick="_emShowDoerDetail(\'' + _esc(e.emp_id) + '\')">' +
              _emAvatar(e) +
              '<div style="display:grid;grid-template-columns:' + (e.need_att !== false ? '1fr 1fr 1fr' : '1fr 1fr') + ';gap:6px;font-size:11px;text-align:center;margin:12px 0">' +
              '<div><div style="color:var(--tx3)">Checklist</div><div style="font-weight:800">' + e.cl_actual + '/' + e.cl_plan + '</div></div>' +
              '<div><div style="color:var(--tx3)">Delegation</div><div style="font-weight:800">' + e.dl_actual + '/' + e.dl_plan + '</div></div>' +
              (e.need_att !== false ? '<div><div style="color:var(--tx3)">Attendance</div><div style="font-weight:800">' + e.at_actual + '/' + e.at_plan + '</div></div>' : '') +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:6px"><div class="pbar-wrap" style="flex:1"><div class="pbar" style="width:' + _emBarWidth(score) + '%;background:' + c2 + '"></div></div><span style="font-size:11px;font-weight:800;color:' + c2 + ';white-space:nowrap">' + _emScoreLabel(score) + '</span></div>' +
              '</div>';
          }).join('') +
          '</div>';
        root.innerHTML = h;
        return;
      }

      h += '<div class="card card-nohover" style="margin-top:16px">' +
        '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-users" style="color:var(--P)"></i> All Doers &mdash; Checklist + Delegation + Attendance' +
        '<span style="font-size:10px;color:var(--tx3);font-weight:600;margin-left:8px">Heatmap: last ' + heatDates.length + ' days &middot; 0% = fully done, -100% = nothing done &middot; click a doer for details</span></div>' +
        '<div class="tw"><table><thead><tr>' +
        '<th>#</th><th style="min-width:160px">Doer</th>' +
        '<th style="text-align:center">CL Plan</th><th style="text-align:center">CL Actual</th>' +
        '<th style="text-align:center">DL Plan</th><th style="text-align:center">DL Actual</th>' +
        '<th style="text-align:center">Att Plan</th><th style="text-align:center">Att Actual</th>' +
        '<th>Score</th>' +
        heatDates.map(function (dt) {return '<th class="em-heat-col" style="text-align:center;font-size:10px">' + _esc(_fmtDateShort(dt)) + '</th>';}).join('') +
        '</tr></thead><tbody>' +
        doers.map(function (e, i) {
          var score = _emScore(e);
          var c2 = _emScoreColor(score);
          return '<tr style="cursor:pointer" onclick="_emShowDoerDetail(\'' + _esc(e.emp_id) + '\')">' +
            '<td style="color:var(--tx3)">' + (i + 1) + '</td>' +
            '<td>' + _emAvatar(e) + '</td>' +
            '<td style="text-align:center">' + e.cl_plan + '</td><td style="text-align:center;color:var(--G);font-weight:700">' + e.cl_actual + '</td>' +
            '<td style="text-align:center">' + e.dl_plan + '</td><td style="text-align:center;color:var(--G);font-weight:700">' + e.dl_actual + '</td>' +
            (e.need_att !== false
              ? '<td style="text-align:center">' + e.at_plan + '</td><td style="text-align:center;color:var(--G);font-weight:700">' + e.at_actual + '</td>'
              : '<td style="text-align:center;color:var(--tx3)">—</td><td style="text-align:center;color:var(--tx3)">—</td>') +
            '<td><div style="display:flex;align-items:center;gap:6px"><div class="pbar-wrap" style="width:60px"><div class="pbar" style="width:' + _emBarWidth(score) + '%;background:' + c2 + '"></div></div><span style="font-size:11px;font-weight:800;color:' + c2 + '">' + _emScoreLabel(score) + '</span></div></td>' +
            e.heat.map(function (hd) {
              var clr = hd.label === '—' ? 'var(--tx3)' : hd.label === '-' ? 'var(--R)' : hd.label === 'OK' ? 'var(--G)' : 'var(--O)';
              var bg = hd.label === '—' ? 'transparent' : hd.label === '-' ? 'var(--Rl)' : hd.label === 'OK' ? 'var(--Gl)' : 'var(--Ol)';
              return '<td class="em-heat-col" style="text-align:center"><span style="display:inline-block;padding:2px 6px;border-radius:5px;font-size:10px;font-weight:700;background:' + bg + ';color:' + clr + '">' + _esc(hd.label) + '</span></td>';
            }).join('') +
            '</tr>';
        }).join('') +
        '</tbody></table></div>' +
        '</div>';

      root.innerHTML = h;
    }

    function _renderEMModule(mod, data) {
      var rootId = mod === 'cl' ? 'emClRoot' : mod === 'dl' ? 'emDlRoot' : 'emAtRoot';
      var root = document.getElementById(rootId);
      if (!root || !data) return;
      var planKey = mod + '_plan', actKey = mod + '_actual';
      var title = mod === 'cl' ? 'Checklist' : mod === 'dl' ? 'Delegation' : 'Attendance';
      var ico = mod === 'cl' ? 'fa-list-check' : mod === 'dl' ? 'fa-diagram-project' : 'fa-user-clock';
      var doers = _emFilteredDoers();

      // For Attendance tab: exclude employees who don't need attendance tracking
      if (mod === 'at') {
        doers = doers.filter(function (e) {return e.need_att !== false;});
      }

      var totalPlan = doers.reduce(function (s, e) {return s + e[planKey];}, 0);
      var totalAct = doers.reduce(function (s, e) {return s + e[actKey];}, 0);
      var pct = totalPlan > 0 ? Math.round((totalAct / totalPlan) * 100) : 100;
      var score = pct - 100;

      var h = _emKpiStrip([
        {lbl: title + ' Plan', val: totalPlan, c: 'var(--P)', ico: ico, sub: 'Total in selected range'},
        {lbl: title + ' Actual', val: totalAct, c: 'var(--G)', ico: 'fa-circle-check', sub: (mod === 'at' ? 'Present days' : 'Completed')},
        {lbl: 'Score', val: _emScoreLabel(score), c: _emScoreColor(score), ico: 'fa-gauge-high', sub: '0% = fully done'}
      ]);

      h += '<div class="card card-nohover" style="margin-top:16px">' +
        '<div class="sec-title" style="margin-bottom:12px"><i class="fas ' + ico + '" style="color:var(--P)"></i> ' + title + ' &mdash; by Doer <span style="font-size:10px;color:var(--tx3);font-weight:600;margin-left:6px">click a doer for the task list</span></div>' +
        '<div class="tw"><table><thead><tr><th>#</th><th style="min-width:160px">Doer</th><th style="text-align:center">Plan</th><th style="text-align:center">Actual</th><th style="text-align:center">' + (mod === 'at' ? 'Absent' : 'Pending') + '</th><th>Score</th></tr></thead><tbody>' +
        doers.map(function (e, i) {
          var plan = e[planKey], act = e[actKey];
          var p = plan > 0 ? Math.round((act / plan) * 100) : 100;
          var sc = p - 100;
          var c2 = _emScoreColor(sc);
          return '<tr style="cursor:pointer" onclick="_emShowModuleDetail(\'' + _esc(e.emp_id) + '\',\'' + mod + '\')">' +
            '<td style="color:var(--tx3)">' + (i + 1) + '</td>' +
            '<td>' + _emAvatar(e) + '</td>' +
            '<td style="text-align:center">' + plan + '</td>' +
            '<td style="text-align:center;color:var(--G);font-weight:700">' + act + '</td>' +
            '<td style="text-align:center;color:var(--R);font-weight:700">' + (plan - act) + '</td>' +
            '<td><div style="display:flex;align-items:center;gap:6px"><div class="pbar-wrap" style="width:60px"><div class="pbar" style="width:' + _emBarWidth(sc) + '%;background:' + c2 + '"></div></div><span style="font-size:11px;font-weight:800;color:' + c2 + '">' + _emScoreLabel(sc) + '</span></div></td>' +
            '</tr>';
        }).join('') +
        '</tbody></table></div>' +
        (doers.length === 0 ? '<div class="empty-state" style="padding:24px"><i class="fas fa-inbox"></i><p>No doers match these filters.</p></div>' : '') +
        '</div>';

      root.innerHTML = h;
    }

    // Click-through detail popup for a single doer — reuses the already-
    // fetched _D.emData (no extra backend call), shown in the wide modal
    // with everything wrapped so long names/departments never overflow.
    function _emShowDoerDetail(empId) {
      var data = _D.emData;
      if (!data || !data.doers) return;
      var e = null;
      for (var i = 0; i < data.doers.length; i++) {if (data.doers[i].emp_id === empId) {e = data.doers[i]; break;} }
      if (!e) return;

      var scCl = e.cl_plan > 0 ? Math.round((e.cl_actual / e.cl_plan) * 100) - 100 : 0;
      var scDl = e.dl_plan > 0 ? Math.round((e.dl_actual / e.dl_plan) * 100) - 100 : 0;
      var scAt = e.at_plan > 0 ? Math.round((e.at_actual / e.at_plan) * 100) - 100 : 0;
      var scTotal = _emScore(e);

      function row(lbl, ico, plan, act, score, color, modKey) {
        return '<div onclick="_emShowModuleDetail(\'' + _esc(empId) + '\',\'' + modKey + '\')" style="cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg);border:1px solid var(--bdr);border-radius:8px;margin-bottom:8px">' +
          '<div class="da-kpi-ico" style="--kc:' + color + '"><i class="fas ' + ico + '"></i></div>' +
          '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:700;font-size:13px;white-space:normal;word-break:break-word">' + lbl + ' <i class="fas fa-chevron-right" style="font-size:9px;color:var(--tx3)"></i></div>' +
          '<div style="font-size:11px;color:var(--tx3);white-space:normal;word-break:break-word">' + act + ' done of ' + plan + ' &middot; ' + (plan - act) + ' pending &middot; tap for task list</div>' +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0">' +
          '<div style="font-weight:900;font-size:15px;color:' + _emScoreColor(score) + '">' + _emScoreLabel(score) + '</div>' +
          '<div style="font-size:9px;color:var(--tx3);white-space:nowrap">score</div>' +
          '</div></div>';
      }

      var modal = document.getElementById('modal');
      if (modal) modal.className = 'modal-box wide';

      var body = '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--bdr);flex-wrap:wrap">' +
        '<div class="da-emp-avatar" style="background:var(--Pl);color:var(--P);width:48px;height:48px;font-size:18px;flex-shrink:0">' + _esc((e.name || '?').charAt(0).toUpperCase()) + '</div>' +
        '<div style="min-width:0;flex:1">' +
        '<div style="font-weight:800;font-size:16px;white-space:normal;word-break:break-word;overflow-wrap:break-word">' + _esc(e.name) + '</div>' +
        '<div style="font-size:12px;color:var(--tx3);white-space:normal;word-break:break-word;overflow-wrap:break-word">' + _esc(e.dept) + '</div>' +
        '</div>' +
        '<div style="text-align:center;flex-shrink:0">' +
        '<div style="font-weight:900;font-size:20px;color:' + _emScoreColor(scTotal) + '">' + _emScoreLabel(scTotal) + '</div>' +
        '<div style="font-size:9px;color:var(--tx3);white-space:nowrap">overall score</div>' +
        '</div></div>' +

        row('Checklist', 'fa-list-check', e.cl_plan, e.cl_actual, scCl, 'var(--V)', 'cl') +
        row('Delegation', 'fa-diagram-project', e.dl_plan, e.dl_actual, scDl, 'var(--T)', 'dl') +
        (e.need_att !== false ? row('Attendance', 'fa-user-clock', e.at_plan, e.at_actual, scAt, 'var(--O)', 'at') : '') +

        '<div style="margin-top:16px">' +
        '<div style="font-weight:700;font-size:12px;color:var(--tx2);margin-bottom:8px"><i class="fas fa-calendar-days"></i> Daily Activity (last ' + e.heat.length + ' days)</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
        e.heat.map(function (hd) {
          var clr = hd.label === '—' ? 'var(--tx3)' : hd.label === '-' ? 'var(--R)' : hd.label === 'OK' ? 'var(--G)' : 'var(--O)';
          var bg = hd.label === '—' ? 'transparent' : hd.label === '-' ? 'var(--Rl)' : hd.label === 'OK' ? 'var(--Gl)' : 'var(--Ol)';
          return '<div style="text-align:center;min-width:48px">' +
            '<div style="font-size:9px;color:var(--tx3);margin-bottom:2px;white-space:nowrap">' + _esc(_fmtDateShort(hd.date)) + '</div>' +
            '<div style="padding:4px 6px;border-radius:6px;font-size:11px;font-weight:700;background:' + bg + ';color:' + clr + '">' + _esc(hd.label) + '</div>' +
            '</div>';
        }).join('') +
        '</div></div>';

      _openModal('<i class="fas fa-user-chart" style="color:var(--P)"></i> Doer Details', body, null, null, true);
      setTimeout(function () {
        var foot = document.getElementById('mFoot');
        if (foot) foot.innerHTML = '<button class="btn" onclick="_closeModal()"><i class="fas fa-times"></i> Close</button>';
      }, 30);
    }

    // Drill-down popup: the actual task/delegation/attendance records behind
    // one doer's module summary, each showing the date it happened on.
    // Fetched on demand (not part of the main dashboard load).
    function _emShowModuleDetail(empId, module) {
      var modal = document.getElementById('modal');
      if (modal) modal.className = 'modal-box wide';
      _openModal('<i class="fas fa-circle-notch fa-spin"></i> Loading...', _skel(3), null, null, true);
      setTimeout(function () {
        var foot = document.getElementById('mFoot');
        if (foot) foot.innerHTML = '<button class="btn btn-outline" onclick="_emShowDoerDetail(\'' + _esc(empId) + '\')"><i class="fas fa-arrow-left"></i> Back</button>' +
          '<button class="btn" onclick="_closeModal()"><i class="fas fa-times"></i> Close</button>';
      }, 30);

      var from = (document.getElementById('emFrom') || {}).value || (_currMonth() + '-01');
      var to = (document.getElementById('emTo') || {}).value || _today();

      _gas('getEMDoerDetail', [{empId: empId, module: module, from: from, to: to}], function (res) {
        _emRenderModuleDetail(res);
      }, function (e) {
        var bEl = document.getElementById('mBody');
        if (bEl) bEl.innerHTML = '<div class="te"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) + '</div>';
      });
    }

    function _emRenderModuleDetail(res) {
      var titleMap = {cl: 'Checklist', dl: 'Delegation', at: 'Attendance'};
      var icoMap = {cl: 'fa-list-check', dl: 'fa-diagram-project', at: 'fa-user-clock'};
      var title = titleMap[res.module] || 'Details';
      var ico = icoMap[res.module] || 'fa-circle-info';

      var tEl = document.getElementById('mTitle');
      if (tEl) tEl.innerHTML = '<i class="fas ' + ico + '" style="color:var(--P)"></i> ' + _esc(res.name) + ' &mdash; ' + title;

      var body = '<div style="font-size:11px;color:var(--tx3);margin-bottom:14px">' +
        _fmtDate(res.from) + ' &rarr; ' + _fmtDate(res.to) + ' &middot; ' + res.items.length + ' record' + (res.items.length === 1 ? '' : 's') +
        '</div>';

      if (!res.items.length) {
        body += '<div class="empty-state" style="padding:20px"><i class="fas fa-inbox"></i><p>No records in this range.</p></div>';
      } else if (res.module === 'at') {
        // Shared attendance-status badge builder for this popup
        function attBadge(status, hoursShort, parsedHours, fullThresh) {
          // 3-tier HD color coding:
          // HD with <40% hours worked = red-orange (very short)
          // HD with 40-75% = orange (normal half day)
          // Full day (P) = green
          var clr, bg, lbl;
          if (status === 'P') {
            clr = 'var(--G)'; bg = 'var(--Gl)'; lbl = 'Present';
          } else if (status === 'HD') {
            // If hoursShort exists and is severe (>60% missing), use red-orange
            var shortFrac = (hoursShort && fullThresh) ? hoursShort / (fullThresh / 0.75) : 0;
            if (shortFrac > 0.6) {clr = '#dc6803'; bg = '#fef3c7'; lbl = 'Short Day';}
            else {clr = 'var(--O)'; bg = 'var(--Ol)'; lbl = 'Half Day';}
          } else if (status === 'A') {
            clr = 'var(--R)'; bg = 'var(--Rl)'; lbl = 'Absent';
          } else if (status === 'H') {
            clr = '#4338ca'; bg = '#e0e7ff'; lbl = 'Holiday';
          } else if (status === 'WO') {
            clr = 'var(--tx3)'; bg = 'var(--sur2)'; lbl = 'Week Off';
          } else {
            clr = 'var(--tx3)'; bg = 'var(--sur2)'; lbl = status || '—';
          }
          var badge = '<span style="padding:3px 8px;border-radius:6px;font-size:10px;font-weight:800;background:' + bg + ';color:' + clr + ';white-space:nowrap">' + _esc(lbl) + '</span>';
          // Append hours-short warning if HD
          if (status === 'HD' && hoursShort && hoursShort > 0) {
            var h = Math.floor(hoursShort), m = Math.round((hoursShort - h) * 60);
            var shortStr = (h > 0 ? h + 'h ' : '') + (m > 0 ? m + 'm' : '').trim() + ' short';
            badge += ' <span style="font-size:9px;font-weight:700;color:' + clr + ';opacity:.8">' + shortStr + '</span>';
          }
          return badge;
        }

        var present = 0, halfDay = 0, absent = 0;
        res.items.forEach(function (it) {
          if (it.status === 'P') present++;
          else if (it.status === 'HD') halfDay++;
          else if (it.status === 'A') absent++;
        });
        body += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;padding:10px;background:var(--sur2);border-radius:8px">' +
          '<span style="font-size:12px;color:var(--G);font-weight:700"><i class="fas fa-circle-check"></i> Present: ' + present + '</span>' +
          '<span style="font-size:12px;color:var(--O);font-weight:700"><i class="fas fa-circle-half-stroke"></i> Half Day: ' + halfDay + '</span>' +
          '<span style="font-size:12px;color:var(--R);font-weight:700"><i class="fas fa-circle-xmark"></i> Absent: ' + absent + '</span>' +
          '</div>';

        body += '<div style="display:flex;flex-direction:column;gap:6px">' +
          res.items.map(function (it) {
            var isActual = (it.status === 'P' || it.status === 'HD');
            // Only show check-in/out for days where attendance was actually recorded
            // — synthesised absent rows always have '-' which is truthy in JS, so
            // the old code showed "In: - · Out: - · -" making them look like real data
            var timeInfo = '';
            if (isActual) {
              var hasIn = it.check_in && it.check_in !== '-';
              var hasOut = it.check_out && it.check_out !== '-';
              var parts = [];
              if (hasIn) parts.push('<span style="color:var(--G);font-weight:700"><i class="fas fa-sign-in-alt"></i> ' + _esc(it.check_in) + '</span>');
              if (hasOut) parts.push('<span style="color:var(--R);font-weight:700"><i class="fas fa-sign-out-alt"></i> ' + _esc(it.check_out) + '</span>');
              if (it.hours && it.hours !== '-') parts.push('<span style="color:var(--P)"><i class="fas fa-clock"></i> ' + _esc(String(it.hours)) + '</span>');
              timeInfo = parts.length ? '<div style="font-size:11px;display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">' + parts.join('') + '</div>' : '';
            } else if (it.status === 'A') {
              timeInfo = '<div style="font-size:10px;color:var(--tx3);margin-top:2px;font-style:italic">No attendance recorded</div>';
            }
            return '<div style="padding:9px 10px;background:var(--bg);border:1px solid var(--bdr);border-left:3px solid ' + (it.status === 'P' ? 'var(--G)' : it.status === 'HD' ? (it.hours_short && it.hours_short > 2 ? '#dc6803' : 'var(--O)') : 'var(--R)') + ';border-radius:8px">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<span style="font-size:12px;font-weight:700">' + _esc(_fmtDateShort(it.date)) + '</span>' +
              attBadge(it.status, it.hours_short, it.parsed_hours, it.full_day_thresh_hrs) +
              '</div>' +
              timeInfo +
              '</div>';
          }).join('') +
          '</div>';
      } else {
        body += '<div style="display:flex;flex-direction:column;gap:6px">' +
          res.items.map(function (it) {
            var clr = it.done ? 'var(--G)' : 'var(--O)';
            var bg = it.done ? 'var(--Gl)' : 'var(--Ol)';
            var dateLabel = res.module === 'dl'
              ? ('Due: ' + _esc(_fmtDateShort(it.due)) + (it.date && it.date !== it.due ? ' &middot; Assigned: ' + _esc(_fmtDateShort(it.date)) : ''))
              : ('Planned: ' + _esc(_fmtDateShort(it.date)) + (it.actual ? ' &middot; Done on: ' + _esc(_fmtDateShort(it.actual)) : ''));
            var extra = res.module === 'dl' ? ('By: ' + _esc(it.by || '—')) : ('Freq: ' + _esc(it.freq || 'D'));
            return '<div style="padding:10px;background:var(--bg);border:1px solid var(--bdr);border-radius:8px">' +
              '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">' +
              '<div style="font-weight:700;font-size:12.5px;white-space:normal;word-break:break-word;overflow-wrap:break-word;flex:1;min-width:120px">' + _esc(it.task) + '</div>' +
              '<span style="padding:3px 8px;border-radius:6px;font-size:10px;font-weight:800;background:' + bg + ';color:' + clr + ';white-space:nowrap;flex-shrink:0">' + _esc(it.status) + '</span>' +
              '</div>' +
              '<div style="font-size:10.5px;color:var(--tx3);margin-top:4px;white-space:normal;word-break:break-word">' + dateLabel + ' &middot; ' + extra + '</div>' +
              '</div>';
          }).join('') +
          '</div>';
      }

      var bEl = document.getElementById('mBody');
      if (bEl) bEl.innerHTML = body;
    }

    /* ══════════════════════════════════════════════════════════════════════
       EM WEEKLY MEETING — Monday meeting recorder + commitment tracker
       Left: Record form (auto-populates score from current EM data)
       Right: History with Mark Met/Not Met, increment tracking
    ══════════════════════════════════════════════════════════════════════ */
    function _vEMWeeklyMeeting() {
      var root = document.getElementById('emWmRoot');
      if (!root) return;

      // If EM data isn't loaded yet (user went directly to Weekly Meeting tab
      // without visiting Summary first), auto-load it now so module scores
      // can be auto-populated once an employee is selected.
      if (!_D.emData) {
        var from = (document.getElementById('emFrom') || {}).value || (_currMonth() + '-01');
        var to = (document.getElementById('emTo') || {}).value || _today();
        var dept = (document.getElementById('emDept') || {}).value || 'all';
        var hd = parseInt((document.getElementById('emHeatDays') || {}).value, 10) || 14;
        root.innerHTML = '<div style="padding:20px;text-align:center;color:var(--tx3)">' +
          '<i class="fas fa-circle-notch fa-spin" style="font-size:22px;color:var(--P)"></i>' +
          '<div style="margin-top:10px;font-weight:600">Loading scores for the selected period…</div></div>';
        _gasX('getEMDashboard', [{from: from, to: to, dept: dept, empId: 'all', heatDays: hd}], 45000, function (data) {
          _D.emData = data;
          _vEMWeeklyMeeting(); // re-render now that data is ready
        }, function (e) {
          root.innerHTML = '<div class="te"><i class="fas fa-exclamation-triangle"></i> Could not load scores: ' + _esc(e.message) +
            '<br><br><button class="btn btn-sm" onclick="_vEMWeeklyMeeting()"><i class="fas fa-rotate-right"></i> Retry</button></div>';
        });
        return;
      }

      // Calculate last week's date range (Mon-Sun)
      var now = new Date();
      var dow = now.getDay();
      var lastMon = new Date(now); lastMon.setDate(now.getDate() - (dow === 0 ? 13 : dow + 6));
      var lastSun = new Date(lastMon); lastSun.setDate(lastMon.getDate() + 6);
      function iso(d) {return d.toISOString().slice(0, 10);}
      var lFrom = iso(lastMon), lTo = iso(lastSun);

      root.innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start">' +

        // ── RECORD FORM ──────────────────────────────────────────────────
        '<div class="card card-nohover">' +
        '<div class="sec-title" style="margin-bottom:16px"><i class="fas fa-handshake" style="color:var(--P)"></i> Record Monday Meeting</div>' +

        '<div style="display:flex;flex-direction:column;gap:12px">' +

        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Meeting Date</label>' +
        '<input type="date" id="wmMeetDate" class="ana-sel" value="' + iso(now) + '" style="width:100%"></div>' +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Week From</label>' +
        '<input type="date" id="wmWkFrom" class="ana-sel" value="' + lFrom + '" style="width:100%"></div>' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Week To</label>' +
        '<input type="date" id="wmWkTo" class="ana-sel" value="' + lTo + '" style="width:100%"></div>' +
        '</div>' +

        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Employee</label>' +
        _ssHtml('wmEmp', '<option value="">— Select Employee —</option>' + _getEmpOptions(), '— Select Employee —', '_wmPopulateScore') + '</div>' +

        '<div id="wmScorePreview" style="display:none;padding:12px;border-radius:10px;background:var(--sur2);border:1px solid var(--bdr)">' +
        '<div style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;margin-bottom:6px">Last Score (from current EM data)</div>' +
        '<div id="wmScoreDisplay" style="font-size:22px;font-weight:900"></div>' +
        '<div id="wmScoreBreakdown" style="font-size:11px;color:var(--tx3);margin-top:4px"></div>' +
        '</div>' +

        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Commitment for Next Week<span style="color:var(--tx3);font-weight:600;text-transform:none"> (0=best, -100=worst)</span></label>' +
        '<input type="number" id="wmCommitScore" class="ana-sel" min="-100" max="0" placeholder="e.g. -10" style="width:100%"></div>' +

        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">What will you do differently?</label>' +
        '<textarea id="wmCommitDetails" class="ana-sel" rows="3" placeholder="Employee\'s specific commitment (e.g. will complete all daily tasks before 6pm, will not miss attendance)" style="width:100%;resize:vertical"></textarea></div>' +

        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Manager Notes</label>' +
        '<textarea id="wmManagerNotes" class="ana-sel" rows="2" placeholder="Your observations from this meeting" style="width:100%;resize:vertical"></textarea></div>' +

        '<button class="btn btn-wide" id="btnWmSave" onclick="_wmSave()" style="margin-top:4px">' +
        '<i class="fas fa-floppy-disk"></i> Save Commitment Record</button>' +
        '</div></div>' +

        // ── HISTORY + FILTERS ─────────────────────────────────────────────
        '<div>' +
        '<div class="card card-nohover" style="margin-bottom:14px">' +
        '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-clock-rotate-left" style="color:var(--V)"></i> Commitment History</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
        '<select id="wmHistEmp" class="ana-sel" onchange="_wmLoadHistory()">' +
        '<option value="all">All Employees</option>' + _getEmpOptions() + '</select>' +
        '<select id="wmHistDept" class="ana-sel" onchange="_wmLoadHistory()">' +
        '<option value="all">All Departments</option>' + _getDeptOptions() + '</select>' +
        '<select id="wmHistStatus" class="ana-sel" onchange="_wmLoadHistory()">' +
        '<option value="all">All Status</option>' +
        '<option value="Pending">⏳ Pending</option>' +
        '<option value="Met">✅ Met</option>' +
        '<option value="Partial">🔶 Partial</option>' +
        '<option value="Not Met">❌ Not Met</option>' +
        '</select>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">' +
        '<div style="display:flex;align-items:center;gap:6px"><label style="font-size:11px;font-weight:700;color:var(--tx3);white-space:nowrap">From</label>' +
        '<input type="date" id="wmHistFrom" class="ana-sel" onchange="_wmLoadHistory()" style="min-width:130px"></div>' +
        '<div style="display:flex;align-items:center;gap:6px"><label style="font-size:11px;font-weight:700;color:var(--tx3);white-space:nowrap">To</label>' +
        '<input type="date" id="wmHistTo" class="ana-sel" onchange="_wmLoadHistory()" style="min-width:130px"></div>' +
        '<button class="btn btn-sm" onclick="_wmClearFilters()"><i class="fas fa-filter-circle-xmark"></i> Clear</button>' +
        '<button class="btn btn-sm" onclick="_wmLoadHistory()"><i class="fas fa-rotate-right"></i></button>' +
        '</div>' +
        '<div id="wmHistList">' + _skel(3, 'sk-h5') + '</div>' +
        '</div>' +
        '</div>' +

        '</div>'; // grid

      _wmLoadHistory();
    }

    function _wmPopulateScore() {
      var empId = (document.getElementById('wmEmp') || {}).value;
      var preview = document.getElementById('wmScorePreview');
      var scoreEl = document.getElementById('wmScoreDisplay');
      var brkEl = document.getElementById('wmScoreBreakdown');
      if (!empId) {if (preview) preview.style.display = 'none'; return;}
      if (!_D.emData || !_D.emData.doers) {
        if (preview) {preview.style.display = ''; preview.innerHTML = '<div style="color:var(--tx3);font-size:12px"><i class="fas fa-circle-notch fa-spin"></i> Loading scores…</div>';}
        return;
      }

      var doer = null;
      for (var i = 0; i < _D.emData.doers.length; i++) {
        if (_D.emData.doers[i].emp_id === empId) {doer = _D.emData.doers[i]; break;}
      }
      if (!doer) {if (preview) preview.style.display = 'none'; return;}

      function modSc(plan, actual) {return plan > 0 ? Math.round((actual / plan * 100) - 100) : null;}
      var overall = _emScore(doer);
      var clSc = modSc(doer.cl_plan, doer.cl_actual);
      var dlSc = modSc(doer.dl_plan, doer.dl_actual);
      var atSc = modSc(doer.at_plan, doer.at_actual);

      if (preview) {
        preview.style.display = '';
        preview.innerHTML =
          '<div style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Score for selected period (from EM data)</div>' +
          '<div style="font-size:28px;font-weight:900;color:' + _emScoreColor(overall) + ';margin-bottom:10px">' + _emScoreLabel(overall) + ' overall</div>' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' +
          ['Checklist', 'Delegation', 'Attendance'].map(function (lbl, i) {
            var sc = [clSc, dlSc, atSc][i];
            var ico = ['fa-list-check', 'fa-diagram-project', 'fa-user-clock'][i];
            var clr = sc !== null ? _emScoreColor(sc) : 'var(--tx3)';
            return '<div style="background:var(--bg);border:1px solid var(--bdr);border-radius:8px;padding:8px;text-align:center">' +
              '<div style="font-size:9px;color:var(--tx3);font-weight:700;text-transform:uppercase"><i class="fas ' + ico + '"></i> ' + lbl + '</div>' +
              '<div style="font-size:16px;font-weight:900;color:' + clr + ';margin-top:3px">' + (sc !== null ? _emScoreLabel(sc) : '—') + '</div>' +
              '</div>';
          }).join('') +
          '</div>';
      }

      // Auto-suggest next week commitment: slight improvement
      var suggest = Math.min(0, overall + 15);
      var cInp = document.getElementById('wmCommitScore');
      if (cInp && !cInp.value) cInp.value = suggest;
    }

    function _wmSave() {
      if (!_startSub('btnWmSave', 'Saving…')) return;
      var empSel = document.getElementById('wmEmp');
      var empId = empSel ? empSel.value : '';
      var empName = empSel && empSel.selectedIndex >= 0 ? empSel.options[empSel.selectedIndex].text.split(' (')[0] : '';
      var commitScore = parseInt((document.getElementById('wmCommitScore') || {}).value, 10);

      if (!empId) {_endSub('btnWmSave'); _toast('Please select an employee', 'warn'); return;}
      if (isNaN(commitScore) || commitScore > 0 || commitScore < -100) {
        _endSub('btnWmSave'); _toast('Commitment score must be between -100 and 0', 'warn'); return;
      }

      // Find doer details from current EM data
      var doer = null;
      if (_D.emData && _D.emData.doers) {
        for (var i = 0; i < _D.emData.doers.length; i++) {
          if (_D.emData.doers[i].emp_id === empId) {doer = _D.emData.doers[i]; break;}
        }
      }

      // Calculate per-module scores from doer's plan/actual data
      function modScore(plan, actual) {
        return plan > 0 ? Math.round((actual / plan * 100) - 100) : null;
      }

      var payload = {
        meeting_date: (document.getElementById('wmMeetDate') || {}).value || _today(),
        week_from: (document.getElementById('wmWkFrom') || {}).value || '',
        week_to: (document.getElementById('wmWkTo') || {}).value || '',
        emp_id: empId,
        emp_name: empName,
        dept: doer ? doer.dept : '',
        actual_score: doer ? _emScore(doer) : 0,
        // Single score per module (matches sheet columns cl_score/dl_score/at_score)
        cl_score: doer ? modScore(doer.cl_plan, doer.cl_actual) : null,
        dl_score: doer ? modScore(doer.dl_plan, doer.dl_actual) : null,
        at_score: doer ? modScore(doer.at_plan, doer.at_actual) : null,
        commitment_score: commitScore,
        commitment_details: (document.getElementById('wmCommitDetails') || {}).value || '',
        manager_notes: (document.getElementById('wmManagerNotes') || {}).value || ''
      };

      _gas('saveWeeklyCommitment', [payload], function (res) {
        _successSub('btnWmSave', 'Saved!');
        _toast('✓ Commitment recorded: ' + res.record_id, 'ok');
        // Clear form
        ['wmCommitScore', 'wmCommitDetails', 'wmManagerNotes'].forEach(function (id) {
          var el = document.getElementById(id); if (el) el.value = '';
        });
        var ep = document.getElementById('wmEmp'); if (ep) ep.value = '';
        var pv = document.getElementById('wmScorePreview'); if (pv) pv.style.display = 'none';
        _wmLoadHistory();
      }, function (e) {
        _endSub('btnWmSave');
        _toast('Error: ' + e.message, 'err');
      });
    }

    function _wmLoadHistory() {
      var root = document.getElementById('wmHistList');
      if (!root) return;
      root.innerHTML = _skel(3, 'sk-h5');

      var filters = {
        emp_id: (document.getElementById('wmHistEmp') || {}).value || 'all',
        dept: (document.getElementById('wmHistDept') || {}).value || 'all',
        status: (document.getElementById('wmHistStatus') || {}).value || 'all',
        from: (document.getElementById('wmHistFrom') || {}).value || '',
        to: (document.getElementById('wmHistTo') || {}).value || ''
      };

      _gas('getWeeklyCommitments', [filters], function (rows) {
        if (!root) return;
        if (!rows || !rows.length) {
          root.innerHTML = '<div class="empty-state" style="padding:20px"><i class="fas fa-handshake" style="font-size:28px;opacity:.25"></i><p style="color:var(--tx3);margin-top:8px">No records yet. Record the first Monday meeting!</p></div>';
          return;
        }
        root.innerHTML = rows.map(function (r) {
          var sc = Number(r.actual_score || 0);
          var cmt = Number(r.commitment_score || 0);
          var sc2 = r.next_week_actual !== '' ? Number(r.next_week_actual) : null;
          var delta = r.improvement_delta !== '' ? Number(r.improvement_delta) : null;
          var stClr = r.commitment_status === 'Met' ? 'var(--G)' : r.commitment_status === 'Not Met' ? 'var(--R)' : r.commitment_status === 'Partial' ? 'var(--O)' : 'var(--tx3)';
          var stBg = r.commitment_status === 'Met' ? 'var(--Gl)' : r.commitment_status === 'Not Met' ? 'var(--Rl)' : r.commitment_status === 'Partial' ? 'var(--Ol)' : 'var(--sur2)';

          return '<div class="anim-item" style="border:1px solid var(--bdr);border-radius:12px;padding:12px 14px;margin-bottom:10px;background:var(--bg)">' +
            '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px">' +
            '<div>' +
            '<div style="font-weight:800;font-size:13.5px;white-space:normal;word-break:break-word">' + _esc(r.emp_name) + ' <span style="font-size:10px;color:var(--tx3);font-weight:600">· ' + _esc(r.dept) + '</span></div>' +
            '<div style="font-size:10.5px;color:var(--tx3);margin-top:2px">Meeting: ' + _fmtDate(r.meeting_date) + ' &nbsp;|&nbsp; Week: ' + _fmtDateShort(r.week_reviewed_from) + ' – ' + _fmtDateShort(r.week_reviewed_to) + '</div>' +
            '</div>' +
            '<span style="padding:3px 8px;border-radius:6px;font-size:10px;font-weight:800;background:' + stBg + ';color:' + stClr + ';white-space:nowrap;flex-shrink:0">' + _esc(r.commitment_status) + '</span>' +
            '</div>' +

            '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">' +
            '<div style="background:var(--sur2);border-radius:8px;padding:8px;text-align:center">' +
            '<div style="font-size:9px;color:var(--tx3);font-weight:700;text-transform:uppercase;margin-bottom:2px">Last Score</div>' +
            '<div style="font-size:16px;font-weight:900;color:' + _emScoreColor(sc) + '">' + _emScoreLabel(sc) + '</div>' +
            '</div>' +
            '<div style="background:var(--sur2);border-radius:8px;padding:8px;text-align:center">' +
            '<div style="font-size:9px;color:var(--tx3);font-weight:700;text-transform:uppercase;margin-bottom:2px">Committed</div>' +
            '<div style="font-size:16px;font-weight:900;color:' + _emScoreColor(cmt) + '">' + _emScoreLabel(cmt) + '</div>' +
            '</div>' +
            '<div style="background:var(--sur2);border-radius:8px;padding:8px;text-align:center">' +
            '<div style="font-size:9px;color:var(--tx3);font-weight:700;text-transform:uppercase;margin-bottom:2px">Actual (Next Wk)</div>' +
            '<div style="font-size:16px;font-weight:900;color:' + (sc2 !== null ? _emScoreColor(sc2) : 'var(--tx3)') + '">' + (sc2 !== null ? _emScoreLabel(sc2) : '—') + '</div>' +
            '</div>' +
            '</div>' +

            // Per-module breakdown (only shown if at least one module score is available)
            ((r.cl_score !== null || r.dl_score !== null || r.at_score !== null)
              ? '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px">' +
              [['fa-list-check', 'CL', r.cl_score], ['fa-diagram-project', 'DL', r.dl_score], ['fa-user-clock', 'AT', r.at_score]].map(function (m) {
                var s3 = m[2]; var c3 = s3 !== null ? _emScoreColor(s3) : 'var(--tx3)';
                return '<div style="background:var(--bg);border:1px solid var(--bdr);border-radius:7px;padding:6px;text-align:center">' +
                  '<div style="font-size:9px;color:var(--tx3);font-weight:700"><i class="fas ' + m[0] + '"></i> ' + m[1] + '</div>' +
                  '<div style="font-size:13px;font-weight:800;color:' + c3 + '">' + (s3 !== null ? _emScoreLabel(s3) : '—') + '</div>' +
                  '</div>';
              }).join('') +
              '</div>'
              : '') +

            // Module-wise score breakdown (from cl_score/dl_score/at_score columns)
            (r.cl_score !== null || r.dl_score !== null || r.at_score !== null ?
              '<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">' +
              (r.cl_score !== null ? '<div style="font-size:10px;padding:3px 8px;border-radius:6px;background:var(--Vl);color:var(--V);font-weight:700"><i class="fas fa-list-check"></i> CL ' + (r.cl_score > 0 ? '+' : '') + r.cl_score + '%</div>' : '') +
              (r.dl_score !== null ? '<div style="font-size:10px;padding:3px 8px;border-radius:6px;background:var(--Tl);color:var(--T);font-weight:700"><i class="fas fa-diagram-project"></i> DL ' + (r.dl_score > 0 ? '+' : '') + r.dl_score + '%</div>' : '') +
              (r.at_score !== null ? '<div style="font-size:10px;padding:3px 8px;border-radius:6px;background:var(--Ol);color:var(--O);font-weight:700"><i class="fas fa-user-clock"></i> AT ' + (r.at_score > 0 ? '+' : '') + r.at_score + '%</div>' : '') +
              '</div>' : '') +

            (delta !== null ? '<div style="font-size:11px;font-weight:700;margin-bottom:6px;color:' + (delta >= 0 ? 'var(--G)' : 'var(--R)') + '">' +
              (delta >= 0 ? '↑ ' : '↓ ') + 'Improvement: ' + (delta > 0 ? '+' : '') + delta + ' pts vs commitment' +
              '</div>' : '') +

            (r.commitment_details ? '<div style="font-size:11.5px;color:var(--tx2);margin-bottom:6px;white-space:normal;word-break:break-word;line-height:1.5"><i class="fas fa-quote-left" style="color:var(--P);font-size:9px"></i> ' + _esc(r.commitment_details) + '</div>' : '') +

            (r.manager_notes ? '<div style="font-size:11px;color:var(--tx3);margin-bottom:8px;white-space:normal;word-break:break-word;font-style:italic"><i class="fas fa-pen" style="font-size:9px"></i> ' + _esc(r.manager_notes) + '</div>' : '') +

            (r.commitment_status === 'Pending' ?
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<input type="number" id="nxt_' + _esc(r.record_id) + '" placeholder="Next week score (e.g. -20)" min="-100" max="0" class="ana-sel" style="flex:1;min-width:160px">' +
              '<select id="sts_' + _esc(r.record_id) + '" class="ana-sel">' +
              '<option value="Met">✅ Met</option>' +
              '<option value="Partial">🔶 Partial</option>' +
              '<option value="Not Met">❌ Not Met</option>' +
              '</select>' +
              '<button class="btn btn-sm" onclick="_wmMarkStatus(\'' + _esc(r.record_id) + '\',\'' + r.commitment_score + '\')" style="white-space:nowrap">' +
              '<i class="fas fa-check"></i> Update</button>' +
              '</div>'
              :
              '<div style="font-size:10.5px;color:var(--tx3);margin-top:4px"><i class="fas fa-circle-check" style="color:var(--G)"></i> Commitment closed &mdash; ' + _esc(r.commitment_status) +
              (r.next_week_actual !== '' ? ' · Next week score: <b style="color:' + _emScoreColor(Number(r.next_week_actual)) + '">' + _emScoreLabel(Number(r.next_week_actual)) + '</b>' : '') +
              (r.improvement_delta !== '' ? ' · Delta: <b style="color:' + (Number(r.improvement_delta) >= 0 ? 'var(--G)' : 'var(--R)') + '">' + (Number(r.improvement_delta) > 0 ? '+' : '') + r.improvement_delta + '</b>' : '') +
              '</div>'
            ) +
            '</div>';
        }).join('');
      }, function (e) {
        if (root) root.innerHTML = '<div class="te"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) + '</div>';
      });
    }

    function _wmMarkStatus(recId, commitScore) {
      var nxtEl = document.getElementById('nxt_' + recId);
      var stsEl = document.getElementById('sts_' + recId);
      var nextActual = nxtEl ? nxtEl.value : '';
      var status = stsEl ? stsEl.value : 'Met';
      _gas('updateCommitmentStatus', [recId, {
        commitment_status: status,
        next_week_actual: nextActual,
        commitment_score: commitScore
      }], function () {
        _toast('✓ Status updated', 'ok');
        _wmLoadHistory();
      }, function (e) {_toast('Error: ' + e.message, 'err');});
    }

    function _wmClearFilters() {
      ['wmHistEmp', 'wmHistDept', 'wmHistStatus'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.value = el.options[0].value;
      });
      ['wmHistFrom', 'wmHistTo'].forEach(function (id) {
        var el = document.getElementById(id); if (el) el.value = '';
      });
      _wmLoadHistory();
    }

    /* ══════════════════════════════════════════════════════════════════════
       INCREMENT APPRAISAL — Separate from weekly meetings.
       Triggered only when: staff requests increment OR yearly appraisal.
       Auto-pulls commitment history for the selected employee and shows
       trend stats before the manager fills the decision form.
    ══════════════════════════════════════════════════════════════════════ */
    function _vEMAppraisal() {
      var root = document.getElementById('emApRoot');
      if (!root) return;

      root.innerHTML =
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start">' +

        // ── INITIATE APPRAISAL FORM ───────────────────────────────────────
        '<div class="card card-nohover">' +
        '<div class="sec-title" style="margin-bottom:16px"><i class="fas fa-medal" style="color:var(--P)"></i> Initiate Appraisal</div>' +
        '<div style="background:var(--Pl);border:1px solid var(--bdr2);border-radius:10px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:var(--P);font-weight:600">' +
        '<i class="fas fa-info-circle"></i> Start here when a staff member asks for increment, or when yearly appraisal cycle is due.' +
        '</div>' +

        '<div style="display:flex;flex-direction:column;gap:12px">' +

        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Employee</label>' +
        _ssHtml('apEmp', '<option value="">— Select Employee —</option>' + _getEmpOptions(), '— Select Employee —', '_apLoadHistory') + '</div>' +

        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Trigger</label>' +
        '<select id="apTrigger" class="ana-sel" style="width:100%">' +
        '<option value="Staff Request">📩 Staff Requested Increment</option>' +
        '<option value="Annual Appraisal">📅 Annual Appraisal Cycle</option>' +
        '<option value="Manager Initiated">👤 Manager Initiated</option>' +
        '</select></div>' +

        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Review From</label>' +
        '<input type="date" id="apFrom" class="ana-sel" value="' + (_currMonth() + '-01') + '" style="width:100%"></div>' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Review To</label>' +
        '<input type="date" id="apTo" class="ana-sel" value="' + _today() + '" style="width:100%"></div>' +
        '</div>' +

        // Commitment history preview (loads when employee selected)
        '<div id="apHistPreview" style="display:none"></div>' +

        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Manager Assessment</label>' +
        '<textarea id="apAssessment" class="ana-sel" rows="3" placeholder="Your overall assessment of this employee\'s performance and growth…" style="width:100%;resize:vertical"></textarea></div>' +

        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Recommendation</label>' +
        '<select id="apRecommendation" class="ana-sel" style="width:100%">' +
        '<option value="Increment">✅ Grant Increment</option>' +
        '<option value="Deferred">🕐 Defer — Next Cycle</option>' +
        '<option value="No Increment">❌ No Increment</option>' +
        '</select></div>' +

        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Increment % <span style="color:var(--tx3);font-weight:600;text-transform:none">(if recommending increment)</span></label>' +
        '<input type="number" id="apIncrPct" class="ana-sel" min="0" max="100" step="0.5" placeholder="e.g. 8 for 8%" style="width:100%"></div>' +

        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Notes / Reason</label>' +
        '<textarea id="apNotes" class="ana-sel" rows="2" placeholder="Reason for this recommendation…" style="width:100%;resize:vertical"></textarea></div>' +

        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Approved by</label>' +
        '<input type="text" id="apApprovedBy" class="ana-sel" placeholder="Director / Owner name" style="width:100%"></div>' +

        '<button class="btn btn-wide" id="btnApSave" onclick="_apSave()" style="margin-top:4px">' +
        '<i class="fas fa-floppy-disk"></i> Save Appraisal Record</button>' +

        '</div></div>' +

        // ── APPRAISAL HISTORY ─────────────────────────────────────────────
        '<div>' +
        '<div class="card card-nohover">' +
        '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-clock-rotate-left" style="color:var(--V)"></i> Appraisal History</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
        '<select id="apHistEmpF" class="ana-sel" onchange="_apLoadAppraisals()">' +
        '<option value="all">All Employees</option>' + _getEmpOptions() + '</select>' +
        '<select id="apHistStatus" class="ana-sel" onchange="_apLoadAppraisals()">' +
        '<option value="all">All Status</option>' +
        '<option value="Pending">⏳ Pending</option>' +
        '<option value="Approved">✅ Approved</option>' +
        '<option value="Applied">💰 Applied</option>' +
        '<option value="Rejected">❌ Rejected</option>' +
        '</select>' +
        '<button class="btn btn-sm" onclick="_apLoadAppraisals()"><i class="fas fa-rotate-right"></i></button>' +
        '</div>' +
        '<div id="apHistList">' + _skel(3, 'sk-h5') + '</div>' +
        '</div></div>' +

        '</div>';

      _apLoadAppraisals();
    }

    // Load commitment history preview for selected employee
    function _apLoadHistory() {
      var empId = (document.getElementById('apEmp') || {}).value;
      var preview = document.getElementById('apHistPreview');
      if (!preview) return;
      if (!empId) {preview.style.display = 'none'; return;}

      preview.style.display = '';
      preview.innerHTML = '<div style="background:var(--sur2);border:1px solid var(--bdr);border-radius:10px;padding:12px">' +
        '<div style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;margin-bottom:8px">Loading commitment history…</div>' +
        _skel(2, 'sk-h3') + '</div>';

      _gas('getWeeklyCommitments', [{emp_id: empId}], function (rows) {
        if (!rows || !rows.length) {
          preview.innerHTML = '<div style="background:var(--sur2);border:1px solid var(--bdr);border-radius:10px;padding:12px;font-size:12px;color:var(--tx3)"><i class="fas fa-info-circle"></i> No weekly meeting records found for this employee yet.</div>';
          return;
        }
        var closed = rows.filter(function (r) {return r.commitment_status !== 'Pending';});
        var met = closed.filter(function (r) {return r.commitment_status === 'Met';});
        var avgSc = Math.round(rows.reduce(function (s, r) {return s + Number(r.actual_score || 0);}, 0) / rows.length);
        var commitRate = closed.length ? Math.round(met.length / closed.length * 100) : null;
        var deltas = closed.filter(function (r) {return r.improvement_delta !== '';})
          .map(function (r) {return Number(r.improvement_delta);});
        var avgDelta = deltas.length ? Math.round(deltas.reduce(function (s, v) {return s + v;}, 0) / deltas.length) : null;

        preview.innerHTML =
          '<div style="background:var(--sur2);border:1px solid var(--bdr);border-radius:10px;padding:12px">' +
          '<div style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase;margin-bottom:10px"><i class="fas fa-chart-bar"></i> Commitment History — ' + rows.length + ' weekly records</div>' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' +
          '<div style="text-align:center;background:var(--bg);border-radius:8px;padding:8px">' +
          '<div style="font-size:9px;color:var(--tx3);font-weight:700;text-transform:uppercase">Avg Score</div>' +
          '<div style="font-size:18px;font-weight:900;color:' + _emScoreColor(avgSc) + '">' + _emScoreLabel(avgSc) + '</div>' +
          '</div>' +
          '<div style="text-align:center;background:var(--bg);border-radius:8px;padding:8px">' +
          '<div style="font-size:9px;color:var(--tx3);font-weight:700;text-transform:uppercase">Commit Rate</div>' +
          '<div style="font-size:18px;font-weight:900;color:' + (commitRate >= 70 ? 'var(--G)' : commitRate >= 40 ? 'var(--O)' : 'var(--R)') + '">' + (commitRate !== null ? commitRate + '%' : '—') + '</div>' +
          '</div>' +
          '<div style="text-align:center;background:var(--bg);border-radius:8px;padding:8px">' +
          '<div style="font-size:9px;color:var(--tx3);font-weight:700;text-transform:uppercase">Avg Δ</div>' +
          '<div style="font-size:18px;font-weight:900;color:' + (avgDelta > 0 ? 'var(--G)' : avgDelta < 0 ? 'var(--R)' : 'var(--tx3)') + '">' + (avgDelta !== null ? (avgDelta > 0 ? '+' : '') + avgDelta : '—') + '</div>' +
          '</div>' +
          '</div>' +
          '<div style="font-size:10.5px;color:var(--tx3);margin-top:8px">' +
          met.length + ' of ' + closed.length + ' commitments met' +
          (avgDelta !== null ? ' · Average improvement vs commitment: ' + (avgDelta > 0 ? '+' : '') + avgDelta + ' pts' : '') +
          '</div>' +
          '</div>';
      }, function () {
        preview.innerHTML = '<div style="font-size:12px;color:var(--R)">Could not load commitment history.</div>';
      });
    }

    function _apSave() {
      if (!_startSub('btnApSave', 'Saving…')) return;
      var empSel = document.getElementById('apEmp');
      var empId = empSel ? empSel.value : '';
      var empName = empSel && empSel.selectedIndex >= 0 ? empSel.options[empSel.selectedIndex].text.split(' (')[0] : '';

      if (!empId) {_endSub('btnApSave'); _toast('Please select an employee', 'warn'); return;}

      // Find doer dept from empDir
      var dept = '';
      if (_D.empDir) {
        for (var i = 0; i < _D.empDir.length; i++) {
          if (String(_D.empDir[i].emp_code || _D.empDir[i].emp_id || '') === empId) {dept = _D.empDir[i].dept || ''; break;}
        }
      }

      var payload = {
        emp_id: empId,
        emp_name: empName,
        dept: dept,
        trigger_type: (document.getElementById('apTrigger') || {}).value || 'Manager Initiated',
        review_from: (document.getElementById('apFrom') || {}).value || '',
        review_to: (document.getElementById('apTo') || {}).value || _today(),
        manager_assessment: (document.getElementById('apAssessment') || {}).value || '',
        recommendation: (document.getElementById('apRecommendation') || {}).value || 'Increment',
        increment_pct: (document.getElementById('apIncrPct') || {}).value || '',
        increment_notes: (document.getElementById('apNotes') || {}).value || '',
        approved_by: (document.getElementById('apApprovedBy') || {}).value || ''
      };

      _gas('saveIncrementAppraisal', [payload], function (res) {
        _successSub('btnApSave', 'Saved!');
        _toast('✓ Appraisal recorded: ' + res.appraisal_id, 'ok');
        ['apAssessment', 'apNotes', 'apIncrPct', 'apApprovedBy'].forEach(function (id) {
          var el = document.getElementById(id); if (el) el.value = '';
        });
        var ep = document.getElementById('apEmp'); if (ep) ep.value = '';
        var pv = document.getElementById('apHistPreview'); if (pv) pv.style.display = 'none';
        _apLoadAppraisals();
      }, function (e) {
        _endSub('btnApSave');
        _toast('Error: ' + e.message, 'err');
      });
    }

    function _apLoadAppraisals() {
      var root = document.getElementById('apHistList');
      if (!root) return;
      root.innerHTML = _skel(3, 'sk-h5');
      var filters = {
        emp_id: (document.getElementById('apHistEmpF') || {}).value || 'all',
        status: (document.getElementById('apHistStatus') || {}).value || 'all'
      };
      _gas('getIncrementAppraisals', [filters], function (rows) {
        if (!root) return;
        if (!rows || !rows.length) {
          root.innerHTML = '<div class="empty-state" style="padding:20px"><i class="fas fa-medal" style="font-size:28px;opacity:.2"></i><p style="color:var(--tx3);margin-top:8px">No appraisals yet.</p></div>';
          return;
        }
        root.innerHTML = rows.map(function (r) {
          var recClr = r.recommendation === 'Increment' ? 'var(--G)' : r.recommendation === 'No Increment' ? 'var(--R)' : 'var(--O)';
          var stBg = r.status === 'Applied' ? 'var(--Gl)' : r.status === 'Approved' ? 'var(--Pl)' : r.status === 'Rejected' ? 'var(--Rl)' : 'var(--sur2)';
          var stClr = r.status === 'Applied' ? 'var(--G)' : r.status === 'Approved' ? 'var(--P)' : r.status === 'Rejected' ? 'var(--R)' : 'var(--tx3)';
          return '<div class="anim-item" style="border:1px solid var(--bdr);border-radius:12px;padding:13px;margin-bottom:10px;background:var(--bg)">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
            '<div>' +
            '<div style="font-weight:800;font-size:14px;white-space:normal;word-break:break-word">' + _esc(r.emp_name) + ' <span style="font-size:10px;color:var(--tx3);font-weight:600">· ' + _esc(r.dept) + '</span></div>' +
            '<div style="font-size:10.5px;color:var(--tx3);margin-top:2px">' + _esc(r.trigger_type) + ' · ' + _fmtDate(r.request_date) + '</div>' +
            '</div>' +
            '<span style="padding:3px 8px;border-radius:6px;font-size:10px;font-weight:800;background:' + stBg + ';color:' + stClr + ';white-space:nowrap">' + _esc(r.status) + '</span>' +
            '</div>' +

            // Commitment history stats
            (r.avg_score !== null ? '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">' +
              '<div style="background:var(--sur2);border-radius:7px;padding:7px;text-align:center"><div style="font-size:9px;color:var(--tx3);font-weight:700;text-transform:uppercase">Avg Score</div><div style="font-size:14px;font-weight:900;color:' + _emScoreColor(r.avg_score) + '">' + _emScoreLabel(r.avg_score) + '</div></div>' +
              '<div style="background:var(--sur2);border-radius:7px;padding:7px;text-align:center"><div style="font-size:9px;color:var(--tx3);font-weight:700;text-transform:uppercase">Commit Rate</div><div style="font-size:14px;font-weight:900;color:' + (r.commitment_rate_pct >= 70 ? 'var(--G)' : r.commitment_rate_pct >= 40 ? 'var(--O)' : 'var(--R)') + '">' + (r.commitment_rate_pct !== null ? r.commitment_rate_pct + '%' : '—') + '</div></div>' +
              '<div style="background:var(--sur2);border-radius:7px;padding:7px;text-align:center"><div style="font-size:9px;color:var(--tx3);font-weight:700;text-transform:uppercase">Avg Δ</div><div style="font-size:14px;font-weight:900;color:' + (r.avg_improvement_delta > 0 ? 'var(--G)' : r.avg_improvement_delta < 0 ? 'var(--R)' : 'var(--tx3)') + '">' + (r.avg_improvement_delta !== null ? (r.avg_improvement_delta > 0 ? '+' : '') + r.avg_improvement_delta : '—') + '</div></div>' +
              '</div>' : '') +

            // Decision
            '<div style="padding:10px;background:var(--sur2);border-radius:9px;margin-bottom:8px">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
            '<div><span style="font-size:10px;color:var(--tx3);font-weight:700;text-transform:uppercase">Recommendation</span>' +
            '<div style="font-weight:900;font-size:14px;color:' + recClr + ';margin-top:2px">' + _esc(r.recommendation) +
            (r.increment_pct ? ' · <span style="font-size:13px">' + _esc(r.increment_pct) + '%</span>' : '') + '</div></div>' +
            '</div>' +
            (r.manager_assessment ? '<div style="font-size:11.5px;color:var(--tx2);margin-top:8px;white-space:normal;word-break:break-word;line-height:1.5">' + _esc(r.manager_assessment) + '</div>' : '') +
            (r.increment_notes ? '<div style="font-size:11px;color:var(--tx3);margin-top:4px;white-space:normal;word-break:break-word;font-style:italic">' + _esc(r.increment_notes) + '</div>' : '') +
            '</div>' +

            // Status update buttons
            (r.status === 'Pending' ?
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button class="btn btn-sm" style="background:var(--Pl);color:var(--P);border:none" onclick="_apUpdateStatus(\'' + _esc(r.appraisal_id) + '\',\'Approved\')"><i class="fas fa-check"></i> Mark Approved</button>' +
              '<button class="btn btn-sm" style="background:var(--Gl);color:var(--G);border:none" onclick="_apUpdateStatus(\'' + _esc(r.appraisal_id) + '\',\'Applied\')"><i class="fas fa-indian-rupee-sign"></i> Mark Applied</button>' +
              '<button class="btn btn-sm" style="background:var(--Rl);color:var(--R);border:none" onclick="_apUpdateStatus(\'' + _esc(r.appraisal_id) + '\',\'Rejected\')"><i class="fas fa-times"></i> Reject</button>' +
              '</div>'
              : r.status === 'Approved' ?
                '<button class="btn btn-sm" style="background:var(--Gl);color:var(--G);border:none;margin-top:4px" onclick="_apAppliedForm(\'' + _esc(r.appraisal_id) + '\')">' +
                '<i class="fas fa-indian-rupee-sign"></i> Mark as Applied (with date)</button>'
                : '<div style="font-size:10.5px;color:var(--tx3);margin-top:4px">' +
                (r.approved_by ? 'Approved by: <b>' + _esc(r.approved_by) + '</b>' : '') +
                (r.applied_date ? ' · Applied: <b>' + _esc(r.applied_date) + '</b>' : '') +
                '</div>'
            ) +
            '</div>';
        }).join('');
      }, function (e) {
        if (root) root.innerHTML = '<div class="te"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) + '</div>';
      });
    }

    function _apUpdateStatus(apprId, status) {
      _gas('updateIncrementAppraisal', [apprId, {status: status}], function () {
        _toast('✓ Status updated: ' + status, 'ok');
        _apLoadAppraisals();
      }, function (e) {_toast('Error: ' + e.message, 'err');});
    }

    function _apAppliedForm(apprId) {
      _openModal('<i class="fas fa-indian-rupee-sign" style="color:var(--G)"></i> Mark Increment Applied',
        '<div style="display:flex;flex-direction:column;gap:12px">' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Applied Date</label>' +
        '<input type="date" id="apAppliedDate" class="ana-sel" value="' + _today() + '" style="width:100%"></div>' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Approved by</label>' +
        '<input type="text" id="apAppliedBy" class="ana-sel" placeholder="Director / Owner name" style="width:100%"></div>' +
        '</div>',
        function () {
          var d = (document.getElementById('apAppliedDate') || {}).value || _today();
          var b = (document.getElementById('apAppliedBy') || {}).value || '';
          _gas('updateIncrementAppraisal', [apprId, {status: 'Applied', applied_date: d, approved_by: b}], function () {
            _closeModal();
            _toast('✓ Increment marked as applied!', 'ok');
            _apLoadAppraisals();
          }, function (e) {_toast('Error: ' + e.message, 'err');});
        }, '<i class="fas fa-check"></i> Confirm Applied');
    }

    function _exportEM() {
      var data = _D.emData;
      if (!data) {_toast('Load data first', 'warn'); return;}
      var doers = _emFilteredDoers();
      var rows = [['#', 'Doer', 'Department', 'Checklist Plan', 'Checklist Actual', 'Delegation Plan', 'Delegation Actual', 'Attendance Plan', 'Attendance Actual', 'Total Plan', 'Total Actual', 'Score %']];
      doers.forEach(function (e, i) {
        rows.push([i + 1, e.name, e.dept, e.cl_plan, e.cl_actual, e.dl_plan, e.dl_actual, e.at_plan, e.at_actual, e.total_plan, e.total_actual, _emScore(e)]);
      });
      _downloadCSV('em_dashboard_' + (data.from || _currMonth()) + '_to_' + (data.to || _today()) + '.csv', rows);
      _toast('Exported!', 'ok');
    }

    /* ══════════════════════════════════════════════════════════════════════
       PAYROLL MODULE — Management only (OWNER / MANAGER)
       Employee Directory style: cards → click → salary breakdown
       Auto-computed from Attendance + Approved Leave + Doer List salary data
       Doer List columns needed: Basic Salary, HRA, Conveyance,
         Other Allowances, PF Deduction, ESI Deduction, TDS, Other Deductions
    ══════════════════════════════════════════════════════════════════════ */

    function _prFmt(n) {
      return Number(n || 0).toLocaleString('en-IN', {maximumFractionDigits: 0});
    }

    // Build month options (last 12 months)
    function _prMonthOpts(sel) {
      var opts = '';
      var now = new Date();
      for (var i = 0; i < 12; i++) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        var y = d.getFullYear(), m = d.getMonth() + 1;
        var val = y + '-' + (m < 10 ? '0' : '') + m;
        var lbl = d.toLocaleString('en-IN', {month: 'long', year: 'numeric'});
        opts += '<option value="' + val + '"' + (val === sel ? ' selected' : '') + '>' + lbl + '</option>';
      }
      return opts;
    }

    function _currMonth() {
      var n = new Date(); var m = n.getMonth() + 1;
      return n.getFullYear() + '-' + (m < 10 ? '0' : '') + m;
    }

    function _vPayroll() {
      if (!_isManager()) {
        document.getElementById('content').innerHTML =
          '<div class="empty-state"><i class="fas fa-lock"></i><h4>Access Restricted</h4><p>Manager access required.</p></div>';
        return;
      }

      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div><div class="mod-title"><i class="fas fa-file-invoice-dollar" style="color:var(--G)"></i> Salary Sheet</div>' +
        '<div class="mod-sub">Month select karo — attendance & leave ke basis pe salary tayaar hogi</div></div>' +
        '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-sm btn-outline" id="prExportBtn" onclick="_prExportCSV()" style="display:none" title="Download summary CSV (includes Week Off counts)">' +
        '<i class="fas fa-file-csv"></i> Export Summary</button>' +
        '<button class="btn btn-sm btn-outline" id="prExportDetailBtn" onclick="_prExportDetailCSV()" style="display:none" title="Download day-by-day log with IN/OUT + Week Off">' +
        '<i class="fas fa-table"></i> Export Full Detail</button>' +
        '</div>' +
        '</div>' +

        // Month + Dept selectors
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;' +
        'background:var(--sur2);border:1px solid var(--bdr);border-radius:12px;margin-bottom:16px">' +
        '<i class="fas fa-calendar-alt" style="color:var(--P);font-size:16px"></i>' +
        '<select id="prMonthSel" class="ana-sel" onchange="_prLoad()" style="font-size:14px;font-weight:700;min-width:180px">' +
        _prMonthOpts(_currMonth()) + '</select>' +
        '<select id="prDeptSel" class="ana-sel" onchange="_prLoad()">' +
        '<option value="all">All Departments</option>' + _getDeptOptions() + '</select>' +
        '<button class="btn btn-sm" onclick="_prLoad()"><i class="fas fa-rotate-right"></i></button>' +
        '<div id="prMonthInfo" style="font-size:11px;color:var(--tx3);margin-left:4px"></div>' +
        '</div>' +

        '<div class="pr-summary-strip" id="prSummaryStrip"></div>' +

        // Employee cards grid
        '<div id="prEmpGrid" class="pr-card-grid">' +
        '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--tx3)">' +
        '<i class="fas fa-circle-notch fa-spin" style="font-size:24px;color:var(--P)"></i>' +
        '<div style="margin-top:10px;font-weight:600">Loading payroll data…</div></div>' +
        '</div>' +

        // Employee detail panel (hidden initially)
        '<div id="prDetailPanel" style="display:none"></div>';

      _prLoad();
    }

    var _prData = null; // cache current payroll data

    function _prLoad() {
      var month = (document.getElementById('prMonthSel') || {}).value || _currMonth();
      var dept = (document.getElementById('prDeptSel') || {}).value || 'all';
      var grid = document.getElementById('prEmpGrid');
      var strip = document.getElementById('prSummaryStrip');
      var info = document.getElementById('prMonthInfo');
      var expBtn = document.getElementById('prExportBtn');
      if (grid) grid.innerHTML =
        '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--tx3)">' +
        '<i class="fas fa-circle-notch fa-spin" style="font-size:22px;color:var(--P)"></i>' +
        '<div style="margin-top:10px;font-weight:600">Computing salaries…</div>' +
        '<div style="font-size:11px;color:var(--tx3);margin-top:4px">Attendance + leaves + deductions calculate ho rahi hain</div></div>';
      if (strip) strip.innerHTML = '';
      var expBtn = document.getElementById('prExportBtn');
      var expDetBtn = document.getElementById('prExportDetailBtn');
      if (expBtn) expBtn.style.display = 'none';
      if (expDetBtn) expDetBtn.style.display = 'none';

      _gas('getPayrollSummary', [month, dept], function (data) {
        _prData = data;
        _prRenderCards(data);
        if (expBtn) expBtn.style.display = '';
        if (expDetBtn) expDetBtn.style.display = '';
      }, function (e) {
        if (grid) grid.innerHTML =
          '<div class="te" style="grid-column:1/-1"><i class="fas fa-exclamation-triangle"></i> ' + _esc(e.message) +
          '<br><br><div style="font-size:12px;color:var(--tx3)">Tip: Doer List mein salary columns add karo:<br>' +
          '<code>Basic Salary, HRA, Conveyance, Other Allowances, PF Deduction, ESI Deduction, TDS, Other Deductions</code></div></div>';
      });
    }

    function _prRenderCards(data) {
      var grid = document.getElementById('prEmpGrid');
      var strip = document.getElementById('prSummaryStrip');
      var info = document.getElementById('prMonthInfo');
      if (!grid) return;

      var emps = data.employees || [];
      var summary = data.summary || {};
      var monthLbl = (function () {
        try {var p = data.month.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleString('en-IN', {month: 'long', year: 'numeric'});}
        catch (e2) {return data.month;}
      })();

      if (info) info.innerHTML =
        '<strong>' + emps.length + ' employees</strong> · ' + data.days_in_month + ' days · ' + _esc(monthLbl);

      // Summary strip
      if (strip) {
        var noSalary = emps.filter(function (e) {return e.basic_salary === 0;}).length; var cards = [
          {lbl: 'Total Gross', val: '₹' + _prFmt(summary.total_gross), c: 'var(--P)', ico: 'fa-sack-dollar'},
          {lbl: 'Deductions', val: '₹' + _prFmt(summary.total_deductions), c: 'var(--R)', ico: 'fa-arrow-down-wide-short'},
          {lbl: 'Net Payable', val: '₹' + _prFmt(summary.total_net), c: 'var(--G)', ico: 'fa-wallet', bold: true},
          {lbl: 'Employees', val: emps.length, c: 'var(--T)', ico: 'fa-users'},
          {lbl: 'Salary Missing', val: noSalary, c: noSalary > 0 ? 'var(--O)' : 'var(--tx3)', ico: 'fa-triangle-exclamation'}
        ];
        strip.innerHTML = cards.map(function (c) {
          return '<div class="card card-nohover" style="padding:12px 14px;border-left:3px solid ' + c.c + '">' +
            '<div style="display:flex;align-items:center;gap:7px;margin-bottom:3px">' +
            '<i class="fas ' + c.ico + '" style="color:' + c.c + ';font-size:13px"></i>' +
            '<div style="font-size:10px;font-weight:800;color:var(--tx3);text-transform:uppercase">' + c.lbl + '</div></div>' +
            '<div style="font-size:' + (c.bold ? '17' : '14') + 'px;font-weight:900;color:' + c.c + '">' + c.val + '</div>' +
            '</div>';
        }).join('');
      }

      if (!emps.length) {
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">' +
          '<i class="fas fa-users-slash" style="font-size:40px;color:var(--tx4)"></i>' +
          '<h4 style="margin-top:12px">No Employees Found</h4>' +
          '<p>Selected department/month mein koi employee nahi hai ya NeedAttendance=No set hai.</p></div>';
        return;
      }

      // Employee cards — Employee Directory style
      grid.innerHTML = emps.map(function (e) {
        var hasSalary = e.basic_salary > 0;
        var attPct = e.total_working_days > 0
          ? Math.round(e.payable_days / e.total_working_days * 100) : 0;
        var pctColor = attPct >= 90 ? 'var(--G)' : attPct >= 75 ? 'var(--O)' : 'var(--R)';
        var lwpTag = e.lwp_days > 0
          ? '<span style="background:var(--Rl);color:var(--R);padding:1px 6px;border-radius:5px;font-size:9px;font-weight:800">LWP:' + e.lwp_days + 'd</span>' : '';

        return '<div class="card" style="padding:0;overflow:hidden;cursor:pointer;transition:transform .15s,box-shadow .15s" ' +
          'data-empid="' + _esc(e.emp_id) + '" ' +
          'onclick="_prOpenDetail(this.getAttribute(\'data-empid\'))" ' +
          'onmouseenter="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 8px 24px rgba(0,0,0,.12)\'" ' +
          'onmouseleave="this.style.transform=\'\';this.style.boxShadow=\'\'">' +

          // Card top band
          '<div style="height:5px;background:' + (hasSalary ? 'linear-gradient(90deg,var(--P),var(--T))' : 'var(--bdr)') + '"></div>' +

          '<div style="padding:14px 16px">' +
          // Avatar + name
          '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
          _avatarEl(e.emp_name, e.photo, 42) +
          '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + _esc(e.emp_name) + '</div>' +
          '<div style="font-size:11px;color:var(--tx3)">' + _esc(e.dept) + ' · ' + _esc(e.emp_id) + '</div>' +
          '</div>' +
          lwpTag +
          '</div>' +

          // Attendance bar
          '<div style="margin-bottom:10px">' +
          '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--tx3);margin-bottom:3px">' +
          '<span>Attendance</span><span style="font-weight:800;color:' + pctColor + '">' + attPct + '%</span></div>' +
          '<div style="height:5px;background:var(--sur2);border-radius:4px;overflow:hidden">' +
          '<div style="height:100%;width:' + attPct + '%;background:' + pctColor + ';border-radius:4px;transition:width .4s"></div></div>' +
          '<div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">' +
          '<span style="font-size:10px;color:var(--G)">✓ ' + e.payable_days + 'd paid</span>' +
          (e.absent_days > 0 ? '<span style="font-size:10px;color:var(--R)">✗ ' + e.absent_days + 'd absent</span>' : '') +
          (e.leave_days > 0 ? '<span style="font-size:10px;color:var(--T)">⊘ ' + e.leave_days + 'd leave</span>' : '') +
          '</div></div>' +

          // Salary summary
          (hasSalary
            ? '<div style="background:var(--sur2);border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center">' +
            '<div>' +
            '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;font-weight:700">Gross</div>' +
            '<div style="font-size:13px;font-weight:800;color:var(--tx)">₹' + _prFmt(e.gross_salary) + '</div>' +
            '</div>' +
            '<div style="font-size:12px;color:var(--R)">-₹' + _prFmt(e.total_deductions) + '</div>' +
            '<div style="text-align:right">' +
            '<div style="font-size:10px;color:var(--tx3);text-transform:uppercase;font-weight:700">Net Pay</div>' +
            '<div style="font-size:16px;font-weight:900;color:var(--G)">₹' + _prFmt(e.net_salary) + '</div>' +
            '</div>' +
            '</div>'
            : '<div style="background:var(--Ol);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--O);font-weight:700">' +
            '<i class="fas fa-triangle-exclamation"></i> Salary not configured in Doer List</div>'
          ) +
          '</div></div>';
      }).join('');
    }

    function _prOpenDetail(empId) {
      if (!_prData) return;
      var emp = null;
      (_prData.employees || []).forEach(function (e) {if (e.emp_id === empId) emp = e;});
      if (!emp) return;

      var monthLbl = (function () {
        try {var p = _prData.month.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleString('en-IN', {month: 'long', year: 'numeric'});}
        catch (e2) {return _prData.month;}
      })();

      var log = emp.daily_log || [];
      var attPct = emp.total_working_days > 0 ? Math.round(emp.payable_days / emp.total_working_days * 100) : 0;
      var pctColor = attPct >= 90 ? 'var(--G)' : attPct >= 75 ? 'var(--O)' : 'var(--R)';

      // ── Status colors / labels ────────────────────────────────────────────
      var bgOf = {
        P: 'var(--Gl)', HD: 'var(--Tl)', A: 'var(--Rl)', WO: 'var(--sur2)',
        H: '#EEF2FF', LWP: 'var(--Rl)', CL: 'var(--Pl)', SL: 'var(--Pl)', PL: 'var(--Pl)'
      };
      var clrOf = {
        P: 'var(--G)', HD: 'var(--T)', A: 'var(--R)', WO: 'var(--tx3)',
        H: '#6366F1', LWP: 'var(--R)', CL: 'var(--P)', SL: 'var(--P)', PL: 'var(--P)'
      };

      // ── Header (name + month + key metrics) ───────────────────────────────
      var headerHtml =
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:8px;margin-bottom:18px">' +
        [
          {lbl: 'Working Days', val: emp.total_working_days, c: 'var(--tx)', ico: 'fa-calendar-days'},
          {lbl: 'Present', val: emp.present_days, c: 'var(--G)', ico: 'fa-circle-check'},
          {lbl: 'Paid Leave', val: emp.leave_days, c: 'var(--T)', ico: 'fa-umbrella-beach'},
          {lbl: 'Absent / LWP', val: emp.absent_days + emp.lwp_days, c: (emp.absent_days + emp.lwp_days) > 0 ? 'var(--R)' : 'var(--tx3)', ico: 'fa-circle-xmark'},
          {lbl: 'Holidays', val: emp.holiday_days, c: '#6366F1', ico: 'fa-star'},
          {lbl: 'Week Off', val: emp.week_off_days, c: 'var(--tx3)', ico: 'fa-moon'}
        ].map(function (s) {
          return '<div style="background:var(--sur2);border-radius:10px;padding:10px 12px;text-align:center;border:1px solid var(--bdr)">' +
            '<i class="fas ' + s.ico + '" style="color:' + s.c + ';font-size:14px;margin-bottom:4px;display:block"></i>' +
            '<div style="font-size:18px;font-weight:900;color:' + s.c + ';line-height:1">' + s.val + '</div>' +
            '<div style="font-size:9px;color:var(--tx3);text-transform:uppercase;font-weight:800;margin-top:3px;line-height:1.2">' + s.lbl + '</div>' +
            '</div>';
        }).join('') + '</div>' +
        // Attendance progress bar
        '<div style="margin-bottom:18px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<span style="font-size:11px;font-weight:700;color:var(--tx2)">Attendance Rate</span>' +
        '<span style="font-size:15px;font-weight:900;color:' + pctColor + '">' + attPct + '%</span></div>' +
        '<div style="height:8px;background:var(--sur2);border-radius:8px;overflow:hidden">' +
        '<div style="height:100%;width:' + attPct + '%;background:linear-gradient(90deg,' + pctColor + ',' + pctColor + 'aa);border-radius:8px;transition:width .5s"></div>' +
        '</div><div style="font-size:10px;color:var(--tx3);margin-top:4px">' + emp.payable_days + ' payable days out of ' + emp.total_working_days + ' working days</div>' +
        '</div>';

      // ── Calendar ──────────────────────────────────────────────────────────
      var calHtml =
        '<div style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:6px">' +
        '<i class="fas fa-calendar-alt" style="color:var(--P)"></i> ' + monthLbl + ' — Day by Day</div>' +
        // Legend
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
        [['P', 'Present', 'var(--Gl)', 'var(--G)'], ['HD', 'Half Day', 'var(--Tl)', 'var(--T)'],
        ['A', 'Absent', 'var(--Rl)', 'var(--R)'], ['WO', 'Week Off', 'var(--sur2)', 'var(--tx3)'],
        ['H', 'Holiday', '#EEF2FF', '#6366F1'], ['L', 'Leave', 'var(--Pl)', 'var(--P)']].map(function (x) {
          return '<div style="display:flex;align-items:center;gap:4px">' +
            '<div style="width:10px;height:10px;border-radius:2px;background:' + x[2] + '"></div>' +
            '<span style="font-size:9px;color:var(--tx3);font-weight:600">' + x[1] + '</span></div>';
        }).join('') + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center;margin-bottom:16px">';

      // Day headers
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (h) {
        calHtml += '<div style="font-size:9px;font-weight:800;color:var(--tx3);padding:4px 0;text-align:center">' + h + '</div>';
      });

      // Blank filler
      var firstDow = log.length ? new Date(log[0].date + 'T00:00:00').getDay() : 0;
      for (var b = 0; b < firstDow; b++) calHtml += '<div></div>';

      log.forEach(function (day) {
        var d = day.date.split('-')[2];
        var bg = bgOf[day.status] || 'var(--sur2)';
        var clr = clrOf[day.status] || 'var(--tx3)';
        var lbl = day.status === 'WO' ? 'WO' : day.status;
        var hasTime = day.in && day.in !== '-' && day.in !== '';
        var tooltipStr = hasTime ? ('IN: ' + day.in + (day.out && day.out !== '-' ? ' | OUT: ' + day.out : '')) : '';

        calHtml += '<div style="padding:4px 1px;border-radius:6px;background:' + bg + ';text-align:center;' +
          (hasTime ? 'cursor:pointer;' : '') + 'border:1px solid ' + (hasTime ? clr + '44' : 'transparent') + '"' +
          (tooltipStr ? ' title="' + tooltipStr + '"' : '') + '>' +
          '<div style="font-size:9px;color:var(--tx3);font-weight:600">' + d + '</div>' +
          '<div style="font-size:9px;color:' + clr + ';font-weight:800">' + lbl + '</div>' +
          (hasTime ? '<div style="font-size:7.5px;color:' + clr + ';opacity:.75;line-height:1">' + day.in + '</div>' : '') +
          '</div>';
      });
      calHtml += '</div>';

      // ── Timing table ──────────────────────────────────────────────────────
      var presentLogs = log.filter(function (d) {return d.in && d.in !== '-' && d.in !== '';});
      var timingHtml = '';
      if (presentLogs.length > 0) {
        var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        timingHtml =
          '<div style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:6px">' +
          '<i class="fas fa-clock" style="color:var(--T)"></i> Punch Timing</div>' +
          '<div style="overflow-x:auto;border-radius:10px;border:1px solid var(--bdr)">' +
          '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
          '<thead><tr style="background:var(--sur2)">' +
          '<th style="padding:8px 12px;text-align:left;font-size:10px;color:var(--tx3);font-weight:800;text-transform:uppercase;border-bottom:1px solid var(--bdr)">Date</th>' +
          '<th style="padding:8px 10px;font-size:10px;color:var(--tx3);font-weight:800;text-transform:uppercase;border-bottom:1px solid var(--bdr)">Day</th>' +
          '<th style="padding:8px 10px;font-size:10px;font-weight:800;text-transform:uppercase;color:var(--G);border-bottom:1px solid var(--bdr)">IN ↓</th>' +
          '<th style="padding:8px 10px;font-size:10px;font-weight:800;text-transform:uppercase;color:var(--R);border-bottom:1px solid var(--bdr)">OUT ↑</th>' +
          '<th style="padding:8px 10px;text-align:center;font-size:10px;color:var(--tx3);font-weight:800;text-transform:uppercase;border-bottom:1px solid var(--bdr)">Hours</th>' +
          '<th style="padding:8px 10px;text-align:center;font-size:10px;color:var(--tx3);font-weight:800;text-transform:uppercase;border-bottom:1px solid var(--bdr)">Status</th>' +
          '</tr></thead><tbody>' +
          presentLogs.map(function (d, i) {
            var dow = DAY_NAMES[new Date(d.date + 'T00:00:00').getDay()];
            var dd = d.date.split('-')[2];
            var rowBg = i % 2 === 0 ? '' : 'background:var(--sur2)';
            var stClr = d.status === 'P' ? 'var(--G)' : d.status === 'HD' ? 'var(--T)' : 'var(--O)';
            var stBg = d.status === 'P' ? 'var(--Gl)' : d.status === 'HD' ? 'var(--Tl)' : 'var(--Ol)';
            var outVal = d.out && d.out !== '-' ? d.out : '—';
            var hrVal = d.hours && d.hours !== '-' ? d.hours : '—';
            return '<tr style="' + rowBg + ';border-bottom:1px solid var(--bdr)">' +
              '<td style="padding:9px 12px;font-weight:800;font-size:13px">' + dd + '</td>' +
              '<td style="padding:9px 10px;font-size:11px;color:var(--tx3);font-weight:600">' + dow + '</td>' +
              '<td style="padding:9px 10px;font-weight:800;font-size:13px;color:var(--G)">' + (d.in || '—') + '</td>' +
              '<td style="padding:9px 10px;font-weight:800;font-size:13px;color:var(--R)">' + outVal + '</td>' +
              '<td style="padding:9px 10px;text-align:center;font-size:12px;color:var(--tx2)">' + hrVal + '</td>' +
              '<td style="padding:9px 10px;text-align:center">' +
              '<span style="padding:2px 8px;border-radius:6px;font-size:10px;font-weight:800;background:' + stBg + ';color:' + stClr + '">' + d.status + '</span>' +
              '</td></tr>';
          }).join('') +
          '</tbody></table></div>';
      } else {
        timingHtml = '<div style="padding:14px;background:var(--sur2);border-radius:10px;font-size:12px;color:var(--tx3);text-align:center">' +
          '<i class="fas fa-clock-rotate-left" style="margin-bottom:6px;display:block;font-size:20px"></i>' +
          'Attendance timing data unavailable for this month</div>';
      }

      // ── Salary breakdown ──────────────────────────────────────────────────
      function srow(lbl, val, c, bold) {
        return '<tr><td style="padding:7px 12px;color:var(--tx2);font-size:13px' + (bold ? ';font-weight:800' : '') + '">' + lbl + '</td>' +
          '<td style="padding:7px 12px;font-weight:' + (bold ? '900' : '700') + ';text-align:right;font-size:13px;color:' + (c || 'var(--tx)') + '">₹' + _prFmt(val) + '</td></tr>';
      }

      var hasSalary = emp.basic_salary > 0;
      var salaryHtml = !hasSalary
        ? '<div style="padding:20px;text-align:center;background:var(--sur2);border-radius:10px;color:var(--O)">' +
        '<i class="fas fa-triangle-exclamation" style="font-size:24px;margin-bottom:8px;display:block"></i>' +
        '<div style="font-weight:700">Salary not configured in Doer List</div>' +
        '<div style="font-size:11px;color:var(--tx3);margin-top:4px">Doer List mein Basic Salary, HRA, PF etc. columns add karo</div>' +
        '</div>'
        : (function () {
          // Single compact salary table — works at any width
          function row(lbl, amt, c, bold) {
            return '<tr>' +
              '<td style="padding:6px 10px;font-size:12px;color:' + (bold ? 'var(--tx)' : 'var(--tx2)') +
              ';font-weight:' + (bold ? '800' : '500') + '">' + lbl + '</td>' +
              '<td style="padding:6px 10px;font-size:12px;font-weight:' + (bold ? '900' : '600') +
              ';text-align:right;color:' + (c || 'var(--tx)') + '">₹' + _prFmt(amt) + '</td>' +
              '</tr>';
          }
          var lwpRow = emp.lwp_days > 0
            ? row('LWP (' + emp.lwp_days + 'd × ₹' + _prFmt(emp.per_day_salary) + ')', emp.lwp_deduction, 'var(--R)')
            : '';

          return '' +
            // Compact two-column overview row
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">' +
            '<div style="background:var(--Gl);border-radius:8px;padding:10px;text-align:center">' +
            '<div style="font-size:9px;font-weight:800;color:var(--G);text-transform:uppercase">Gross</div>' +
            '<div style="font-size:16px;font-weight:900;color:var(--G)">₹' + _prFmt(emp.gross_salary) + '</div></div>' +
            '<div style="background:var(--Rl);border-radius:8px;padding:10px;text-align:center">' +
            '<div style="font-size:9px;font-weight:800;color:var(--R);text-transform:uppercase">Deductions</div>' +
            '<div style="font-size:16px;font-weight:900;color:var(--R)">₹' + _prFmt(emp.total_deductions) + '</div></div>' +
            '<div style="background:linear-gradient(135deg,var(--G),#059669);border-radius:8px;padding:10px;text-align:center">' +
            '<div style="font-size:9px;font-weight:800;color:#fff;opacity:.8;text-transform:uppercase">Net Pay</div>' +
            '<div style="font-size:18px;font-weight:900;color:#fff">₹' + _prFmt(emp.net_salary) + '</div></div>' +
            '</div>' +

            // Earnings + Deductions in one table with section headers
            '<div style="border:1px solid var(--bdr);border-radius:10px;overflow:hidden">' +
            '<table style="width:100%;border-collapse:collapse">' +

            // Earnings section header
            '<tr style="background:var(--Gl)">' +
            '<td colspan="2" style="padding:7px 10px;font-size:10px;font-weight:800;color:var(--G);text-transform:uppercase;letter-spacing:.5px">' +
            '<i class="fas fa-arrow-up-right-dots"></i> Earnings</td></tr>' +
            row('Basic Salary', emp.basic_salary) +
            (emp.hra > 0 ? row('HRA', emp.hra) : '') +
            (emp.conveyance > 0 ? row('Conveyance', emp.conveyance) : '') +
            (emp.other_allowances > 0 ? row('Other Allowances', emp.other_allowances) : '') +
            row('Gross Total', emp.gross_salary, 'var(--G)', true) +

            // Deductions section header
            '<tr style="background:var(--Rl)">' +
            '<td colspan="2" style="padding:7px 10px;font-size:10px;font-weight:800;color:var(--R);text-transform:uppercase;letter-spacing:.5px">' +
            '<i class="fas fa-arrow-down-wide-short"></i> Deductions</td></tr>' +
            (emp.pf_deduction > 0 ? row('PF', emp.pf_deduction, 'var(--R)') : '') +
            (emp.esi_deduction > 0 ? row('ESI', emp.esi_deduction, 'var(--R)') : '') +
            (emp.tds > 0 ? row('TDS', emp.tds, 'var(--R)') : '') +
            (emp.other_deductions > 0 ? row('Other', emp.other_deductions, 'var(--R)') : '') +
            lwpRow +
            row('Total Deductions', emp.total_deductions, 'var(--R)', true) +

            '</table></div>' +

            // Net pay footer
            '<div style="margin-top:12px;background:linear-gradient(135deg,var(--G),#059669);border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center">' +
            '<div><div style="font-size:9px;color:#fff;opacity:.8;text-transform:uppercase;font-weight:800">Net Salary Payable</div>' +
            '<div style="font-size:11px;color:#fff;opacity:.7">' + monthLbl + ' · ' + emp.payable_days + ' days</div></div>' +
            '<div style="font-size:24px;font-weight:900;color:#fff">₹' + _prFmt(emp.net_salary) + '</div>' +
            '</div>';
        })();


      // ── Tabbed modal content ──────────────────────────────────────────────
      var body =
        '<div style="margin-bottom:14px">' +
        '<div style="display:flex;gap:0;border:1px solid var(--bdr);border-radius:10px;overflow:hidden;background:var(--sur2)">' +
        '<button id="prTab_att" onclick="_prTab(\'att\')" style="flex:1;padding:9px 12px;border:none;background:var(--P);color:#fff;font-size:12px;font-weight:800;cursor:pointer;transition:.2s"><i class="fas fa-calendar-check"></i> Attendance</button>' +
        '<button id="prTab_sal" onclick="_prTab(\'sal\')" style="flex:1;padding:9px 12px;border:none;background:transparent;color:var(--tx2);font-size:12px;font-weight:700;cursor:pointer;transition:.2s"><i class="fas fa-indian-rupee-sign"></i> Salary</button>' +
        '</div></div>' +

        '<div id="prPanelAtt">' + headerHtml + calHtml + timingHtml + '</div>' +
        '<div id="prPanelSal" style="display:none">' + salaryHtml + '</div>';

      _openModal(
        '<div style="display:flex;align-items:center;gap:10px">' +
        _avatarEl(emp.emp_name, emp.photo, 34) +
        '<div><div style="font-weight:800;font-size:15px">' + _esc(emp.emp_name) + '</div>' +
        '<div style="font-size:11px;color:var(--tx3)">' + _esc(emp.dept) + ' · ' + _esc(monthLbl) + '</div></div>' +
        '<button class="btn btn-xs btn-outline" style="margin-left:auto" ' +
        'data-empid="' + _esc(emp.emp_id) + '" ' +
        'onclick="_prDownloadCard(this.getAttribute(\'data-empid\'))" title="Download salary card">' +
        '<i class="fas fa-download"></i> Download</button>' +
        '</div>',
        body
      );

      // Responsive modal sizing
      setTimeout(function () {
        var m = document.getElementById('modal');
        if (m) {
          var isMobile = window.innerWidth <= 640;
          m.style.maxWidth = isMobile ? '100%' : '720px';
          m.style.width = isMobile ? '100vw' : '96vw';
          m.style.margin = isMobile ? '0' : '';
          m.style.borderRadius = isMobile ? '16px 16px 0 0' : '';
        }
      }, 40);
    }

    // Tab switcher for salary sheet detail modal
    function _prTab(tab) {
      var att = document.getElementById('prPanelAtt');
      var sal = document.getElementById('prPanelSal');
      var btnA = document.getElementById('prTab_att');
      var btnS = document.getElementById('prTab_sal');
      if (tab === 'att') {
        if (att) att.style.display = '';
        if (sal) sal.style.display = 'none';
        if (btnA) {btnA.style.background = 'var(--P)'; btnA.style.color = '#fff';}
        if (btnS) {btnS.style.background = 'transparent'; btnS.style.color = 'var(--tx2)';}
      } else {
        if (att) att.style.display = 'none';
        if (sal) sal.style.display = '';
        if (btnA) {btnA.style.background = 'transparent'; btnA.style.color = 'var(--tx2)';}
        if (btnS) {btnS.style.background = 'var(--P)'; btnS.style.color = '#fff';}
      }
    }

    function _prExportCSV() {
      if (!_prData || !_prData.employees) return;
      var head = ['Emp ID', 'Name', 'Dept', 'Month', 'Working Days', 'Present', 'Half Day', 'Leave', 'Absent/LWP',
        'Week Off', 'Holidays', 'Payable Days',
        'Basic', 'HRA', 'Conv', 'Other Allow', 'Gross', 'PF', 'ESI', 'TDS', 'Other Ded', 'LWP Ded', 'Total Ded', 'Net Pay'];
      var rows = [head].concat((_prData.employees).map(function (e) {
        var hdCount = (e.daily_log || []).filter(function (d) { return d.status === 'HD'; }).length;
        return ['"' + e.emp_id + '"', '"' + e.emp_name + '"', '"' + e.dept + '"', _prData.month,
        e.total_working_days, e.present_days, hdCount, e.leave_days, (e.absent_days + e.lwp_days),
        (e.week_off_days || 0), (e.holiday_days || 0), (e.payable_days || 0),
        e.basic_salary, e.hra, e.conveyance, e.other_allowances, e.gross_salary,
        e.pf_deduction, e.esi_deduction, e.tds, e.other_deductions, e.lwp_deduction,
        e.total_deductions, e.net_salary];
      }));
      var csv = rows.map(function (r) {return r.join(',');}).join('\n');
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
      a.download = 'payroll_summary_' + (_prData.month || _currMonth()) + '.csv';
      a.click();
      _toast('Summary exported!', 'ok');
    }

    // Full Detail Export — Excel-friendly, all staff with IN/OUT + attendance + salary
    function _prExportDetailCSV() {
      if (!_prData || !_prData.employees) {_toast('No data loaded', 'err'); return;}
      var month = _prData.month || _currMonth();
      var emps = _prData.employees || [];
      var DAY_N = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      // Helper: escape for CSV
      function q(v) {return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';}

      var lines = [];

      // ── HEADER SECTION ──────────────────────────────────────────────────
      lines.push(q('SALARY SHEET — ' + month) + ',,,,,,,,,,,,,,,,,,,,,,,,,,,');
      lines.push(q('Generated: ' + new Date().toLocaleString('en-IN')) + ',,,,,,,,,,,,,,,,,,,,,,,,,,,');
      lines.push('');

      // ── SUMMARY TABLE ────────────────────────────────────────────────────
      lines.push(q('--- SALARY SUMMARY ---') + ',,,,,,,,,,,,,,,,,,,,,,,,,,,');
      var sumHead = [
        'Emp ID', 'Name', 'Department',
        'Working Days', 'Present', 'Half Day', 'Leave Days', 'Absent+LWP',
        'Payable Days',
        'Basic (₹)', 'HRA (₹)', 'Conv (₹)', 'Other Allow (₹)', 'Gross (₹)',
        'PF (₹)', 'ESI (₹)', 'TDS (₹)', 'Other Ded (₹)', 'LWP Ded (₹)', 'Total Ded (₹)',
        'NET PAY (₹)'
      ];
      lines.push(sumHead.map(q).join(','));

      emps.forEach(function (e) {
        lines.push([
          e.emp_id, e.emp_name, e.dept,
          e.total_working_days,
          e.present_days,
          // half day count from daily_log
          (e.daily_log || []).filter(function (d) {return d.status === 'HD';}).length,
          e.leave_days, (e.absent_days + e.lwp_days),
          e.payable_days,
          e.basic_salary, e.hra, e.conveyance, e.other_allowances, e.gross_salary,
          e.pf_deduction, e.esi_deduction, e.tds, e.other_deductions, e.lwp_deduction,
          e.total_deductions,
          e.net_salary
        ].map(q).join(','));
      });

      lines.push('');
      lines.push('');

      // ── DETAIL LOG TABLE ─────────────────────────────────────────────────
      lines.push(q('--- DAILY ATTENDANCE DETAIL ---') + ',,,,,,,,,,,');
      var detHead = [
        'Emp ID', 'Name', 'Department',
        'Date', 'Day', 'Status', 'IN Time', 'OUT Time', 'Hours Worked',
        'Leave Type', 'Remark'
      ];
      lines.push(detHead.map(q).join(','));

      emps.forEach(function (e) {
        var log = e.daily_log || [];
        if (!log.length) {
          lines.push([e.emp_id, e.emp_name, e.dept, '—', '—', '—', '—', '—', '—', '—', '—'].map(q).join(','));
          return;
        }
        // Blank separator row before each employee's days
        lines.push([e.emp_id, e.emp_name + ' (' + e.dept + ')', '', '', '', '', '', '', '', '', ''].map(q).join(','));
        log.forEach(function (d) {
          var dow = DAY_N[new Date(d.date + 'T00:00:00').getDay()];
          var ltype = (d.status !== 'P' && d.status !== 'HD' && d.status !== 'A' && d.status !== 'WO' && d.status !== 'H') ? d.status : '';
          var stLabel = d.status === 'P' ? 'Present' : d.status === 'HD' ? 'Half Day' : d.status === 'A' ? 'Absent' : d.status === 'WO' ? 'Week Off' : d.status === 'H' ? 'Holiday' : ltype || d.status;
          lines.push([
            '', '', '',   // emp cols blank after header row
            d.date, dow, stLabel,
            d.in || '—', d.out || '—', d.hours || '—',
            ltype, ''
          ].map(q).join(','));
        });
        // Per-employee salary footer row
        lines.push(['', '', '', '', '', '', '', '', '', 'GROSS: ₹' + _prFmt(e.gross_salary) + ' | DED: ₹' + _prFmt(e.total_deductions) + ' | NET: ₹' + _prFmt(e.net_salary), ''].map(q).join(','));
        lines.push('');
      });

      var csv = lines.join('\n');
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
      a.download = 'salary_full_detail_' + month + '.csv';
      a.click();
      _toast('Full detail exported — Excel mein kholo!', 'ok');
    }

    // Download individual employee salary card — polished Excel-friendly CSV
    function _prDownloadCard(empId) {
      if (!_prData) {_toast('No data loaded', 'err'); return;}
      var emp = null;
      (_prData.employees || []).forEach(function (e) {if (e.emp_id === empId) emp = e;});
      if (!emp) {_toast('Employee not found', 'err'); return;}
      var month = _prData.month || _currMonth();
      var log = emp.daily_log || [];
      var DAY_N = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      var SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      function q(v) {return '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';}
      function row2(a, b) {return q(a) + ',' + q(b);}
      function blank() {return ',';}

      var lines = [];
      // ── Title ──
      lines.push(q('SALARY CARD') + ',' + q(emp.emp_name));
      lines.push(q('Employee ID') + ',' + q(emp.emp_id));
      lines.push(q('Department') + ',' + q(emp.dept));
      lines.push(q('Month') + ',' + q(month));
      lines.push('');

      // ── Attendance Summary ──
      lines.push(q('ATTENDANCE SUMMARY') + ',');
      lines.push(row2('Working Days', emp.total_working_days));
      lines.push(row2('Present (Full Day)', emp.present_days));
      lines.push(row2('Half Day', log.filter(function (d) {return d.status === 'HD';}).length));
      lines.push(row2('Paid Leave', emp.leave_days));
      lines.push(row2('Absent / LWP', emp.absent_days + emp.lwp_days));
      lines.push(row2('Holidays', emp.holiday_days));
      lines.push(row2('Week Off', emp.week_off_days));
      lines.push(row2('Payable Days', emp.payable_days));
      lines.push('');

      // ── Earnings ──
      lines.push(q('EARNINGS') + ',');
      if (emp.basic_salary) lines.push(row2('Basic Salary', '₹' + _prFmt(emp.basic_salary)));
      if (emp.hra) lines.push(row2('HRA', '₹' + _prFmt(emp.hra)));
      if (emp.conveyance) lines.push(row2('Conveyance', '₹' + _prFmt(emp.conveyance)));
      if (emp.other_allowances) lines.push(row2('Other Allowances', '₹' + _prFmt(emp.other_allowances)));
      lines.push(row2('GROSS SALARY', '₹' + _prFmt(emp.gross_salary)));
      lines.push('');

      // ── Deductions ──
      lines.push(q('DEDUCTIONS') + ',');
      if (emp.pf_deduction) lines.push(row2('PF', '₹' + _prFmt(emp.pf_deduction)));
      if (emp.esi_deduction) lines.push(row2('ESI', '₹' + _prFmt(emp.esi_deduction)));
      if (emp.tds) lines.push(row2('TDS', '₹' + _prFmt(emp.tds)));
      if (emp.other_deductions) lines.push(row2('Other', '₹' + _prFmt(emp.other_deductions)));
      if (emp.lwp_deduction) lines.push(row2('LWP Deduction', '₹' + _prFmt(emp.lwp_deduction)));
      lines.push(row2('TOTAL DEDUCTIONS', '₹' + _prFmt(emp.total_deductions)));
      lines.push('');
      lines.push(row2('NET SALARY PAYABLE', '₹' + _prFmt(emp.net_salary)));
      lines.push('');

      // ── Daily Log ──
      lines.push(q('DAILY ATTENDANCE LOG') + ',');
      lines.push([q('Date'), q('Day'), q('Status'), q('IN'), q('OUT'), q('Hours')].join(','));
      log.forEach(function (d) {
        var dow = DAY_N[new Date(d.date + 'T00:00:00').getDay()];
        var stLabel = d.status === 'P' ? 'Present' : d.status === 'HD' ? 'Half Day' : d.status === 'A' ? 'Absent' : d.status === 'WO' ? 'Week Off' : d.status === 'H' ? 'Holiday' : d.status;
        lines.push([q(d.date), q(dow), q(stLabel), q(d.in || '—'), q(d.out || '—'), q(d.hours || '—')].join(','));
      });

      var csv = lines.join('\n');
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,\uFEFF' + encodeURIComponent(csv);
      var safeName = (emp.emp_name || emp.name || emp.emp_id || 'employee').replace(/[^a-zA-Z0-9_\-]/g, '_');
      a.download = 'salary_card_' + safeName + '_' + month + '.csv';
      a.click();
      _toast('Salary card downloaded!', 'ok');
    }

    /* ══════════════════════════════════════════════════════════════════════
       HOLIDAY CALENDAR MODULE
       Shows a full-year calendar with public holidays highlighted.
       Includes summary cards and an upcoming holidays list.
    ══════════════════════════════════════════════════════════════════════ */

    function _vHolCal() {
      var curYear = new Date().getFullYear();
      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div><div class="mod-title">Holiday Calendar</div><div class="mod-sub">Public holidays and company observances</div></div>' +
        '<div class="mod-head-right">' +
        '<label style="font-size:12px;font-weight:700;color:var(--tx2)">Year:</label>' +
        '<select id="holYear" onchange="_loadHolidays()" style="padding:6px 10px;border:1.5px solid var(--bdr);border-radius:8px;font-size:12px;background:var(--bg);color:var(--tx);outline:none">' +
        [curYear - 1, curYear, curYear + 1].map(function (y) {
          return '<option value="' + y + '"' + (y === curYear ? ' selected' : '') + '>' + y + '</option>';
        }).join('') +
        '</select>' +

        '</div>' +
        '</div>' +
        '<div class="krow" id="holKrow">' +
        [1, 2, 3].map(function () {return '<div class="sk sk-h6" style="border-radius:14px"></div>';}).join('') +
        '</div>' +
        '<div style="display:grid;grid-template-columns:2fr 1fr;gap:18px;margin-top:16px">' +
        '<div>' +
        '<div class="card card-nohover card-sm" style="margin-bottom:16px">' +
        '<div class="sec-title" style="margin-bottom:14px"><i class="fas fa-calendar-days" style="color:var(--P)"></i> All Holidays</div>' +
        '<div id="holList">' + _skel(5, 'sk-h3') + '</div>' +
        '</div>' +
        '</div>' +
        '<div>' +
        '<div class="card card-nohover card-sm">' +
        '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-clock" style="color:var(--O)"></i> Upcoming</div>' +
        '<div id="holUpcoming">' + _skel(3, 'sk-h3') + '</div>' +
        '</div>' +
        '</div>' +
        '</div>';

      _loadHolidays();
    }

    function _loadHolidays() {
      var year = document.getElementById('holYear') ? parseInt(document.getElementById('holYear').value) : new Date().getFullYear();
      var kEl = document.getElementById('holKrow');
      var lEl = document.getElementById('holList');
      var uEl = document.getElementById('holUpcoming');

      // Always force fresh from sheet (never use login-time cache)
      _D.holidays = null; _D.holidayYear = null;

      if (kEl) kEl.innerHTML = [1, 2, 3].map(function () {return '<div class="sk sk-h6" style="border-radius:14px"></div>';}).join('');
      if (lEl) lEl.innerHTML = _skel(5, 'sk-h3');
      if (uEl) uEl.innerHTML = _skel(3, 'sk-h3');

      _gas('getHolidayList', [year], function (holidays) {
        _D.holidays = holidays || [];
        _D.holidayYear = year;
        _renderHolidayData(_D.holidays, year, kEl, lEl, uEl);  // single render
      }, function (e) {
        if (kEl) kEl.innerHTML = '';
        if (lEl) lEl.innerHTML = '<div class="te"><i class="fas fa-exclamation-triangle"></i> Error loading holidays: ' + _esc(e.message) + '</div>';
      });
    }

    function _renderHolidayData(holidays, year, kEl, lEl, uEl) {
      var today = _today();
      var future = (holidays || []).filter(function (h) {return h.date >= today;});
      var past = (holidays || []).filter(function (h) {return h.date < today;});
      var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      if (kEl) kEl.innerHTML = [
        {lbl: 'Total Holidays', val: (holidays || []).length, c: 'var(--P)', ico: 'fa-umbrella-beach'},
        {lbl: 'Upcoming', val: future.length, c: 'var(--G)', ico: 'fa-forward'},
        {lbl: 'Already Passed', val: past.length, c: 'var(--tx2)', ico: 'fa-backward'}
      ].map(function (k) {
        return '<div class="kpi" style="--kc:' + k.c + '">' +
          '<div class="kpi-ico"><i class="fas ' + k.ico + '"></i></div>' +
          '<div class="kpi-val">' + k.val + '</div>' +
          '<div class="kpi-lbl">' + k.lbl + '</div></div>';
      }).join('');

      if (lEl) {
        if (!holidays || !holidays.length) {
          lEl.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-xmark"></i>' +
            '<h4>No Holidays Found</h4>' +
            '<p>Add holidays to the <b>Holiday List</b> sheet in the Master spreadsheet.</p>' +
            '<p style="font-size:11px;color:var(--tx3);margin-top:8px">Required columns: <code>Date</code> &nbsp; <code>Holiday</code> &nbsp; <code>Type</code></p>' +
            '</div>';
        } else {
          var byMonth = {};
          holidays.forEach(function (h) {
            var mo = h.date ? h.date.substring(5, 7) : '00';
            if (!byMonth[mo]) byMonth[mo] = [];
            byMonth[mo].push(h);
          });
          lEl.innerHTML = Object.keys(byMonth).sort().map(function (mo) {
            var moName = MONTHS[parseInt(mo) - 1] || mo;
            return '<div style="margin-bottom:16px">' +
              '<div style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid var(--bdr)">' + moName + ' ' + year + '</div>' +
              byMonth[mo].map(function (h) {
                var isPast = h.date < today;
                var d = new Date(h.date + 'T00:00:00');
                var dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
                return '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--bdr2);opacity:' + (isPast ? '.6' : '1') + '">' +
                  '<div style="width:40px;height:40px;border-radius:10px;background:' + (isPast ? 'var(--bdr)' : 'var(--Pl)') + ';color:' + (isPast ? 'var(--tx3)' : 'var(--P)') + ';display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0">' +
                  '<div style="font-size:16px;font-weight:900;line-height:1">' + h.date.slice(8) + '</div>' +
                  '<div style="font-size:9px;font-weight:700;letter-spacing:.3px">' + dow + '</div></div>' +
                  '<div style="flex:1;min-width:0">' +
                  '<div style="font-size:13px;font-weight:700;' + (isPast ? 'text-decoration:line-through' : '') + '">' + _esc(h.name) + '</div>' +
                  (h.description ? '<div style="font-size:11.5px;color:var(--tx3)">' + _esc(h.description) + '</div>' : '') +
                  '<span class="bdg" style="background:var(--Pl);color:var(--P);font-size:10px">' + _esc(h.type || 'Public Holiday') + '</span>' +
                  '</div></div>';
              }).join('') + '</div>';
          }).join('');
        }
      }

      if (uEl) {
        var upcoming = future.slice(0, 8);
        if (!upcoming.length) {
          uEl.innerHTML = '<div style="text-align:center;color:var(--tx3);font-size:12px;padding:20px 0"><i class="fas fa-calendar-check"></i><br>No upcoming holidays</div>';
        } else {
          uEl.innerHTML = upcoming.map(function (h) {
            var d = new Date(h.date + 'T00:00:00');
            var diff = Math.ceil((d - new Date()) / 864e5);
            var dow = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
            return '<div style="padding:10px 0;border-bottom:1px solid var(--bdr)">' +
              '<div style="font-size:13px;font-weight:700;margin-bottom:3px">' + _esc(h.name) + '</div>' +
              '<div style="font-size:11.5px;color:var(--tx2);margin-bottom:3px">' + dow + ', ' + _fmtDate(h.date) + '</div>' +
              '<div style="font-size:11px;font-weight:800;color:' + (diff <= 7 ? 'var(--O)' : 'var(--P)') + '">' +
              (diff === 0 ? 'Today!' : diff === 1 ? 'Tomorrow' : 'In ' + diff + ' days') + '</div></div>';
          }).join('');
        }
      }
    }
    function _exportHolidays() {
      var data = _D.holidays || [];
      if (!data.length) {_toast('Load holidays first', 'warn'); return;}
      var rows = [['Date', 'Holiday Name', 'Type', 'Description']];
      data.forEach(function (h) {rows.push([h.date, h.name, h.type, h.description]);});
      _downloadCSV('holidays_' + (document.getElementById('holYear') ? document.getElementById('holYear').value : new Date().getFullYear()) + '.csv', rows);
      _toast('Holiday list exported!', 'ok');
    }

    /* ══════════════════════════════════════════════════════════════════════
       ACTIVITY FEED MODULE
       Shows recent personal activity: tasks done, delegations, leaves.
       Auto-refreshes every 60 seconds when on this view.
    ══════════════════════════════════════════════════════════════════════ */
    function _vFeed() {
      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div><div class="mod-title">Activity Feed</div><div class="mod-sub">Your recent actions from the last 7 days</div></div>' +
        '<button class="btn btn-outline btn-sm" onclick="_loadFeed()"><i class="fas fa-rotate-right"></i> Refresh</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 320px;gap:18px">' +
        '<div>' +
        '<div id="feedList">' + _skel(6, 'sk-h4') + '</div>' +
        '</div>' +
        '<div>' +
        '<div class="card card-nohover card-sm" style="position:sticky;top:80px">' +
        '<div class="sec-title" style="margin-bottom:12px"><i class="fas fa-info-circle" style="color:var(--P)"></i> Activity Types</div>' +
        [
          {type: 'task_done', lbl: 'Task Completed', ico: 'fa-check-circle', c: 'var(--G)', bg: 'var(--Gl)'},
          {type: 'del_in', lbl: 'Task Delegated to Me', ico: 'fa-inbox', c: 'var(--P)', bg: 'var(--Pl)'},
          {type: 'del_out', lbl: 'Task I Delegated', ico: 'fa-paper-plane', c: 'var(--V)', bg: 'var(--Vl)'}
        ].map(function (t) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bdr2)">' +
            '<div style="width:28px;height:28px;border-radius:7px;background:' + t.bg + ';color:' + t.c + ';display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0"><i class="fas ' + t.ico + '"></i></div>' +
            '<span style="font-size:12px;font-weight:600">' + t.lbl + '</span>' +
            '</div>';
        }).join('') +
        '</div>' +
        '</div>' +
        '</div>';

      _loadFeed();
      _startPoll('feed', _loadFeed, 60000);
    }

    function _loadFeed() {
      var el = document.getElementById('feedList');
      if (!el) return;

      _gas('getRecentActivity', [], function (items) {
        if (!items || !items.length) {
          el.innerHTML = '<div class="empty-state"><i class="fas fa-bolt-lightning"></i><h4>No Recent Activity</h4><p>Your completed tasks and delegation activity from the last 7 days will appear here.</p></div>';
          return;
        }

        var typeMap = {
          task_done: {lbl: 'Task Done', ico: 'fa-check-circle', c: 'var(--G)', bg: 'var(--Gl)'},
          del_in: {lbl: 'Task Received', ico: 'fa-inbox', c: 'var(--P)', bg: 'var(--Pl)'},
          del_out: {lbl: 'Task Delegated', ico: 'fa-paper-plane', c: 'var(--V)', bg: 'var(--Vl)'}
        };

        el.innerHTML = items.map(function (item) {
          var tm = typeMap[item.type] || {lbl: item.type, ico: 'fa-circle', c: 'var(--tx2)', bg: 'var(--bg)'};
          return '<div class="ann-card" style="display:flex;gap:14px;align-items:flex-start;margin-bottom:10px;border-left-color:' + tm.c + '">' +
            '<div style="width:36px;height:36px;border-radius:10px;background:' + tm.bg + ';color:' + tm.c + ';display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;margin-top:2px"><i class="fas ' + tm.ico + '"></i></div>' +
            '<div style="flex:1;min-width:0">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
            '<span style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">' + _esc(item.label || '—') + '</span>' +
            '<span class="bdg" style="background:' + tm.bg + ';color:' + tm.c + ';flex-shrink:0">' + tm.lbl + '</span>' +
            '</div>' +
            '<div style="font-size:11.5px;color:var(--tx3);display:flex;gap:12px">' +
            '<span><i class="fas fa-calendar"></i> ' + _fmtDate(item.date) + '</span>' +
            (item.actual_dt && item.actual_dt !== item.date ? '<span><i class="fas fa-clock"></i> Done: ' + _fmtDate(item.actual_dt) + '</span>' : '') +
            '</div>' +
            '</div>' +
            '</div>';
        }).join('');
      }, function (e) {
        el.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';
      });
    }

    /* ══════════════════════════════════════════════════════════════════════
       ANNOUNCEMENTS MODULE
       Displays announcements with search, priority filter, and post form
       for managers. Shows badge count on sidebar.
    ══════════════════════════════════════════════════════════════════════ */
    function _vAnn() {
      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div><div class="mod-title">Announcements</div><div class="mod-sub">Company news, policy updates and important notices</div></div>' +
        '<div class="mod-head-right">' +
        '<div class="search-inp"><i class="fas fa-search"></i>' +
        '<input type="text" placeholder="Search announcements…" oninput="_filterAnns(this.value)" style="border:none;background:transparent;outline:none;font-size:12.5px;color:var(--tx);padding-left:4px;width:180px">' +
        '</div>' +
        (_isManager() ? '<button class="btn btn-sm" onclick="_openPostAnn()"><i class="fas fa-bullhorn"></i> Post Announcement</button>' : '') +
        '</div>' +
        '</div>' +
        '<div id="annPriorityBar" style="display:flex;gap:8px;margin-bottom:16px">' +
        ['All', 'High', 'Normal', 'Low'].map(function (p, i) {
          return '<button class="btn btn-outline btn-xs ' + (i === 0 ? 'active' : '') + '" ' +
            'onclick="_filterAnnsByPriority(\'' + p + '\',this)">' + p + '</button>';
        }).join('') +
        '</div>' +
        '<div id="annList">' + _skel(4, 'sk-h4') + '</div>';

      _loadAnns();
    }

    function _loadAnns() {
      var el = document.getElementById('annList');
      if (!el) return;

      _gas('getAnnouncements', [], function (anns) {
        _D.announcements = anns || [];
        if (!anns.length) {
          el.innerHTML = '<div class="empty-state"><i class="fas fa-bullhorn"></i><h4>No Announcements</h4><p>All clear! No active announcements at this time.</p></div>';
          return;
        }

        var priorityColors = {High: 'var(--R)', Normal: 'var(--P)', Low: 'var(--tx3)'};
        var priorityBgs = {High: 'var(--Rl)', Normal: 'var(--Pl)', Low: 'var(--bg)'};
        var priorityIcos = {High: 'fa-fire', Normal: 'fa-bell', Low: 'fa-circle-info'};

        el.innerHTML = anns.map(function (a) {
          var pClr = priorityColors[a.priority] || 'var(--P)';
          var pBg = priorityBgs[a.priority] || 'var(--Pl)';
          var pIco = priorityIcos[a.priority] || 'fa-bell';
          return '<div class="ann-card" data-ann-priority="' + _esc(a.priority) + '" style="border-left-color:' + pClr + '">' +
            '<div style="display:flex;align-items:flex-start;gap:12px">' +
            '<div style="width:36px;height:36px;border-radius:10px;background:' + pBg + ';color:' + pClr + ';display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;margin-top:2px"><i class="fas ' + pIco + '"></i></div>' +
            '<div style="flex:1;min-width:0">' +
            '<div style="font-size:14px;font-weight:700;line-height:1.5;margin-bottom:8px">' + _esc(a.text) + '</div>' +
            '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">' +
            '<span class="bdg" style="background:' + pBg + ';color:' + pClr + '">' + _esc(a.priority) + '</span>' +
            '<span style="font-size:11.5px;color:var(--tx3)"><i class="fas fa-user"></i> ' + _esc(a.posted_by || 'Admin') + '</span>' +
            '<span style="font-size:11.5px;color:var(--tx3)"><i class="fas fa-clock"></i> ' + _fmtDateTime(a.posted_at) + '</span>' +
            '</div>' +
            '</div>' +
            (_isManager() ?
              '<button class="btn btn-outline btn-xs btn-red" onclick="_deleteAnn(\'' + _esc(a.ann_id) + '\')" title="Delete announcement">' +
              '<i class="fas fa-trash"></i>' +
              '</button>' : '') +
            '</div>' +
            '</div>';
        }).join('');
      }, function (e) {el.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';});
    }

    function _filterAnnsByPriority(p, btn) {
      document.querySelectorAll('#annPriorityBar .btn').forEach(function (b) {b.classList.remove('active');});
      if (btn) btn.classList.add('active');
      document.querySelectorAll('.ann-card').forEach(function (c) {
        var pr = c.getAttribute('data-ann-priority') || '';
        c.style.display = p === 'All' || pr === p ? '' : 'none';
      });
    }

    function _openPostAnn() {
      _openModal(
        '<i class="fas fa-bullhorn" style="color:var(--O)"></i> Post Announcement',
        '<div class="fgrp"><label>Announcement Text <span class="req">★</span></label>' +
        '<textarea id="mAnnText" rows="4" placeholder="Type your announcement here…" style="resize:vertical"></textarea>' +
        '</div>' +
        '<div class="fgrp"><label>Priority</label>' +
        '<select id="mAnnPriority">' +
        '<option value="Normal">Normal</option><option value="High">High</option><option value="Low">Low</option>' +
        '</select>' +
        '</div>' +
        '<div class="tip"><i class="fas fa-info-circle"></i> High priority announcements are shown at the top with a red accent.</div>',
        function () {
          var text = document.getElementById('mAnnText') ? document.getElementById('mAnnText').value.trim() : '';
          var prio = document.getElementById('mAnnPriority') ? document.getElementById('mAnnPriority').value : 'Normal';
          if (!text) {_toast('Please enter announcement text', 'err'); return;}
          if (!_maxLen(text, 500, 'Announcement')) return;
          _closeModal();
          _gas('postAnnouncement', [text, prio], function () {
            _toast('Announcement posted!', 'ok');
            _addNtf('Announcement posted', 'fa-bullhorn', 'var(--Ol)', 'var(--O)');
            _loadAnns();
            _loadAnnBadge();
          }, function (e) {_toast('Error: ' + e.message, 'err');});
        },
        '<i class="fas fa-paper-plane"></i> Post'
      );
    }

    function _deleteAnn(annId) {
      _openModal(
        '<i class="fas fa-trash" style="color:var(--R)"></i> Delete Announcement',
        '<p style="font-size:14px;color:var(--tx2)">Remove this announcement? It will no longer be visible to staff.</p>',
        function () {
          _closeModal();
          _gas('deleteAnnouncement', [annId], function () {
            _toast('Announcement removed', 'ok');
            _loadAnns();
            _loadAnnBadge();
          }, function (e) {_toast('Error: ' + e.message, 'err');});
        },
        '<i class="fas fa-trash"></i> Delete'
      );
    }

    /* ══════════════════════════════════════════════════════════════════════
       FORMAT UTILITY FUNCTIONS
       Used throughout all modules for consistent date / time display.
    ══════════════════════════════════════════════════════════════════════ */

    /* Format ISO date string to "15 Jan 2026" */
    function _fmtDate(ds) {
      if (!ds) return '—';
      try {
        var s = String(ds).substring(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {var dp = _parseAnyDate(String(ds)); if (dp) {s = dp.getFullYear() + '-' + ('0' + (dp.getMonth() + 1)).slice(-2) + '-' + ('0' + dp.getDate()).slice(-2);} else return String(ds).substring(0, 16);}
        var d = new Date(s + 'T00:00:00'); if (isNaN(d)) return String(ds).substring(0, 10);
        var mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return d.getDate() + ' ' + mn[d.getMonth()] + ' ' + d.getFullYear();
      } catch (e) {return String(ds).substring(0, 16);}
    }

    /* Short format: "8 Aug 2026" (always with year) */
    function _fmtDateShort(ds) {
      if (!ds) return '—';
      try {
        var d = _parseAnyDate ? _parseAnyDate(String(ds)) : new Date(String(ds).substring(0, 10) + 'T00:00:00');
        if (!d || isNaN(d)) return String(ds).substring(0, 10);
        var mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return d.getDate() + ' ' + mn[d.getMonth()] + ' ' + d.getFullYear();
      } catch (e) {return String(ds).substring(0, 10);}
    }

    /* Format to "8 Aug 2026 2:30 PM" */
    function _fmtDateTime(ds) {
      if (!ds) return '—';
      try {
        var d = _parseAnyDate ? _parseAnyDate(String(ds)) : new Date(String(ds).replace(' ', 'T'));
        if (!d || isNaN(d)) return String(ds).substring(0, 16);
        var mn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var h = d.getHours(), m = d.getMinutes();
        return d.getDate() + ' ' + mn[d.getMonth()] + ' ' + d.getFullYear() + ' ' + (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h >= 12 ? ' PM' : ' AM');
      } catch (e) {return String(ds).substring(0, 16);}
    }

    /* Format ISO timestamp to relative "2 hours ago" */
    function _fmtTimestamp(ts) {
      if (!ts) return '';
      var d = new Date(ts);
      var diff = Date.now() - d.getTime();
      if (isNaN(diff)) return ts.substring(0, 16);
      var mins = Math.floor(diff / 60000);
      var hours = Math.floor(diff / 3600000);
      var days = Math.floor(diff / 86400000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return mins + ' min ago';
      if (hours < 24) return hours + ' hr ago';
      if (days < 7) return days + ' day' + (days > 1 ? 's' : '') + ' ago';
      return _fmtDate(ts.substring(0, 10));
    }

    /* Return today as "YYYY-MM-DD" (IST) — keep in sync with helpers above */
    function _today() { return _istNow().toISOString().slice(0, 10); }

    /* Return "YYYY-MM" for current month (IST) */
    function _currMonth() { return _istNow().toISOString().slice(0, 7); }

    /* Return "YYYY-MM-DD" for n days ago (IST) */
    function _daysAgo(n) {
      var d = _istNow();
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    }

    /* HTML-escape a string to prevent XSS */
    function _esc(str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    /* Get initials from a full name: "John Doe" → "JD" */
    function _initials(name) {
      if (!name) return '?';
      var parts = String(name).trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      return name.substring(0, 2).toUpperCase();
    }

    /* Status badge HTML — color-coded pill */
    function _statusBadge(status) {
      var colorMap = {
        Done: 'var(--G)', Completed: 'var(--G)', Approved: 'var(--G)', P: 'var(--G)',
        Pending: 'var(--O)', Shifted: 'var(--V)', Rejected: 'var(--R)',
        Overdue: 'var(--R)', A: 'var(--R)', Cancelled: 'var(--tx3)', Holiday: '#4338ca', H: '#4338ca',
        WO: 'var(--tx3)', HD: 'var(--O)'
      };
      var bgMap = {
        Done: 'var(--Gl)', Completed: 'var(--Gl)', Approved: 'var(--Gl)', P: 'var(--Gl)',
        Pending: 'var(--Ol)', Shifted: 'var(--Vl)', Rejected: 'var(--Rl)',
        Overdue: 'var(--Rl)', A: 'var(--Rl)', Cancelled: 'var(--bg)', Holiday: '#e0e7ff', H: '#e0e7ff',
        WO: 'var(--bg)', HD: 'var(--Ol)'
      };
      // Attendance codes are stored as single letters internally (P/HD/A/WO/H)
      // but should always display as full words — showing raw codes here was
      // making attendance records look cryptic/wrong even when correct.
      var labelMap = {P: 'Present', HD: 'Half Day', A: 'Absent', WO: 'Week Off', H: 'Holiday'};
      var c = colorMap[status] || 'var(--tx2)';
      var bg = bgMap[status] || 'var(--bg)';
      var label = labelMap[status] || status || '—';
      return '<span style="display:inline-flex;align-items:center;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:' + bg + ';color:' + c + ';letter-spacing:.3px;white-space:nowrap">' + _esc(label) + '</span>';
    }

    // Late/On Time badge — companion to _statusBadge for attendance rows.
    // Only meaningful for days actually worked (Present/Half Day); for
    // Absent/Week Off/Holiday rows there's no check-in to judge, so this
    // renders nothing. officeIn (optional) shows up as a tooltip so it's
    // obvious exactly what time this row was compared against — if that's
    // wrong, the fix is in the Doer List's Office IN column, not the code.
    function _lateBadge(isLate, status, officeIn) {
      if (status !== 'P' && status !== 'HD') return '';
      var tip = officeIn ? ' title="Compared against Office IN: ' + _esc(officeIn) + '"' : '';
      return isLate
        ? '<span' + tip + ' style="display:inline-flex;align-items:center;gap:3px;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--Ol);color:var(--O);letter-spacing:.3px;white-space:nowrap"><i class="fas fa-clock" style="font-size:9px"></i>Late</span>'
        : '<span' + tip + ' style="display:inline-flex;align-items:center;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:var(--Gl);color:var(--G);letter-spacing:.3px;white-space:nowrap">On Time</span>';
    }

    /* Frequency badge: D → Daily, W → Weekly, M → Monthly */
    function _freqBadge(freq) {
      var lbl = freq === 'D' ? 'Daily' : freq === 'W' ? 'Weekly' : freq === 'M' ? 'Monthly' : freq || '—';
      return '<span style="display:inline-flex;font-size:10px;font-weight:800;padding:1px 7px;border-radius:999px;background:var(--Pl);color:var(--P)">' + lbl + '</span>';
    }

    /* Color for status: returns a CSS color string */
    function _colorForStatus(status) {
      var map = {
        Done: 'var(--G)', Completed: 'var(--G)', Approved: 'var(--G)',
        Pending: 'var(--O)', Shifted: 'var(--V)',
        Overdue: 'var(--R)', Rejected: 'var(--R)', Cancelled: 'var(--tx3)'
      };
      return map[status] || 'var(--tx3)';
    }

    /* Skeleton loader helper: n rows of type cls (default sk-h4) */

    /* Role-based check: true if logged-in user is Manager or Owner */
    function _isManager() {
      if (!_U) return false;
      var r = String((_U || {}).role || '').toUpperCase();
      return r === 'OWNER' || r === 'MANAGER';
    }

    function _isMarkAttendanceAllowed() {
      if (!_U) return false;
      var r = String((_U || {}).role || '').toUpperCase();
      return r === 'OWNER' || r === 'MANAGER' || r === 'COORDINATOR';
    }

    /* ══════════════════════════════════════════════════════════════════════
       KEYBOARD SHORTCUTS PANEL
       Shows all available keyboard shortcuts in a modal dialog.
    ══════════════════════════════════════════════════════════════════════ */
    function _showShortcuts() {
      var shortcuts = [
        {key: '⌘ K / Ctrl+K', desc: 'Open global search'},
        {key: '? ', desc: 'Show keyboard shortcuts'},
        {key: 'Esc', desc: 'Close modal / search / panel'},
        {key: 'G D', desc: 'Go to Dashboard'},
        {key: 'G C', desc: 'Go to Checklist'},
        {key: 'G E', desc: 'Go to Delegation'},
        {key: 'G A', desc: 'Go to Attendance'},
        {key: 'G L', desc: 'Go to Leave Management'},
        {key: 'G H', desc: 'Go to Holiday Calendar'},
        {key: 'G P', desc: 'Go to Profile'},
        {key: 'G N', desc: 'Go to Announcements'},
        {key: 'G F', desc: 'Go to Activity Feed'}
      ];

      _openModal(
        '<i class="fas fa-keyboard" style="color:var(--P)"></i> Keyboard Shortcuts',
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        shortcuts.map(function (s) {
          return '<div style="display:flex;align-items:center;gap:10px;padding:8px;background:var(--bg);border:1px solid var(--bdr);border-radius:8px">' +
            '<kbd style="display:inline-flex;align-items:center;background:var(--sur2);border:1px solid var(--bdr2);border-radius:5px;padding:2px 8px;font-size:11px;font-weight:800;font-family:monospace;white-space:nowrap">' + _esc(s.key) + '</kbd>' +
            '<span style="font-size:12px;color:var(--tx2)">' + _esc(s.desc) + '</span>' +
            '</div>';
        }).join('') +
        '</div>',
        null, null, true
      );

      // Remove confirm button from footer for this dialog
      setTimeout(function () {
        var foot = document.getElementById('mFoot');
        if (foot) foot.innerHTML = '<button class="btn" onclick="_closeModal()"><i class="fas fa-times"></i> Close</button>';
      }, 30);
    }

    /* ── Keyboard listener for shortcut navigation ── */
    (function _registerShortcuts() {
      var _lastKey = null;
      var _lastKeyTs = 0;
      document.addEventListener('keydown', function (e) {
        // Skip if user is typing in an input
        var tag = document.activeElement && document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        // ⌘K / Ctrl+K — global search
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          _openGS();
          return;
        }

        // ? — keyboard shortcuts
        if (e.key === '?') {_showShortcuts(); return;}

        var now = Date.now();
        if (e.key === 'g' || e.key === 'G') {_lastKey = 'g'; _lastKeyTs = now; return;}

        if (_lastKey === 'g' && (now - _lastKeyTs) < 1000) {
          _lastKey = null;
          switch (e.key.toLowerCase()) {
            case 'd': _loadV('dash'); break;
            case 'c': _loadV('check'); break;
            case 'e': _loadV('deleg'); break;
            case 'a': _loadV('attend'); break;
            case 'l': _loadV('leave'); break;
            case 'h': _loadV('holcal'); break;
            case 'p': _loadV('profile'); break;
            case 'n': _loadV('ann'); break;
            case 'f': _loadV('feed'); break;
            case 'm': if (_isManager()) _loadV('muster'); break;
          }
          return;
        }

        _lastKey = null;
        _lastKeyTs = 0;
      });
    }());

    /* ══════════════════════════════════════════════════════════════════════
       PRINT VIEW — Optimized print layout
    ══════════════════════════════════════════════════════════════════════ */
    function _printView() {
      window.print();
    }

    /* ══════════════════════════════════════════════════════════════════════
       GLOBAL STATE VARIABLES
       Centralized app state — referenced by all modules.
    ══════════════════════════════════════════════════════════════════════ */
    var _U = null;          // Logged-in user object (set by _bootApp)
    var _V = null;          // Current view (route string, e.g. 'dash')
    var _ST = null;          // Current sub-tab (e.g. 'ptop')
    var _dark = false;         // Dark mode active
    var _charts = {};            // Active Chart.js instances keyed by id
    var _ntfs = [];            // Notification items array
    var _ntfU = 0;             // Unread notification count
    var _D = {};            // Data cache shared across modules
    var _gsList = [];            // Current global search results
    var _gsFocused = -1;         // Keyboard-focused search result index
    var _gsTimer = null;          // Debounce timer for search input

    /* ══════════════════════════════════════════════════════════════════════
       EMPLOYEE DIRECTORY MODULE
       Full searchable directory of all staff with contact info, role,
       department and per-employee stats (manager view).
    ══════════════════════════════════════════════════════════════════════ */
    // ═══════════════════════════════════════════════════════════════════════
    // EMPLOYEE DIRECTORY — Rich cards with search, filters & quick stats
    // ═══════════════════════════════════════════════════════════════════════
    function _vEmpDir() {
      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div><div class="mod-title">Employee Directory</div>' +
        '<div class="mod-sub">All staff — contact info, roles and departments</div></div>' +
        '</div>' +
        // Toolbar
        '<div class="ed-toolbar">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 14px;background:var(--sur2);border-radius:12px;border:1px solid var(--bdr);margin-bottom:14px">' +
        '<div class="ed-search-wrap" style="flex:none"><i class="fas fa-search"></i>' +
        '<input type="text" id="edSearch" placeholder="Search name, dept, role, email..." oninput="_filterEmpDir(this.value)">' +
        '</div>' +
        '<select id="edDeptFlt" class="ana-sel" style="min-width:130px" onchange="_filterEmpDir(document.getElementById(\'edSearch\').value)">' +
        '<option value="">All Departments</option>' +
        _getDeptOptions() +
        '</select>' +
        '<select id="edRoleFlt" class="ana-sel" style="min-width:110px" onchange="_filterEmpDir(document.getElementById(\'edSearch\').value)">' +
        '<option value="">All Roles</option>' +
        '<option value="OWNER">Owner</option>' +
        '<option value="MANAGER">Manager</option>' +
        '<option value="HR">HR</option>' +
        '<option value="STAFF">Staff</option>' +
        '</select>' +
        '<select id="edView" class="ana-sel" style="min-width:110px" onchange="_setEdView(this.value)">' +
        '<option value="card">Card View</option>' +
        '<option value="table">Table View</option>' +
        '</select>' +
        '<div style="flex:1"></div>' +
        '<span id="edCount" style="font-size:12px;color:var(--tx3);white-space:nowrap"></span>' +
        '<button class="btn btn-sm" onclick="_loadEmpDir()"><i class="fas fa-rotate-right"></i> Refresh</button>' +
        '</div>' +
        '<div id="edGrid" style="margin-top:16px">' + _skel(6) + '</div>';

      _loadEmpDir();
    }

    function _setEdView(v) {
      _D.edView = v;
      _filterEmpDir((document.getElementById('edSearch') || {}).value || '');
    }

    function _loadEmpDir() {
      var el = document.getElementById('edGrid');
      if (!el) return;
      // Soft show cache while refreshing
      if (_D.empDir && _D.empDir.length) { _renderEmpDir(_D.empDir); }
      else { el.innerHTML = _skel(6); }
      _gas('getEmployeeDirectory', [], function (emps) {
        if (emps && !Array.isArray(emps)) emps = emps.employees || emps.data || emps.rows || [];
        _D.empDir = emps || [];
        _renderEmpDir(_D.empDir);
      }, function (e) {if (el && !(_D.empDir && _D.empDir.length)) el.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';});
    }

    function _renderEmpDir(emps) {
      var el = document.getElementById('edGrid');
      if (!el) return;
      var view = _D.edView || 'card';
      var cEl = document.getElementById('edCount');
      if (cEl) cEl.textContent = emps.length + ' employee' + (emps.length !== 1 ? 's' : '');

      if (!emps || !emps.length) {
        el.innerHTML = '<div class="empty-state"><i class="fas fa-address-book"></i><h4>No Employees Found</h4><p>No staff records match the current filter.</p></div>';
        return;
      }

      if (view === 'table') {
        el.innerHTML = '<div class="table-card"><div class="tw"><table><thead><tr>' +
          '<th>#</th><th>Employee</th><th>Department</th><th>Role</th><th>Email</th>' +
          '<th>Phone</th><th style="text-align:center">Overdue</th><th></th>' +
          '</tr></thead><tbody>' +
          emps.map(function (e, i) {
            var rClr = e.role === 'OWNER' ? 'var(--R)' : e.role === 'MANAGER' ? 'var(--V)' : 'var(--P)';
            var rBg = e.role === 'OWNER' ? 'var(--Rl)' : e.role === 'MANAGER' ? 'var(--Vl)' : 'var(--Pl)';
            return '<tr class="ed-tr" onclick="_loadEmpDetail(\'' + _esc(e.emp_id) + '\')">' +
              '<td style="color:var(--tx3);font-weight:700">' + (i + 1) + '</td>' +
              '<td><div style="display:flex;align-items:center;gap:10px">' + _avatarEl(e.name, e.photo, 32) +
              '<div><div style="font-weight:700;font-size:13px">' + _esc(e.name) + '</div>' +
              '<div style="font-size:10px;color:var(--tx3)">' + _esc(e.emp_id) + '</div></div></div></td>' +
              '<td><span class="bdg" style="background:var(--sur2)">' + _esc(e.dept || '—') + '</span></td>' +
              '<td><span class="bdg" style="background:' + rBg + ';color:' + rClr + '">' + _esc(e.role) + '</span></td>' +
              '<td style="font-size:12px;color:var(--tx2)">' + _esc(e.email || '—') + '</td>' +
              '<td style="font-size:12px;color:var(--tx2)">' + (e.phone ? '<a href="tel:' + _esc(e.phone) + '" onclick="event.stopPropagation()" style="color:var(--P)"><i class="fas fa-phone" style="font-size:10px"></i> ' + _esc(e.phone) + '</a>' : '<span style="color:var(--tx3)">—</span>') + '</td>' +
              '<td style="text-align:center">' + (e.overdue_delegations > 0 ? '<span style="color:var(--R);font-weight:800">' + e.overdue_delegations + '</span>' : '<span style="color:var(--tx3)">—</span>') + '</td>' +
              '<td style="white-space:nowrap">' +
              (_isManager() ? '<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();_editEmployee(\'' + _esc(e.emp_id) + '\')" title="Edit"><i class="fas fa-pen"></i></button> ' : '') +
              '<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();_loadEmpDetail(\'' + _esc(e.emp_id) + '\')" title="Performance"><i class="fas fa-chart-bar"></i></button></td>' +
              '</tr>';
          }).join('') + '</tbody></table></div></div>';
        return;
      }

      // Card view
      el.innerHTML = '<div class="ed-grid">' +
        emps.map(function (e) {
          var rClr = e.role === 'OWNER' ? 'var(--R)' : e.role === 'MANAGER' ? 'var(--V)' : 'var(--P)';
          var rBg = e.role === 'OWNER' ? 'var(--Rl)' : e.role === 'MANAGER' ? 'var(--Vl)' : 'var(--Pl)';
          var initials = e.name.split(' ').map(function (w) {return w[0] || '';}).join('').substring(0, 2).toUpperCase();
          var hasAlert = e.overdue_delegations > 0;
          return '<div class="ed-card' + (hasAlert ? ' ed-card-alert' : '') + '" onclick="_loadEmpDetail(\'' + _esc(e.emp_id) + '\')">' +
            // Top strip with avatar
            '<div class="ed-card-top">' +
            '<div class="ed-avatar" style="' + (e.photo ? 'background:url(' + _esc(e.photo) + ') center/cover' : 'background:' + rBg + ';color:' + rClr) + '">' +
            (e.photo ? '' : initials) +
            '</div>' +
            '<span class="bdg ed-role-bdg" style="background:' + rBg + ';color:' + rClr + '">' + _esc(e.role) + '</span>' +
            (hasAlert ? '<div class="ed-alert-dot" title="' + e.overdue_delegations + ' overdue delegations"></div>' : '') +
            '</div>' +
            // Info
            '<div class="ed-card-body">' +
            '<div class="ed-name">' + _esc(e.name) + '</div>' +
            '<div class="ed-dept"><i class="fas fa-building" style="width:12px;color:var(--tx4)"></i> ' + _esc(e.dept || '—') + '</div>' +
            '<div class="ed-email" title="' + _esc(e.email) + '"><i class="fas fa-envelope" style="width:12px;color:var(--tx4)"></i> ' + _esc((e.email || '').split('@')[0] || '—') + '</div>' +
            (e.phone ? '<div style="font-size:11px;color:var(--tx2);margin-top:3px"><i class="fas fa-phone" style="width:12px;color:var(--tx4)"></i> ' + _esc(e.phone) + '</div>' : '') +
            (hasAlert ? '<div class="ed-overdue-tag"><i class="fas fa-triangle-exclamation"></i> ' + e.overdue_delegations + ' overdue</div>' : '') +
            '</div>' +
            // Actions
            '<div class="ed-card-foot">' +
            '<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();_copyText(\'' + _esc(e.email) + '\')"><i class="fas fa-copy"></i> Email</button>' +
            (e.phone ? '<a class="btn btn-xs btn-outline" href="tel:' + _esc(e.phone) + '" onclick="event.stopPropagation()" style="text-decoration:none"><i class="fas fa-phone"></i> Call</a>' : '') +
            (_isManager() ? '<button class="btn btn-xs btn-outline" onclick="event.stopPropagation();_editEmployee(\'' + _esc(e.emp_id) + '\')"><i class="fas fa-pen"></i> Edit</button>' : '') +
            (_isManager() ? '<button class="btn btn-xs" style="background:var(--Pl);color:var(--P)" onclick="event.stopPropagation();_loadEmpDetail(\'' + _esc(e.emp_id) + '\')"><i class="fas fa-chart-bar"></i> Stats</button>' : '') +
            '</div>' +
            '</div>';
        }).join('') + '</div>';
    }

    function _filterEmpDir(q) {
      var dept = (document.getElementById('edDeptFlt') || {}).value || '';
      var role = (document.getElementById('edRoleFlt') || {}).value || '';
      var query = (q || '').toLowerCase().trim();
      var emps = (_D.empDir || []).filter(function (e) {
        var matchQ = !query || (e.name + ' ' + e.dept + ' ' + e.role + ' ' + e.email).toLowerCase().indexOf(query) >= 0;
        var matchD = !dept || e.dept === dept;
        var matchR = !role || e.role === role;
        return matchQ && matchD && matchR;
      });
      _renderEmpDir(emps);
    }

    function _exportEmpDir() {
      var data = _D.empDir || [];
      if (!data.length) {_toast('Load directory first', 'warn'); return;}
      var head = ['Emp ID', 'Name', 'Department', 'Role', 'Email', 'Overdue Delegations'];
      var csv = [head.join(',')].concat(data.map(function (e) {
        return ['"' + e.emp_id + '"', '"' + e.name + '"', '"' + (e.dept || '') + '"', e.role, '"' + (e.email || '') + '"', e.overdue_delegations || 0].join(',');
      })).join('\n');
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFF' + csv);
      a.download = 'employee_directory_' + _today() + '.csv'; a.click();
      _toast('Exported!', 'ok');
    }

    
    function _editEmployee(empId) {
      if (!_isManager()) { _toast('Only management can edit', 'warn'); return; }
      var emps = _D.empDir || [];
      var e = null;
      for (var i = 0; i < emps.length; i++) {
        if (String(emps[i].emp_id) === String(empId)) { e = emps[i]; break; }
      }
      if (!e) {
        _gas('getEmployeeDirectory', [], function (list) {
          _D.empDir = list || [];
          _editEmployee(empId);
        }, function () { _toast('Could not load employee', 'err'); });
        return;
      }
      _openModal(
        '<i class="fas fa-pen" style="color:var(--P)"></i> Edit Employee',
        '<div style="display:flex;flex-direction:column;gap:12px">' +
        '<div style="text-align:center">' + _avatarEl(e.name, e.photo, 64) +
        '<div style="font-size:11px;color:var(--tx3);margin-top:6px">Emp ID: ' + _esc(e.emp_id) + '</div></div>' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Full Name</label>' +
        '<input type="text" id="edName" class="ana-sel" value="' + _esc(e.name || '') + '" style="width:100%"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Department</label>' +
        '<input type="text" id="edDept" class="ana-sel" value="' + _esc(e.dept || '') + '" style="width:100%"></div>' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Role</label>' +
        '<select id="edRole" class="ana-sel" style="width:100%">' +
        ['OWNER','MANAGER','HR','STAFF','COORDINATOR'].map(function (r) {
          return '<option value="' + r + '"' + ((e.role || '').toUpperCase() === r ? ' selected' : '') + '>' + r + '</option>';
        }).join('') +
        '</select></div></div>' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Email</label>' +
        '<input type="email" id="edEmail" class="ana-sel" value="' + _esc(e.email || '') + '" style="width:100%"></div>' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Phone</label>' +
        '<input type="text" id="edPhone" class="ana-sel" value="' + _esc(e.phone || '') + '" style="width:100%"></div>' +
        '<div><label style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;display:block;margin-bottom:4px">Photo URL</label>' +
        '<input type="text" id="edPhoto" class="ana-sel" value="' + _esc(e.photo || '') + '" placeholder="https://..." style="width:100%"></div>' +
        '</div>',
        function () {
          var payload = {
            emp_id: e.emp_id,
            name: ((document.getElementById('edName') || {}).value || '').trim(),
            dept: ((document.getElementById('edDept') || {}).value || '').trim(),
            role: ((document.getElementById('edRole') || {}).value || 'STAFF').trim(),
            email: ((document.getElementById('edEmail') || {}).value || '').trim(),
            phone: ((document.getElementById('edPhone') || {}).value || '').trim(),
            photo: ((document.getElementById('edPhoto') || {}).value || '').trim()
          };
          if (!payload.name) { _toast('Name required', 'warn'); return; }
          _closeModal();
          _toast('Saving…', 'info');
          _gas('updateEmployee', [payload], function (r) {
            if (r && r.success === false) {
              _toast('❌ ' + (r.error || 'Update failed'), 'err');
              return;
            }
            _toast('✓ Employee updated', 'ok');
            for (var k = 0; k < (_D.empDir || []).length; k++) {
              if (String(_D.empDir[k].emp_id) === String(e.emp_id)) {
                _D.empDir[k] = Object.assign({}, _D.empDir[k], payload);
                break;
              }
            }
            _D.empDir = null; // force refresh
            _loadEmpDir();
          }, function (err) {
            var msg = (err && err.message) || 'Update failed';
            if (msg.indexOf('not found') > -1 || msg.indexOf('Unknown') > -1 || msg.indexOf('not allowed') > -1) {
              msg = 'GAS me updateEmployee function missing hai — Code.gs me paste karo (UPDATE_EMPLOYEE.gs)';
            }
            _toast('Error: ' + msg, 'err');
          });
        },
        '<i class="fas fa-save"></i> Save Changes'
      );
    }

function _loadEmpDetail(empId) {
      if (!_isManager()) return;
      var modal = document.getElementById('modal');
      if (modal) modal.className = 'modal-box wide';
      _openModal('<i class="fas fa-user" style="color:var(--P)"></i> Employee Profile',
        '<div id="empDetailBody">' + _skel(4) + '</div>', null, null, true);
      setTimeout(function () {
        var foot = document.getElementById('mFoot');
        if (foot) foot.innerHTML =
          '<button class="btn btn-outline" onclick="_closeModal()"><i class="fas fa-times"></i> Close</button>' +
          '<button class="btn" onclick="_closeModal();_loadV(\'em\');setTimeout(function(){var s=document.getElementById(\'emEmp\');if(s){s.value=\'' + empId + '\';_loadEM();}},600)"><i class="fas fa-chart-bar"></i> Performance Report</button>';
      }, 30);

      _loadEmpDetailData(empId, _currMonth() + '-01', _today(), 'month');
    }

    function _empDetailApplyPreset(empId) {
      var p = (document.getElementById('edPreset') || {}).value || 'month';
      var t = new Date();
      function iso(d) {return d.toISOString().slice(0, 10);}
      var from, to = iso(t);
      if (p === 'last30') from = _daysAgo(30);
      else if (p === 'last90') from = _daysAgo(90);
      else if (p === 'alltime') from = '2020-01-01';
      else from = iso(t).slice(0, 8) + '01';
      _loadEmpDetailData(empId, from, to, p);
    }

    function _loadEmpDetailData(empId, from, to, presetVal) {
      var el = document.getElementById('empDetailBody');
      var emp = (_D.empDir || []).find(function (e) {return e.emp_id === empId;}) || {};
      // Store current empId in data attribute so _renderEmpDetailModules can find it
      if (el) el.setAttribute('data-emp-id', empId);
      var rClr = emp.role === 'OWNER' ? 'var(--R)' : emp.role === 'MANAGER' ? 'var(--V)' : 'var(--P)';
      var rBg = emp.role === 'OWNER' ? 'var(--Rl)' : emp.role === 'MANAGER' ? 'var(--Vl)' : 'var(--Pl)';

      var headerHtml =
        '<div class="ed-detail-head">' +
        _avatarEl(emp.name || empId, emp.photo, 60) +
        '<div>' +
        '<div style="font-size:17px;font-weight:900;margin-bottom:4px">' + _esc(emp.name || empId) + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px">' +
        '<span class="bdg" style="background:' + rBg + ';color:' + rClr + '">' + _esc(emp.role || '') + '</span>' +
        '<span class="bdg" style="background:var(--sur2)">' + _esc(emp.dept || '—') + '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--tx3)"><i class="fas fa-envelope"></i> ' + _esc(emp.email || '—') + '</div>' +
        '</div></div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap">' +
        '<select id="edPreset" class="ana-sel" onchange="_empDetailApplyPreset(\'' + _esc(empId) + '\')">' +
        '<option value="month"' + (presetVal === 'month' ? ' selected' : '') + '>This Month</option>' +
        '<option value="last30"' + (presetVal === 'last30' ? ' selected' : '') + '>Last 30 Days</option>' +
        '<option value="last90"' + (presetVal === 'last90' ? ' selected' : '') + '>Last 90 Days</option>' +
        '<option value="alltime"' + (presetVal === 'alltime' ? ' selected' : '') + '>All Time</option>' +
        '</select>' +
        '<span style="font-size:11px;color:var(--tx3)">' + _fmtDate(from) + ' &rarr; ' + _fmtDate(to) + '</span>' +
        '</div>';

      if (el) el.innerHTML = headerHtml + '<div id="edModules" style="margin-top:14px">' + _skel(3) + '</div>';

      _gasX('getEmployeeDetailV2', [empId, {from: from, to: to}], 30000, function (data) {
        _renderEmpDetailModules({cl: data.checklist, dl: data.delegation, at: data.attendance}, empId, data.need_attendance);
      }, function () {
        _renderEmpDetailModules({cl: null, dl: null, at: null}, empId, true);
      });
    }

    function _empModCard(cfg) {
      if (!cfg.stats) return '<div class="card card-nohover card-sm" style="border-top:3px solid ' + cfg.clr + '">' +
        '<div style="font-weight:800;font-size:12px;display:flex;align-items:center;gap:6px;margin-bottom:8px"><i class="fas ' + cfg.ico + '" style="color:' + cfg.clr + '"></i> ' + cfg.title + '</div>' +
        '<div style="font-size:11px;color:var(--tx3);text-align:center;padding:10px">Could not load</div></div>';
      var rC = cfg.rate >= 80 ? 'var(--G)' : cfg.rate >= 50 ? 'var(--O)' : 'var(--R)';
      return '<div class="card card-nohover card-sm" style="border-top:3px solid ' + cfg.clr + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<div style="font-weight:800;font-size:12px;display:flex;align-items:center;gap:6px"><i class="fas ' + cfg.ico + '" style="color:' + cfg.clr + '"></i> ' + cfg.title + '</div>' +
        (cfg.rate != null ? '<div style="font-size:15px;font-weight:900;color:' + rC + '">' + cfg.rate + '%</div>' : '') +
        '</div>' +
        (cfg.rate != null ? '<div class="pbar-wrap" style="margin-bottom:10px"><div class="pbar" style="width:' + cfg.rate + '%;background:' + rC + '"></div></div>' : '') +
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px">' +
        cfg.stats.map(function (s) {return '<div style="text-align:center"><div style="font-size:16px;font-weight:900">' + s.v + '</div><div style="font-size:8.5px;color:var(--tx3);text-transform:uppercase;letter-spacing:.3px">' + s.l + '</div></div>';}).join('') +
        '</div>' +
        (cfg.subStats && cfg.subStats.length ?
          '<div style="display:flex;justify-content:space-between;padding-top:8px;margin-bottom:10px;border-top:1px solid var(--bdr)">' +
          cfg.subStats.map(function (s) {return '<span style="font-size:9.5px;color:var(--tx3)">' + s.l + ': <b style="color:var(--tx2)">' + s.v + '</b></span>';}).join('') +
          '</div>' : '') +
        '<button class="btn btn-sm btn-outline" style="width:100%;font-size:10.5px;padding:6px" onclick="_closeModal();_loadV(\'' + cfg.route + '\')">View Full Report</button>' +
        '</div>';
    }

    function _empActivityList(title, rows, renderFn) {
      return '<div class="card card-nohover card-sm">' +
        '<div style="font-weight:700;font-size:11px;color:var(--tx2);margin-bottom:8px">' + title + '</div>' +
        (rows.length ? rows.map(renderFn).join('') : '<div style="font-size:11px;color:var(--tx3);text-align:center;padding:10px">No recent activity</div>') +
        '</div>';
    }

    function _renderEmpDetailModules(results, empId, needAttParam) {
      var el = document.getElementById('edModules');
      if (!el) return;
      var cl = results.cl, dl = results.dl, at = results.at;

      // needAttParam comes directly from getEmployeeDetailV2 — no empDir cache dependency.
      // Fallback to empDir if not provided (e.g. on error path).
      var needsAtt;
      if (typeof needAttParam !== 'undefined') {
        needsAtt = needAttParam !== false;
      } else {
        var eid = empId || (document.getElementById('empDetailBody') || {}).getAttribute('data-emp-id') || '';
        var emp = (_D.empDir || []).find(function (e) {return e.emp_id === eid;}) || {};
        needsAtt = emp.need_attendance !== false;
      }

      var h = '<div style="display:grid;grid-template-columns:' + (needsAtt ? 'repeat(3,1fr)' : 'repeat(2,1fr)') + ';gap:10px">';
      h += _empModCard({
        title: 'Checklist', ico: 'fa-list-check', clr: 'var(--P)', route: 'clana',
        rate: cl ? (cl.avg_completion || 0) : null,
        stats: cl ? [{l: 'Planned', v: cl.total_planned || 0}, {l: 'Done', v: cl.total_done || 0}, {l: 'Pending', v: cl.total_pending || 0}] : null,
        subStats: cl ? [{l: 'On-time', v: (cl.on_time_rate || 0) + '%'}, {l: 'Avg delay', v: (cl.avg_lag_days || 0) + 'd'}] : null
      });
      h += _empModCard({
        title: 'Delegation', ico: 'fa-diagram-project', clr: 'var(--V)', route: 'delana',
        rate: dl ? (dl.completion_rate || 0) : null,
        stats: dl ? [{l: 'Assigned', v: dl.total_assigned || 0}, {l: 'Done', v: dl.total_completed || 0}, {l: 'Overdue', v: dl.total_overdue || 0}] : null,
        subStats: dl ? [{l: 'On-time', v: (dl.on_time_rate || 0) + '%'}, {l: 'Avg delay', v: (dl.avg_lag_days || 0) + 'd'}] : null
      });
      if (needsAtt) {
        h += _empModCard({
          title: 'Attendance', ico: 'fa-user-clock', clr: 'var(--T)', route: 'attana',
          rate: at ? (at.presence_pct || 0) : null,
          stats: at ? [{l: 'Present', v: at.total_present || 0}, {l: 'Absent', v: at.total_absent || 0}, {l: 'Late', v: at.total_late || 0}] : null,
          subStats: at ? [{l: 'Avg hrs', v: (at.avg_hours || 0) + 'h'}] : null
        });
      }
      h += '</div>';

      h += '<div style="display:grid;grid-template-columns:' + (needsAtt ? 'repeat(3,1fr)' : 'repeat(2,1fr)') + ';gap:10px;margin-top:10px">';
      h += _empActivityList('Recent Tasks', (cl && cl.employee_detail) ? cl.employee_detail.log.slice(0, 5) : [], function (r) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:11px;padding:5px 0;border-bottom:1px solid var(--bdr)">' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + _esc(r.task) + '">' + _esc(r.task) + '</span>' + _statusBadge(r.status) + '</div>';
      });
      h += _empActivityList('Recent Delegations', (dl && dl.employee_detail) ? dl.employee_detail.log.slice(0, 5) : [], function (r) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:11px;padding:5px 0;border-bottom:1px solid var(--bdr)">' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + _esc(r.task) + '">' + _esc(r.task) + '</span>' + _statusBadge(r.status) + '</div>';
      });
      if (needsAtt) {
        h += _empActivityList('Recent Attendance', (at && at.employee_detail) ? at.employee_detail.log.slice(0, 5) : [], function (r) {
          return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:11px;padding:5px 0;border-bottom:1px solid var(--bdr)">' +
            '<span>' + _fmtDateShort(r.date) + '</span><div style="display:flex;gap:5px;align-items:center">' + (_lateBadge(r.is_late, r.status, r.office_in_used)) + _statusBadge(r.status) + '</div></div>';
        });
      }
      h += '</div>';

      el.innerHTML = h;
    }
    /* ══════════════════════════════════════════════════════════════════════
       DASHBOARD MODULE
       Quick-start: KPIs, delegation urgency list, today's checklist
       preview, attendance status, and announcement ticker.
    ══════════════════════════════════════════════════════════════════════ */

    function _greeting() {
      var h = new Date().getHours();
      return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    }

    function _loadDash() {
      var kEl = document.getElementById('dashKrow');

      // ── Use cached data if available ──────────────────────────────────────
      function _renderDashStats(stats) {
        var pct = stats.totalTasks > 0 ? Math.round(stats.doneTasks / stats.totalTasks * 100) : 0;
        var attClr = stats.myAttendanceToday === 'FD' || stats.myAttendanceToday === 'P' ? 'var(--G)'
          : stats.myAttendanceToday === 'HD' ? 'var(--O)'
            : stats.myAttendanceToday === '-' ? 'var(--tx3)' : 'var(--R)';
        if (kEl) kEl.innerHTML = [
          {lbl: 'Tasks Done', val: stats.doneTasks || 0, c: 'var(--G)', ico: 'fa-check-circle', desc: 'Today'},
          {lbl: 'Tasks Pending', val: stats.pendingTasks || 0, c: stats.pendingTasks > 0 ? 'var(--O)' : 'var(--G)', ico: 'fa-hourglass', desc: 'Today'},
          {lbl: 'Overdue Delegations', val: stats.overdueDelegations || 0, c: stats.overdueDelegations > 0 ? 'var(--R)' : 'var(--G)', ico: 'fa-people-arrows', desc: 'Requiring attention'},
          {lbl: 'Attendance Today', val: stats.myAttendanceToday || '—', c: attClr, ico: 'fa-fingerprint', desc: 'Current status'},
          {lbl: 'Announcements', val: stats.unreadAnnouncements || 0, c: 'var(--P)', ico: 'fa-bullhorn', desc: 'Active'}
        ].map(function (k) {
          return '<div class="kpi" style="--kc:' + k.c + ';cursor:default">' +
            '<div class="kpi-ico"><i class="fas ' + k.ico + '"></i></div>' +
            '<div class="kpi-val">' + k.val + '</div>' +
            '<div class="kpi-lbl">' + k.lbl + '</div>' +
            '<div style="font-size:10px;color:var(--tx3);margin-top:3px">' + k.desc + '</div></div>';
        }).join('');
      }

      if (_D.dashStats) {
        _renderDashStats(_D.dashStats);
      } else {
        _gas('getDashboardStats', [], function (stats) {_D.dashStats = stats; _renderDashStats(stats);},
          function () {if (kEl) kEl.innerHTML = '<div class="te" style="grid-column:1/-1"><i class="fas fa-wifi"></i> Could not load stats.</div>';});
      }

      // ── Announcements — use cache ─────────────────────────────────────────
      function _renderAnn(anns) {
        var el = document.getElementById('dashAnnList');
        if (!el) return;
        var top3 = (anns || []).slice(0, 3);
        if (!top3.length) {el.innerHTML = '<div style="font-size:12px;color:var(--tx3);text-align:center;padding:8px 12px;display:flex;align-items:center;justify-content:center;gap:8px"><i class="fas fa-bullhorn" style="opacity:.3"></i>No announcements</div>'; return;}
        el.innerHTML = top3.map(function (a) {
          var pClr = a.priority === 'High' ? 'var(--R)' : a.priority === 'Low' ? 'var(--tx3)' : 'var(--P)';
          return '<div style="padding:8px 0;border-bottom:1px solid var(--bdr2);font-size:12.5px;line-height:1.5">' +
            '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + pClr + ';margin-right:7px;vertical-align:middle"></span>' +
            _esc((a.text || '').slice(0, 80)) + (a.text && a.text.length > 80 ? '…' : '') + '</div>';
        }).join('');
      }
      if (_D.announcements) {_renderAnn(_D.announcements);}
      else {_gas('getAnnouncements', [], function (anns) {_D.announcements = anns; _renderAnn(anns);}, function () { });}

      // ── Overdue delegations — use cache ───────────────────────────────────
      function _renderDelList(dels) {
        var el = document.getElementById('dashDelList');
        if (!el) return;
        var over = (dels || []).filter(function (d) {return d.is_overdue;});
        if (!over.length) {el.innerHTML = '<div style="font-size:12px;color:var(--G);text-align:center;padding:12px"><i class="fas fa-check-circle"></i> No overdue tasks</div>'; return;}
        el.innerHTML = over.slice(0, 3).map(function (d) {
          return '<div style="padding:8px 0;border-bottom:1px solid var(--bdr2)">' +
            '<div style="font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">' + _esc((d.task_desc || '').slice(0, 60)) + (d.task_desc && d.task_desc.length > 60 ? '…' : '') + '</div>' +
            '<div style="font-size:11px;color:var(--R);margin-top:2px"><i class="fas fa-calendar-xmark"></i> Due: ' + _fmtDate(d.final_date) + '</div></div>';
        }).join('') + (over.length > 3 ? '<div style="font-size:11px;color:var(--tx3);font-weight:700;margin-top:6px">+' + (over.length - 3) + ' more…</div>' : '');
      }
      if (_D.myDelegations) {_renderDelList(_D.myDelegations);}
      else {_gas('getMyDelegations', ['All'], function (dels) {_D.myDelegations = dels; _renderDelList(dels);}, function () { });}
    }

    /* ══════════════════════════════════════════════════════════════════════
       MY PROFILE MODULE
       Shows logged-in user info, stats this month, password change form,
       and 12-week task history chart.
    ══════════════════════════════════════════════════════════════════════ */
    function _vProfile() {
      document.getElementById('content').innerHTML =
        '<div class="mod-head">' +
        '<div><div class="mod-title">My Profile</div><div class="mod-sub">Account information, monthly stats and password management</div></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:' + (_isMobile() ? '1fr' : '300px 1fr') + ';gap:16px;align-items:start">' +
        '<div>' +
        '<div class="card card-nohover" style="text-align:center;padding-bottom:20px" id="profCard">' + _skel(3) + '</div>' +
        '</div>' +
        '<div>' +
        '<div class="card card-nohover">' +
        '<div class="sec-title" style="margin-bottom:14px"><i class="fas fa-lock" style="color:var(--V)"></i> Change Password</div>' +
        '<div class="frow">' +
        '<div class="fgrp" style="flex:1"><label>New Password <span class="req">★</span></label>' +
        '<input type="password" id="profPw1" placeholder="Enter new password">' +
        '</div>' +
        '<div class="fgrp" style="flex:1"><label>Confirm Password <span class="req">★</span></label>' +
        '<input type="password" id="profPw2" placeholder="Confirm new password">' +
        '</div>' +
        '<div class="fgrp" style="align-self:flex-end"><button class="btn btn-sm" onclick="_changePw()"><i class="fas fa-lock-open"></i> Update</button></div>' +
        '</div>' +
        '<div class="tip"><i class="fas fa-shield-halved"></i> Minimum 4 characters. Use a mix of letters and numbers for a stronger password.</div>' +
        '</div>' +
        '</div>' +
        '</div>';

      _loadProfile();
    }

    function _loadProfile() {
      var cEl = document.getElementById('profCard');
      if (!cEl) return;

      _gas('getMyProfile', [], function (p) {
        cEl.innerHTML =
          '<div style="display:flex;justify-content:center;margin-bottom:14px">' +
          _avatarEl(p.name, p.photo, 72) +
          '</div>' +
          '<div style="font-size:18px;font-weight:900;margin-bottom:4px">' + _esc(p.name) + '</div>' +
          '<div style="font-size:12.5px;color:var(--tx2);margin-bottom:4px">' + _esc(p.dept) + '</div>' +
          '<span class="bdg" style="background:var(--Pl);color:var(--P)">' + _esc(p.role) + '</span>' +
          '<div style="font-size:11.5px;color:var(--tx3);margin-top:8px;margin-bottom:16px;word-break:break-all">' + _esc(p.email) + '</div>' +
          '<div style="border-top:1px solid var(--bdr);padding-top:14px;text-align:left">' +
          '<div style="font-size:11px;font-weight:800;color:var(--tx2);text-transform:uppercase;letter-spacing:.7px;margin-bottom:10px">This Month</div>' +
          [
            {lbl: 'Tasks Done', val: p.stats.tasks_done_this_month, ico: 'fa-check-circle', c: 'var(--G)'},
            {lbl: 'Present Days', val: p.stats.present_days_this_month, ico: 'fa-fingerprint', c: 'var(--T)'},
            {lbl: 'Pending Delegations', val: p.stats.pending_delegations, ico: 'fa-people-arrows', c: 'var(--O)'},
            {lbl: 'Leave Requests', val: p.stats.leave_requests_this_month, ico: 'fa-umbrella-beach', c: 'var(--V)'}
          ].map(function (s) {
            return '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--bdr2)">' +
              '<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--tx2)">' +
              '<i class="fas ' + s.ico + '" style="color:' + s.c + ';width:14px"></i>' + s.lbl +
              '</div>' +
              '<span style="font-size:15px;font-weight:900;color:' + s.c + '">' + (s.val || 0) + '</span>' +
              '</div>';
          }).join('') +
          '</div>';

        _loadProfileHistory(p.emp_id);
      }, function (e) {
        if (cEl) cEl.innerHTML = (e && e.message && e.message.indexOf('Network') > -1) ? '<div style="text-align:center;padding:24px"><div style="font-size:28px;margin-bottom:8px">📡</div><div style="font-weight:700;color:var(--tx);margin-bottom:4px">Connection Error</div><div style="font-size:12px;color:var(--tx2);margin-bottom:12px">Server se connect nahi ho pa raha</div><button class="btn btn-sm" onclick="_forceRefresh()"><i class="fas fa-rotate-right"></i> Retry</button></div>' : '<div class="te">' + _esc(e.message) + '</div>';
      });
    }

    function _changePw() {
      var pw1 = document.getElementById('profPw1') ? document.getElementById('profPw1').value.trim() : '';
      var pw2 = document.getElementById('profPw2') ? document.getElementById('profPw2').value.trim() : '';
      if (!pw1) {_toast('Please enter a new password', 'err'); _fieldErr('profPw1'); return;}
      if (pw1.length < 4) {_toast('Password must be at least 4 characters', 'err'); _fieldErr('profPw1'); return;}
      if (pw1 !== pw2) {_toast('Passwords do not match', 'err'); _fieldErr('profPw2'); return;}
      _gas('changePassword', [pw1], function () {
        _toast('Password updated successfully!', 'ok');
        _addNtf('Password changed', 'fa-lock', 'var(--Vl)', 'var(--V)');
        document.getElementById('profPw1').value = '';
        document.getElementById('profPw2').value = '';
      }, function (e) {_toast('Error: ' + e.message, 'err');});
    }

    /* ══════════════════════════════════════════════════════════════════════
       TOAST NOTIFICATION SYSTEM
       Shows temporary messages at the bottom of the screen.
       Types: ok (green), warn (orange), err (red), info (blue, default).
    ══════════════════════════════════════════════════════════════════════ */
    function _toast(msg, type) {
      var el = document.getElementById('toast');
      if (!el) return;

      var colors = {
        ok: {bg: 'var(--G)', ico: 'fa-check-circle'},
        warn: {bg: 'var(--O)', ico: 'fa-triangle-exclamation'},
        err: {bg: 'var(--R)', ico: 'fa-circle-xmark'},
        info: {bg: 'var(--P)', ico: 'fa-circle-info'}
      };
      var cfg = colors[type] || colors.info;

      el.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px">' +
        '<i class="fas ' + cfg.ico + '" style="font-size:15px;flex-shrink:0"></i>' +
        '<span>' + _esc(msg) + '</span>' +
        '</div>';
      el.style.background = cfg.bg;
      el.classList.add('show');

      clearTimeout(_toast._t);
      _toast._t = setTimeout(function () {el.classList.remove('show');}, 3500);
    }
    _toast._t = null;

    if ('serviceWorker' in navigator) {
      // sw.js itself deletes every cache that is not its own (activate handler), so no manual purge here.
      // (The old purge deleted the SW's live cache on EVERY page load -> no instant open.)
      navigator.serviceWorker.register('sw.js?v=20').then(function (reg) {
        reg.update();
      }).catch(function () { });
    }






    // ══════════════════════════════════════════════════════════════════════
    // MOBILE JS — Auto-hide nav, page anim, swipe, more tray
    // ══════════════════════════════════════════════════════════════════════
    var _isMobile = function () {return window.innerWidth <= 640;};

    // ── Auto-hide bottom nav on scroll down, show on scroll up ──────────
    (function () {
      var lastY = 0, ticking = false;
      function onScroll() {
        if (!_isMobile()) return;
        var ct = document.getElementById('content');
        if (!ct) return;
        var nav = document.getElementById('mobNav');
        if (!nav) return;
        var y = ct.scrollTop;
        if (!ticking) {
          requestAnimationFrame(function () {
            var diff = y - lastY;
            if (diff > 8 && y > 60) {
              nav.classList.add('nav-hidden');
            } else if (diff < -8) {
              nav.classList.remove('nav-hidden');
            }
            lastY = y;
            ticking = false;
          });
          ticking = true;
        }
      }
      document.addEventListener('DOMContentLoaded', function () {
        var ct = document.getElementById('content');
        if (ct) ct.addEventListener('scroll', onScroll, {passive: true});
      });
      // Also attach after every _loadV (content changes)
      var _origAttach = _loadV;
    })();

    // ── Page transition ──────────────────────────────────────────────────
    function _mobAnimate() {
      // Removed: mob-page animation had opacity:.3 start which blanked content on mobile
      // Page transition is handled by content rendering itself
    }

    // ── Pull-to-refresh ──────────────────────────────────────────────────
    (function () {
      var startY = 0, pulling = false, ptr = null;
      document.addEventListener('touchstart', function (e) {
        ptr = document.getElementById('fkPtr');
        var ct = document.getElementById('content');
        if (!ct || ct.scrollTop > 0) return;
        startY = e.touches[0].clientY;
        pulling = true;
      }, {passive: true});
      document.addEventListener('touchmove', function (e) {
        if (!pulling || !ptr) return;
        var dy = e.touches[0].clientY - startY;
        if (dy > 60) {ptr.style.display = 'block';}
      }, {passive: true});
      document.addEventListener('touchend', function () {
        if (!pulling || !ptr) return;
        pulling = false;
        if (ptr.style.display === 'block') {
          ptr.style.display = 'block';
          _forceRefresh();
          setTimeout(function () {if (ptr) ptr.style.display = 'none';}, 1200);
        }
      });
    })();

    // ── Bottom nav: routing ──────────────────────────────────────────────
    var _mbnRoutes = {home: 'dash', check: 'check', attend: 'attend', deleg: 'deleg', profile: 'profile', leave: 'leave'};
    function _mbNav(key) {
      try {if (navigator.vibrate) navigator.vibrate(8);} catch (e) { }
      _closeSb();
      _loadV(_mbnRoutes[key] || key);
      _updateMobNav(key);
    }
    function _vib(ms) {try {if (navigator.vibrate) navigator.vibrate(ms || 12);} catch (e) { } }
    function _updateMobNav(activeKey) {
      var keyMap = {dash: 'home', check: 'check', attend: 'attend', leave: 'attend', deleg: 'deleg', profile: 'profile', feed: 'home', holcal: 'home'};
      var mapped = keyMap[activeKey] || activeKey;
      document.querySelectorAll('.mob-nav-item').forEach(function (el) {
        el.classList.remove('active');
      });
      var target = document.getElementById('mbn-' + mapped);
      if (target) target.classList.add('active');
      // Show nav when switching views
      var nav = document.getElementById('mobNav');
      if (nav) nav.classList.remove('nav-hidden');
    }

    // ── More tray (bottom sheet) ─────────────────────────────────────────
    var _moreOpen = false;
    function _mbMore() {
      if (_moreOpen) {_closeMobTray(); return;}
      _moreOpen = true;
      var items = [
        {ico: 'fa-bullhorn', lbl: 'Announce', key: 'ann'},
        {ico: 'fa-people-arrows', lbl: 'Delegation', key: 'deleg'},
        {ico: 'fa-calendar-check', lbl: 'Attendance', key: 'attend'},
        {ico: 'fa-circle-user', lbl: 'Profile', key: 'profile'},
      ];
      if (_isManager && _isManager()) {
        items = items.concat([
          {ico: 'fa-table-cells-large', lbl: 'EM Dashboard', key: 'em'},
          {ico: 'fa-address-book', lbl: 'Directory', key: 'empdir'},
          {ico: 'fa-list-check', lbl: 'CL Analytics', key: 'clana'},
          {ico: 'fa-diagram-project', lbl: 'Deleg Ana.', key: 'delana'},
          {ico: 'fa-user-clock', lbl: 'Att. Ana.', key: 'attana'},
        ]);
      }
      var tray = document.createElement('div');
      tray.id = 'mobTray';
      tray.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;justify-content:flex-end';
      var bg = document.createElement('div');
      bg.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(4px)';
      bg.onclick = _closeMobTray;
      var sheet = document.createElement('div');
      var isDk = document.body.classList.contains('dark');
      sheet.style.cssText = 'position:relative;background:var(--sur);border-radius:24px 24px 0 0;padding:20px 16px calc(16px + env(safe-area-inset-bottom,0px));max-height:75svh;overflow-y:auto;animation:sheetUp .28s cubic-bezier(.4,0,.2,1) both';
      sheet.innerHTML =
        '<div style="width:40px;height:4px;border-radius:2px;background:var(--bdr2);margin:0 auto 18px"></div>' +
        '<div style="font-size:11px;font-weight:800;color:var(--tx3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px">More</div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">' +
        items.map(function (it) {
          return '<button onclick="_closeMobTray();setTimeout(function(){_mbNav(\'' + it.key + '\')},50)" ' +
            'style="display:flex;flex-direction:column;align-items:center;gap:7px;padding:16px 8px;' +
            'background:var(--bg);border:1.5px solid var(--bdr);border-radius:16px;cursor:pointer;' +
            'font-size:10px;font-weight:700;color:var(--tx2);-webkit-tap-highlight-color:transparent;min-height:76px;' +
            'active:transform:scale(.95)">' +
            '<div style="width:40px;height:40px;border-radius:12px;background:var(--Pl);display:flex;align-items:center;justify-content:center">' +
            '<i class="fas ' + it.ico + '" style="font-size:18px;color:var(--P)"></i></div>' +
            '<span style="text-align:center;line-height:1.2">' + it.lbl + '</span></button>';
        }).join('') + '</div>';
      tray.appendChild(bg);
      tray.appendChild(sheet);
      document.body.appendChild(tray);
    }
    function _closeMobTray() {
      _moreOpen = false;
      var tray = document.getElementById('mobTray');
      if (!tray) return;
      var sheet = tray.querySelector('div:last-child');
      if (sheet) {
        sheet.style.animation = 'none';
        sheet.style.transform = 'translateY(100%)';
        sheet.style.transition = 'transform .25s cubic-bezier(.4,0,.2,1)';
        setTimeout(function () {tray.remove();}, 250);
      } else {tray.remove();}
    }

    // ── Swipe gestures ───────────────────────────────────────────────────
    (function () {
      var sx = 0, sy = 0;
      document.addEventListener('touchstart', function (e) {
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
      }, {passive: true});
      document.addEventListener('touchend', function (e) {
        if (!_isMobile()) return;
        var dx = e.changedTouches[0].clientX - sx;
        var dy = Math.abs(e.changedTouches[0].clientY - sy);
        if (dy > 60) return; // vertical swipe
        if (sx < 24 && dx > 70) {_openSb();}     // edge → open
        else if (dx < -70) {_closeSb();}          // swipe left → close
      }, {passive: true});
    })();

    // ── Close sidebar when nav item clicked ─────────────────────────────
    document.addEventListener('click', function (e) {
      if (!_isMobile()) return;
      if (e.target.closest('.nv')) _closeSb();
    }, {passive: true});

    // ── Patch _loadV for mobile nav update + animation ───────────────────
    var _origLoadV = _loadV;
    _loadV = function (route, sub) {
      _origLoadV(route, sub);
      var navMap = {dash: 'home', check: 'check', attend: 'attend', leave: 'leave', deleg: 'deleg', profile: 'profile'};
      _updateMobNav(navMap[route] || 'more');
      _mobAnimate();
    };

    // ── Init: set active on boot ─────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
      var ct = document.getElementById('content');
      if (ct) ct.addEventListener('scroll', function () {
        // Auto-hide nav on scroll
        var nav = document.getElementById('mobNav');
        if (!nav || !_isMobile()) return;
      }, {passive: true});
    });


    // ── Auto-restore login session on page refresh ───────────────────────────

    // Runs AFTER all functions are defined — safe to call _bootApp here
    (function _autoRestoreSession() {
      var sLogin = document.getElementById('sLogin'), sApp = document.getElementById('sApp');
      function showLogin() {
        // Clear any leftover splash so it never sticks on login screen
        var sp = document.getElementById('fkSplash');
        if (sp) {sp.style.display = 'none'; sp.style.animation = '';}
        if (window._fkSplashHardTimer) {clearTimeout(window._fkSplashHardTimer); window._fkSplashHardTimer = null;}
        if (sLogin) {sLogin.classList.add('on'); sLogin.style.display = '';}
        if (sApp) sApp.classList.remove('on');
        var mn = document.getElementById('mobNav'); if (mn) mn.style.display = 'none';
      }
      try {
        document.documentElement.classList.remove('has-session');
        var saved = _loadSession();
        var good = saved && saved.user && saved.user.name
          && saved.user.name !== 'User' && saved.user.name !== 'Staff' && saved.user.name.trim() !== '';
        if (saved && saved.user && saved.token && saved.user.emp_code && good) {
          _U = saved.user; _TOKEN = saved.token; _saveSession(_U, _TOKEN);
          try {
            var sn = document.getElementById('sbName'), sr = document.getElementById('sbRole'), si = document.getElementById('sbAvaInitials');
            if (sn) sn.textContent = _U.name;
            if (sr) sr.textContent = (_U.role || 'STAFF') + ' · ' + (_U.dept || '');
            if (si) si.textContent = _U.name.trim().split(' ').map(function (w) {return w[0] || '';}).slice(0, 2).join('').toUpperCase() || '?';
          } catch (ex) { }
          if (sLogin) {sLogin.classList.remove('on'); sLogin.style.display = 'none';}
          if (sApp) sApp.classList.add('on');
          var mn = document.getElementById('mobNav'); if (mn) mn.style.display = '';
          _bootApp();
        } else {
          if (saved) _clearSession();
          showLogin();
        }
      } catch (e) {
        showLogin();
      }
    })();


    // Global error handler — catches any uncaught error
    window.onerror = function (msg, src, line, col, err) {
      console.error('[GlobalErr]', msg, src, line);
      var c = document.getElementById('content');
      if (c && c.innerHTML.trim().length < 100) {
        c.innerHTML = '<div style="padding:32px;text-align:center">'
          + '<div style="font-size:36px;margin-bottom:10px">⚠️</div>'
          + '<b>App Error</b><br><small style="color:#888">' + msg + '</small><br><br>'
          + '<button onclick="location.reload()" class="btn">🔄 Reload</button>'
          + '</div>';
      }
      return false;
    };


    var _mbnRoutes = {
      home: 'dash',
      check: 'check',
      attend: 'attend',
      deleg: 'deleg',
      leave: 'leave',
      profile: 'profile'   // still works if called from elsewhere
    };

    function _updateMobNav(activeKey) {
      var keyMap = {
        dash: 'home',
        check: 'check',
        attend: 'attend',
        leave: 'leave',
        deleg: 'deleg',
        profile: 'profile'
      };
      var mapped = keyMap[activeKey] || activeKey;
      document.querySelectorAll('.mob-nav-item').forEach(function (el) {
        el.classList.remove('active');
      });
      var target = document.getElementById('mbn-' + mapped);
      if (target) target.classList.add('active');
      var nav = document.getElementById('mobNav');
      if (nav) nav.classList.remove('nav-hidden');
    }


  

/* Warm-up: wake Vercel function + Apps Script while the user is on the login screen */
(function () {try {fetch('/api/rpc', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({fn: 'serverUptime', args: []})}).catch(function () { });} catch (e) { }})();
