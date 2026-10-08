// api/_store.js — Fresko-style global snapshot in Firestore
// Collections: joolry_meta/{snapshot,sync}  joolry_snap/{version}_{i}
const zlib = require('zlib');

const CHUNK_BYTES = 900 * 1024;
const LEASE_MS = 120000;

let _db = null;
let _mem = { version: null, data: null };

function db() {
  if (_db) return _db;
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT missing');
  if (raw[0] !== '{') raw = Buffer.from(raw, 'base64').toString();
  const sa = JSON.parse(raw);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  if (!getApps().length) initializeApp({ credential: cert(sa) });
  return (_db = getFirestore());
}

function setDb(d) { _db = d; _mem = { version: null, data: null }; }

const metaRef = (id) => db().collection('joolry_meta').doc(id);

async function getMeta() {
  const s = await metaRef('snapshot').get();
  return s.exists ? s.data() : null;
}

async function getSyncState() {
  const s = await metaRef('sync').get();
  return s.exists ? s.data() : {};
}

function isBusy(s, now) {
  now = now || Date.now();
  const leaseAlive = s.syncing && (now - (s.syncStartedAt || 0) < LEASE_MS);
  return !!(s.dirty || leaseAlive);
}

async function markDirty() {
  await metaRef('sync').set({ dirty: true, dirtyAt: Date.now() }, { merge: true });
}

async function saveSnapshot(obj) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 6 });
  const version = String(Date.now());
  const n = Math.max(1, Math.ceil(gz.length / CHUNK_BYTES));
  const old = await getMeta();

  await Promise.all(Array.from({ length: n }, (_, i) =>
    db().collection('joolry_snap').doc(version + '_' + i).set({
      v: version, i: i, data: gz.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)
    })));

  const meta = {
    version: version,
    chunks: n,
    lastUpdate: String(obj.builtAt || version),
    builtAt: Date.now(),
    bytes: gz.length,
    today: obj.today || ''
  };
  await metaRef('snapshot').set(meta);

  if (old && old.version && old.version !== version) {
    await Promise.all(Array.from({ length: old.chunks || 0 }, (_, i) =>
      db().collection('joolry_snap').doc(old.version + '_' + i).delete().catch(() => {})));
  }
  _mem = { version: version, data: obj };
  return meta;
}

async function loadSnapshot(meta) {
  if (_mem.version === meta.version && _mem.data) return _mem.data;
  const refs = Array.from({ length: meta.chunks }, (_, i) =>
    db().collection('joolry_snap').doc(meta.version + '_' + i));
  const docs = await db().getAll(...refs);
  const parts = docs.map((d) => {
    if (!d.exists) throw new Error('Snapshot chunk missing');
    return Buffer.from(d.data().data);
  });
  const obj = JSON.parse(zlib.gunzipSync(Buffer.concat(parts)).toString('utf8'));
  _mem = { version: meta.version, data: obj };
  return obj;
}

module.exports = {
  db, setDb, metaRef, getMeta, getSyncState, isBusy, markDirty,
  saveSnapshot, loadSnapshot, LEASE_MS
};
