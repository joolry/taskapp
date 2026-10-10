// GET /api/sync?secret=SYNC_SECRET&full=1
// &force=1 → bypass lock, rebuild now (stuck queue fix)
const cache = require('./_cache');
const { runSync, store } = require('./_lib');
const { coverage } = require('./_snapServe');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const given = String((req.query && req.query.secret) || req.headers['x-sync-secret'] || '');
  const want = String(process.env.SYNC_SECRET || '');
  if (!want || given.length !== want.length ||
      !require('crypto').timingSafeEqual(Buffer.from(given), Buffer.from(want))) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const q = req.query || {};
  const force = q.force === '1' || q.force === 'true';
  const doBump = q.bump === '1' || q.bump === 'true';

  try {
    if (doBump) {
      await cache.bump();
      try { await store.markDirty(); } catch (e) {}
    }

    // ── FORCE: ignore lock, call GAS getSnapshot, save, clear lock ─────────
    if (force) {
      const t0 = Date.now();
      await store.metaRef('sync').set({
        syncing: true,
        syncStartedAt: Date.now(),
        dirty: false,
        lastError: ''
      }, { merge: true });

      let stage = 'getSnapshot';
      const crypto = require('crypto');
      // callGas is internal — duplicate minimal fetch here
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 55000);
      let snap;
      try {
        const r = await fetch(process.env.GAS_URL, {
          method: 'POST', redirect: 'follow', signal: ctl.signal,
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'getSnapshot', args: [], secret: process.env.GAS_SECRET })
        });
        snap = await r.json();
      } finally {
        clearTimeout(timer);
      }

      stage = 'validate';
      if (!snap || snap.success === false) {
        await store.metaRef('sync').set({
          syncing: false,
          dirty: true,
          lastError: 'force: ' + ((snap && snap.error) || 'getSnapshot failed')
        }, { merge: true });
        return res.status(200).json({
          success: false,
          forced: true,
          error: (snap && snap.error) || 'getSnapshot failed',
          stage
        });
      }

      stage = 'save';
      const meta = await store.saveSnapshot(snap);
      await store.metaRef('sync').set({
        syncing: false,
        dirty: false,
        lastSyncAt: Date.now(),
        lastError: ''
      }, { merge: true });

      return res.status(200).json({
        success: true,
        forced: true,
        on: cache.enabled(),
        ver: cache.enabled() ? await cache.ver(true) : null,
        ms: Date.now() - t0,
        today: snap.today || null,
        counts: {
          doers: (snap.doers || []).length,
          checklistToday: (snap.checklistToday || []).length,
          attendance: (snap.attendance || []).length,
          delegations: (snap.delegations || []).length,
          leave: (snap.leaveRequests || []).length
        },
        snapshot: { version: meta.version, bytes: meta.bytes, chunks: meta.chunks },
        checklistCoverage: coverage(snap),   // dates the snapshot can answer; older dates go to the sheet
        sync: { ran: true, loops: 1, mode: 'force' }
      });
    }

    // ── Normal path (respects lock) ───────────────────────────────────────
    let result = null;
    if (process.env.SNAPSHOT === 'on' || q.full === '1') {
      result = await runSync();
    }

    res.status(200).json({
      success: true,
      forced: false,
      on: cache.enabled(),
      ver: cache.enabled() ? await cache.ver(true) : null,
      sync: result
    });
  } catch (e) {
    try {
      await store.metaRef('sync').set({
        syncing: false,
        dirty: true,
        lastError: String(e.message || e)
      }, { merge: true });
    } catch (e2) {}
    res.status(200).json({
      success: false,
      forced: !!force,
      error: e.message,
      stage: e.stage || ''
    });
  }
};
