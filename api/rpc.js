// POST /api/rpc  { fn, args }   Authorization: Bearer <session token>
const { handle } = require('./_lib');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const meta = {}, t0 = Date.now();
    const out = await handle(String(b.fn || ''), b.args, token, meta);
    res.setHeader('X-Cache', meta.cache || 'NA'); res.setHeader('X-GAS-MS', String(meta.gasMs || 0));
    res.setHeader('Server-Timing', 'total;dur=' + (Date.now() - t0) + ', gas;dur=' + (meta.gasMs || 0));
    res.status(200).json(out === undefined ? { success: true } : out);
  } catch (e) { res.status(200).json({ success: false, error: e.message }); }
};
