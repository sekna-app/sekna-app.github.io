// Checks a device's access token against the "SEKNA Access" sheet, like checkAccessToken_ in
// Code.gs: only the token's SHA-256 hash is stored there. Read-only: Apps Script still
// updates "Last seen" when the app asks for the access status.
const crypto = require('crypto');
const { batchGet, a1 } = require('./google');

const ACCESS = {
  SPREADSHEET_ID: '1PWV9exRy9dwW3H66bt7W4E1SQb63EJbgVz96yS6fQkI',
  SHEET_NAME: 'SEKNA Access',
  ADMIN_EMAILS: ['ibrahim.amin6700@gmail.com', 'ibrahim@sekna.co.uk'],
  STATUSES: ['Pending', 'Approved', 'Denied', 'Revoked', 'Signed out', 'Invited'],
  CACHE_MS: 60 * 1000
};

let rowsCache = null;

async function accessRows() {
  if (rowsCache && Date.now() - rowsCache.at < ACCESS.CACHE_MS) return rowsCache.rows;
  const [values] = await batchGet(ACCESS.SPREADSHEET_ID, [a1(ACCESS.SHEET_NAME, 'A2:J')]);
  const rows = values.map(v => ({
    name: String(v[1] || ''),
    email: String(v[2] || '').trim().toLowerCase(),
    status: String(v[3] || '').trim(),
    tokenHash: String(v[8] || '')
  }));
  rowsCache = { at: Date.now(), rows };
  return rows;
}

async function checkAccessToken(token) {
  token = String(token || '');
  if (token.length < 40) return { ok: false, status: 'Missing' };
  const hash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  const row = (await accessRows()).find(r => r.tokenHash === hash);
  if (!row) return { ok: false, status: 'Unknown' };
  const status = ACCESS.STATUSES.indexOf(row.status) >= 0 ? row.status : 'Pending';
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

module.exports = { assertAccess, assertAdmin };
