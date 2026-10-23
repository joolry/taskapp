// GET /api/ver  — lightweight cache version for live UI poll
const cache = require('./_cache');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    if (!cache.enabled()) {
      return res.status(200).json({ success: true, ver: 0, on: false });
    }
    const v = await cache.ver(true);
    return res.status(200).json({ success: true, ver: v, on: true });
  } catch (e) {
    return res.status(200).json({ success: true, ver: 0, on: false, error: e.message });
  }
};
