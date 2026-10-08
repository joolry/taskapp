// GET /api/sync?secret=SYNC_SECRET&bump=1  → invalidate cached reads (called by Apps Script on sheet edits)
const cache = require('./_cache');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const given = String(req.query.secret || ''), want = String(process.env.SYNC_SECRET || '');
  if (!want || given.length !== want.length || !require('crypto').timingSafeEqual(Buffer.from(given), Buffer.from(want)))
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  try {
    if (req.query.bump) await cache.bump();
    res.status(200).json({ success: true, on: cache.enabled(), ver: cache.enabled() ? await cache.ver(true) : null });
  } catch (e) { res.status(200).json({ success: false, error: e.message }); }
};
