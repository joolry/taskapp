// GET/POST /api/sync?secret=SYNC_SECRET&bump=1
// Rebuilds global Firestore snapshot from GAS getSnapshot (Fresko-style).
// Also supports bump-only (invalidates per-fn cache version).
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
    const doBump = req.query && (req.query.bump === '1' || req.query.bump === 'true');
    const doFull = !doBump || req.query.full === '1' || req.method === 'POST';

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
