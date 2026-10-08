// ════════════════════════════════════════════════════════════════════════════
// app.js — Joolry Daily v4.2
// Core utilities: date parsing, formatting, GAS bridge, session, CSV download
// Load order: appconfig.js → app.js → index.html inline script
// ════════════════════════════════════════════════════════════════════════════
(function(W) {
  'use strict';

  // ── Short month names ─────────────────────────────────────────────────────
  var MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ── Universal date/timestamp parser ──────────────────────────────────────
  // Handles ALL formats:
  //   "2026-08-10"
  //   "2026-08-10T14:30:00"
  //   "dd/MM/yyyy HH:mm:ss"  (GAS/AppSheet)
  //   "Apr 01 2026 00:00:00 GMT+0530 (India Standard Time)"  (corrupted GAS Date)
  //   "Sat Dec 30 1899 13:00:00 GMT+0521"  (time-only stored as Date)
  W._parseAnyDate = function(s) {
    if (!s) return null;
    var str = String(s).trim();
    if (!str || str==='-'||str==='undefined'||str==='null') return null;

    // Raw JS Date.toString() e.g. "Apr 01 2026 00:00:00 GMT+0530..."
    // Also handles corrupted: "Sat Dec 30 1899 13:00:00 GMT..."
    var gmtM = str.match(/([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (gmtM) {
      var mo={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
      var d=new Date(+gmtM[3], mo[gmtM[1]]||0, +gmtM[2], +gmtM[4], +gmtM[5], +gmtM[6]);
      return isNaN(d)?null:d;
    }
    // dd/MM/yyyy HH:mm[:ss]
    var ddmm = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?)?/);
    if (ddmm) {
      var d2=new Date(+ddmm[3],+ddmm[2]-1,+ddmm[1],+(ddmm[4]||0),+(ddmm[5]||0));
      return isNaN(d2)?null:d2;
    }
    // ISO / standard
    var norm = str.length===10 ? str+'T00:00:00' : str.replace(' ','T');
    var d3=new Date(norm);
    return isNaN(d3)?null:d3;
  };

  // ── Extract time string from raw value (handles corrupted Date.toString) ──
  W._extractTimeStr = function(s) {
    if (!s) return '';
    var str = String(s).trim();
    // "Sat Dec 30 1899 13:00:00 GMT+..." — time-only stored as Date
    var gm = str.match(/(\d{4})\s+(\d{2}):(\d{2})/);
    if (gm) {
      var h=+gm[2],m=+gm[3];
      var ap=h>=12?'PM':'AM',h12=h%12||12;
      return h12+':'+(m<10?'0':'')+m+' '+ap;
    }
    // "Monday · 10:30 AM" or "1st · 1:00 PM"
    var dot = str.indexOf(' · ');
    if (dot>-1) return str.substring(dot+3).trim();
    // Already "10:30 AM" or "10:30"
    if (str.match(/^\d{1,2}:\d{2}/)) {
      var p=str.split(':'),h2=+p[0],m2=+p[1];
      var ap2=h2>=12?'PM':'AM',h12_2=h2%12||h2;
      return h12_2+':'+(m2<10?'0':'')+m2+' '+ap2;
    }
    return str;
  };

  // ── Date formatters (always "8 Aug 2026" format) ──────────────────────────
  W._today     = function(){ return new Date().toISOString().slice(0,10); };
  W._currMonth = function(){ return new Date().toISOString().slice(0,7); };
  W._daysAgo   = function(n){ var d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); };
  W._daysLater = function(n){ var d=new Date(); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); };

  W._fmtDate = function(s) {
    if (!s||s==='-'||s==='undefined'||s==='null') return '—';
    try { var d=W._parseAnyDate(s); if(!d) return String(s).slice(0,16);
      return d.getDate()+' '+MN[d.getMonth()]+' '+d.getFullYear(); } catch(e){return s;}
  };
  W._fmtDateShort = function(s) {
    if (!s||s==='-') return '—';
    try { var d=W._parseAnyDate(s); if(!d) return String(s).slice(0,10);
      return d.getDate()+' '+MN[d.getMonth()]+' '+d.getFullYear(); } catch(e){return s;}
  };
  W._fmtDateTime = function(s) {
    if (!s||s==='-') return '—';
    try { var d=W._parseAnyDate(s); if(!d) return String(s).slice(0,16);
      var h=d.getHours(),m=d.getMinutes();
      var ap=h>=12?'PM':'AM',h12=h%12||12;
      return d.getDate()+' '+MN[d.getMonth()]+' '+d.getFullYear()+' '+h12+':'+(m<10?'0':'')+m+' '+ap;
    } catch(e){return s;}
  };
  W._fmtTimestamp = function(s) {
    if (!s) return '—';
    try { var d=W._parseAnyDate(s); if(!d) return String(s).slice(0,16);
      var now=new Date(), diff=now-d;
      if(diff<60000) return 'Just now';
      if(diff<3600000) return Math.floor(diff/60000)+'m ago';
      if(diff<86400000) return Math.floor(diff/3600000)+'h ago';
      if(diff<604800000) return Math.floor(diff/86400000)+'d ago';
      return W._fmtDate(s);
    } catch(e){return s;}
  };

  // Smart short timestamp: "Today 10:30 AM" / "8 Aug 2026 10:30 AM"
  W._tsShort = function(ts) {
    if (!ts) return '';
    var s = String(ts).trim();
    if (s==='-'||s==='undefined'||s==='null') return '—';

    var d = W._parseAnyDate(s);
    if (!d||isNaN(d)) return s.slice(0,16);

    // Extract time from original string (avoid TZ shift from Date object)
    var hhmm='';
    var spIdx = s.search(/\s+\d{2}:\d{2}/);
    if (spIdx>-1) hhmm=s.substring(spIdx).trim().slice(0,5);
    var tIdx=s.indexOf('T');
    if (!hhmm&&tIdx>0) hhmm=s.substring(tIdx+1,tIdx+6);
    if (!hhmm) { var gm=s.match(/(\d{2}):(\d{2}):\d{2}\s*(?:GMT|$)/); if(gm) hhmm=gm[1]+':'+gm[2]; }
    // For "Sat Dec 30 1899 13:00:00" (time-only) — use hours from Date object
    if (!hhmm) { var hd=d.getHours(),md=d.getMinutes(); hhmm=('0'+hd).slice(-2)+':'+('0'+md).slice(-2); }

    function to12(hm) {
      if (!hm||hm==='00:00') return '';
      var p=hm.split(':'),h=+p[0],m=+p[1];
      return (h%12||12)+':'+(m<10?'0':'')+m+(h>=12?' PM':' AM');
    }
    var timeStr=to12(hhmm);

    var t0=new Date(); t0.setHours(0,0,0,0);
    var y0=new Date(t0); y0.setDate(t0.getDate()-1);
    var d0=new Date(d); d0.setHours(0,0,0,0);

    var prefix;
    if (d0.getTime()===t0.getTime()) prefix='Today';
    else if (d0.getTime()===y0.getTime()) prefix='Yesterday';
    else prefix=d.getDate()+' '+MN[d.getMonth()]+' '+d.getFullYear();

    return timeStr ? prefix+' '+timeStr : prefix;
  };

  W._dl = function(dateStr) {
    if (!dateStr) return null;
    return Math.round((new Date(dateStr+'T00:00:00')-new Date(W._today()+'T00:00:00'))/86400000);
  };
  W._dayName = function(dateStr) {
    try { return new Date(dateStr+'T00:00:00').toLocaleDateString('en-IN',{weekday:'long'}); } catch(e){return '';}
  };
  W._isoWeek = function(d) {
    d=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));
    d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
    return Math.ceil((((d-new Date(Date.UTC(d.getUTCFullYear(),0,1)))/86400000)+1)/7);
  };
  W._currentWeek = function(){ return W._isoWeek(new Date()); };

  // ── String utilities ──────────────────────────────────────────────────────
  W._esc = function(s) {
    if (s===null||s===undefined) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  };
  W._req = function(v,label) {
    if (!v||!String(v).trim()){ if(typeof W._toast==='function') W._toast((label||'Field')+' is required','warn'); return false; }
    return true;
  };

  // ── Session ───────────────────────────────────────────────────────────────
  var SK = (W.APP_CONFIG&&W.APP_CONFIG.SESSION_KEY)||'joolry_session_v1';
  var SH = (W.APP_CONFIG&&W.APP_CONFIG.SESSION_HOURS)||12;
  W._saveSession = function(u,t){ try{ localStorage.setItem(SK,JSON.stringify({user:u,token:t,exp:Date.now()+SH*3600000})); }catch(e){} };
  W._loadSession = function(){ try{ var r=localStorage.getItem(SK); if(!r) return null; var s=JSON.parse(r); return (s&&s.user&&s.token&&Date.now()<(s.exp||0))?s:null; }catch(e){return null;} };
  W._clearSession = function(){ try{ localStorage.removeItem(SK); }catch(e){} };

  // ── GAS API bridge ────────────────────────────────────────────────────────
  W._gas = function(fn,args,onOk,onErr,_retry) {
    if (typeof W._lbShow==='function') W._lbShow();
    var GU=W.GAS_URL||(W.APP_CONFIG&&W.APP_CONFIG.GAS_URL)||'';
    var sa=(args||[]).concat([W._U||null]);
    var cb='_cb'+Date.now()+Math.floor(Math.random()*9999);
    var pl=encodeURIComponent(JSON.stringify({action:fn,args:sa}));
    var url=GU+'?callback='+cb+'&payload='+pl;
    var done=false,sc=document.createElement('script'),rt=_retry||0;
    var tm=setTimeout(function(){
      if(done)return; done=true;
      if(typeof W._lbHide==='function') W._lbHide();
      sc.remove(); delete W[cb];
      if(rt<1){setTimeout(function(){W._gas(fn,args,onOk,onErr,1);},1000);return;}
      if(onErr) onErr({message:'Network error. Check connection.'});
      else if(typeof W._toast==='function') W._toast('Connection error — tap to retry','err');
    },25000);
    W[cb]=function(data){
      if(done)return; done=true;
      if(typeof W._lbHide==='function') W._lbHide();
      clearTimeout(tm); sc.remove(); delete W[cb];
      if(data&&data.success===false&&data.error){ if(onErr) onErr({message:data.error}); else if(typeof W._toast==='function') W._toast('Error: '+data.error,'err'); }
      else{ if(onOk) onOk(data); }
    };
    sc.onerror=function(){ if(done)return; done=true; clearTimeout(tm); sc.remove(); delete W[cb]; if(onErr) onErr({message:'Network error.'}); };
    sc.src=url; document.head.appendChild(sc);
  };
  W._gasX = function(fn,args,timeout,onOk,onErr) {
    var GU=W.GAS_URL||(W.APP_CONFIG&&W.APP_CONFIG.GAS_URL)||'';
    var sa=(args||[]).concat([W._U||null]);
    var cb='_cb'+Date.now()+Math.floor(Math.random()*9999);
    var pl=encodeURIComponent(JSON.stringify({action:fn,args:sa}));
    var url=GU+'?callback='+cb+'&payload='+pl;
    var done=false,sc=document.createElement('script');
    var tm=setTimeout(function(){ if(done)return; done=true; sc.remove(); delete W[cb]; if(onErr) onErr({message:'Timeout '+(timeout/1000)+'s'}); },timeout||15000);
    W[cb]=function(data){ if(done)return; done=true; clearTimeout(tm); sc.remove(); delete W[cb]; if(data&&data.success===false&&data.error){if(onErr) onErr({message:data.error});}else{if(onOk) onOk(data);} };
    sc.onerror=function(){ if(done)return; done=true; clearTimeout(tm); sc.remove(); delete W[cb]; if(onErr) onErr({message:'Network error'}); };
    sc.src=url; document.head.appendChild(sc);
  };

  // ── CSV download ──────────────────────────────────────────────────────────
  W._downloadCSV = function(filename,rows) {
    var csv=rows.map(function(r){ return r.map(function(c){ return '"'+String(c===null||c===undefined?'':c).replace(/"/g,'""')+'"'; }).join(','); }).join('\n');
    var a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,\uFEFF'+encodeURIComponent(csv);
    a.download=filename; a.style.display='none'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

})(window);
