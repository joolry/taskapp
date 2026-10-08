// GET/POST /api/sync?secret=SYNC_SECRET&full=1
// &force=1 → clear stuck lock then rebuild (use when queued forever)
const cache = require('./_cache');
const { runSync, store } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const given = String((req.query && req.query.secret) || req.headers['x-sync-secret'] || '');
  const want = String(process.env.SYNC_SECRET || '');
  if (!want || given.length !== want.length ||
      !require('crypto').timingSafeEqual(Buffer.from(given), Buffer.from(want))) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const q = req.query || {};
    const force = q.force === '1' || q.force === 'true';
    const doBump = q.bump === '1' || q.bump === 'true';
    const doFull = !doBump || q.full === '1' || req.method === 'POST' || force;

    if (force) {
      // Clear stuck lock so runSync can acquire
      await store.metaRef('sync').set({
        syncing: false,
        dirty: true,
        syncStartedAt: 0,
        lastError: 'force unlock'
      }, { merge: true });
    }

    if (doBump) {
      await cache.bump();
      try { await store.markDirty(); } catch (e) {}
    }

    let result = null;
    if (doFull || process.env.SNAPSHOT === 'on') {
      result = await runSync();
    }

    res.status(200).json({
      success: true,
      on: cache.enabled(),
      ver: cache.enabled() ? await cache.ver(true) : null,
      forced: !!force,
      sync: result
    });
  } catch (e) {
    res.status(200).json({
      success: false,
      error: e.message,
      stage: e.stage || ''
    });
  }
};
