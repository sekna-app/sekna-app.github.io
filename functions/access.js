// Checks a device's access token, like checkAccessToken_ in Code.gs: only the token's
// SHA-256 hash is stored. Before sign-in moves to this server (accounts.js) the hashes are
// read from the "SEKNA Access" sheet; after the move they are read from Firestore.
const crypto = require('crypto');
const { batchGet, a1, fsGet, fsUpdate } = require('./google');

const ACCESS = {
  SPREADSHEET_ID: '1PWV9exRy9dwW3H66bt7W4E1SQb63EJbgVz96yS6fQkI',
  SHEET_NAME: 'SEKNA Access',
  ADMIN_EMAILS: ['ibrahim.amin6700@gmail.com', 'ibrahim@sekna.co.uk'],
  STATUSES: ['Pending', 'Approved', 'Denied', 'Revoked', 'Signed out', 'Invited'],
  CACHE_MS: 60 * 1000,
  FS_CACHE_MS: 30 * 1000,
  SEEN_EVERY_MS: 2 * 60 * 1000
};
const ACC = { mode: 'acc/mode', rows: 'acc/rows', seen: 'acc/seen' };

const sha256 = t => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');

/* ---------- moved yet? ---------- */
let modeCache = null;
async function accessMoved() {
  if (modeCache && Date.now() - modeCache.at < ACCESS.FS_CACHE_MS) return modeCache.on;
  const m = await fsGet(ACC.mode);
  modeCache = { at: Date.now(), on: !!(m && m.mode === 'firebase') };
  return modeCache.on;
}
function markMoved() { modeCache = { at: Date.now(), on: true }; }

/* ---------- rows ---------- */
let rowsCache = null, fsCache = null;
async function sheetRows() {
  if (rowsCache && Date.now() - rowsCache.at < ACCESS.CACHE_MS) return rowsCache.rows;
  const [values] = await batchGet(ACCESS.SPREADSHEET_ID, [a1(ACCESS.SHEET_NAME, 'A2:J')]);
  const rows = values.map(v => ({
    id: String(v[0] || ''),
    name: String(v[1] || ''),
    email: String(v[2] || '').trim().toLowerCase(),
    status: String(v[3] || '').trim(),
    tokenHash: String(v[8] || '')
  }));
  rowsCache = { at: Date.now(), rows };
  return rows;
}
/** The access rows kept in Firestore (after the move). fresh: skip this instance's short cache. */
async function storeRows(fresh) {
  if (!fresh && fsCache && Date.now() - fsCache.at < ACCESS.FS_CACHE_MS) return fsCache.rows;
  const doc = await fsGet(ACC.rows);
  const rows = (doc && Array.isArray(doc.items)) ? doc.items : [];
  fsCache = { at: Date.now(), rows };
  return rows;
}
function forgetRows(rows) { fsCache = rows ? { at: Date.now(), rows } : null; }
async function accessRows() { return (await accessMoved()) ? storeRows() : sheetRows(); }

/* ---------- last seen (at most every 2 minutes per device) ---------- */
const seenAt = {};
let lastFresh = 0;
function touchSeen(hash) {
  if (Date.now() - (seenAt[hash] || 0) < ACCESS.SEEN_EVERY_MS) return;
  seenAt[hash] = Date.now();
  fsUpdate(ACC.seen, all => { all = all || {}; all[hash] = Date.now(); return all; }).catch(() => {});
}

async function checkAccessToken(token) {
  token = String(token || '');
  if (token.length < 40) return { ok: false, status: 'Missing' };
  const hash = sha256(token);
  const moved = await accessMoved();
  let row = (moved ? await storeRows() : await sheetRows()).find(r => r.tokenHash === hash);
  // A device that signed in a moment ago on another server copy: read again before saying no.
  // At most one extra read every 3 seconds, so unknown tokens cannot drive up the reads.
  if (!row && moved && Date.now() - lastFresh > 3000) { lastFresh = Date.now(); row = (await storeRows(true)).find(r => r.tokenHash === hash); }
  if (!row) return { ok: false, status: 'Unknown' };
  const status = ACCESS.STATUSES.indexOf(row.status) >= 0 ? row.status : 'Pending';
  if (moved && status === 'Approved') touchSeen(hash);
  return { ok: status === 'Approved', status, name: row.name, email: row.email };
}

async function assertAccess(token) {
  const a = await checkAccessToken(token);
  if (!a.ok) {
    const err = new Error('SEKNA_ACCESS_' + String(a.status || 'Unknown').toUpperCase());
    err.access = true;
    throw err;
  }
  return a;
}

async function assertAdmin(token) {
  const a = await assertAccess(token);
  if (ACCESS.ADMIN_EMAILS.indexOf(a.email) < 0) {
    const err = new Error('SEKNA_ADMIN_ONLY');
    err.access = true;
    throw err;
  }
  return a;
}

function isAdminEmail(email) { return ACCESS.ADMIN_EMAILS.indexOf(String(email || '').toLowerCase()) >= 0; }

module.exports = { ACCESS, ACC, sha256, assertAccess, assertAdmin, checkAccessToken, accessRows, storeRows, forgetRows,
  accessMoved, markMoved, isAdminEmail };
