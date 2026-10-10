// api/_store.js — Fresko-style global snapshot in Firestore
// Collections: joolry_meta/{snapshot,sync}  joolry_snap/{version}_{i}
// v2: compare-and-swap saves (no lost updates when many users write at once),
//     no orphan chunks, background chunk cleanup, safe reload when a chunk vanished.
const zlib = require('zlib');
const crypto = require('crypto');

const CHUNK_BYTES = 900 * 1024;
const LEASE_MS = 45000; // 45s — expired lock auto-clears

let _db = null;
let _mem = { version: null, data: null };

let defer = (p) => { p.catch(() => {}); };
try {
  const wu = require('@vercel/functions').waitUntil;
  if (wu) defer = (p) => { const q = p.catch(() => {}); try { wu(q); } catch (e) {} };
} catch (e) {}

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

const chunkRef = (version, i) => db().collection('joolry_snap').doc(version + '_' + i);
const dropChunks = (version, n) =>
  Promise.all(Array.from({ length: n || 0 }, (_, i) => chunkRef(version, i).delete().catch(() => {})));

/**
 * Save a snapshot.
 *  baseVersion given  → compare-and-swap: only commits if the live snapshot is STILL that version,
 *                       otherwise throws {code:'SNAP_CONFLICT'} (caller re-reads and re-applies its change).
 *  baseVersion absent → full rebuild from the sheet (sheet is the truth) → last writer wins.
 */
async function saveSnapshot(obj, baseVersion) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 6 });
  const version = Date.now() + '-' + crypto.randomBytes(2).toString('hex');
  const n = Math.max(1, Math.ceil(gz.length / CHUNK_BYTES));

  await Promise.all(Array.from({ length: n }, (_, i) =>
    chunkRef(version, i).set({ v: version, i: i, data: gz.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES) })));

  const meta = {
    version: version,
    chunks: n,
    lastUpdate: String(obj.builtAt || version),
    builtAt: Date.now(),
    bytes: gz.length,
    today: obj.today || ''
  };

  const ref = metaRef('snapshot');
  let prev = null;
  try {
    prev = await db().runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const cur = s.exists ? s.data() : null;
      if (baseVersion !== undefined && baseVersion !== null && (cur ? cur.version : null) !== baseVersion) {
        const e = new Error('SNAP_CONFLICT'); e.code = 'SNAP_CONFLICT'; throw e;
      }
      tx.set(ref, meta);
      return cur;
    });
  } catch (e) {
    await dropChunks(version, n);          // never leave orphan chunks behind
    throw e;
  }

  // previous version's chunks are now unreachable → clean up after the response (not on the hot path)
  if (prev && prev.version && prev.version !== version) defer(dropChunks(prev.version, prev.chunks));
  _mem = { version: version, data: obj };
  return meta;
}

async function loadSnapshot(meta, _retried) {
  if (_mem.version === meta.version && _mem.data) return _mem.data;
  const refs = Array.from({ length: meta.chunks }, (_, i) => chunkRef(meta.version, i));
  const docs = await db().getAll(...refs);
  if (docs.some((d) => !d.exists)) {
    // another instance saved a newer version and cleaned this one up → follow the new pointer once
    if (!_retried) {
      const fresh = await getMeta();
      if (fresh && fresh.version !== meta.version) return loadSnapshot(fresh, true);
    }
    throw new Error('Snapshot chunk missing');
  }
  const parts = docs.map((d) => Buffer.from(d.data().data));
  const obj = JSON.parse(zlib.gunzipSync(Buffer.concat(parts)).toString('utf8'));
  _mem = { version: meta.version, data: obj };
  return obj;
}

module.exports = {
  db, setDb, metaRef, getMeta, getSyncState, isBusy, markDirty,
  saveSnapshot, loadSnapshot, LEASE_MS
};
