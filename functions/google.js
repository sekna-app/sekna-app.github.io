// Small REST helpers for Google Sheets and Firestore. The function runs as the
// sekna-server service account, so no keys are stored anywhere.
const { GoogleAuth } = require('google-auth-library');

const PROJECT_ID = 'human-appeal-media-plan';
const auth = new GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/cloud-platform'
  ]
});

async function request(url, opts = {}) {
  const client = await auth.getClient();
  const res = await client.request({ url, method: opts.method || 'GET', data: opts.data, timeout: opts.timeout || 25000 });
  return res.data;
}

/* ---------- Sheets ---------- */

const metaCache = {};
const META_TTL = 10 * 60 * 1000;

/** Time zone and every tab (id, title, size) of a spreadsheet, cached for 10 minutes. */
async function sheetMeta(ssId) {
  const hit = metaCache[ssId];
  if (hit && Date.now() - hit.at < META_TTL) return hit.meta;
  const fields = 'properties.timeZone,sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))';
  const data = await request(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}?fields=${encodeURIComponent(fields)}`);
  const meta = {
    timeZone: (data.properties && data.properties.timeZone) || 'Asia/Muscat',
    sheets: (data.sheets || []).map(s => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      index: s.properties.index || 0,
      rows: (s.properties.gridProperties || {}).rowCount || 0,
      cols: (s.properties.gridProperties || {}).columnCount || 0
    })).sort((a, b) => a.index - b.index)
  };
  metaCache[ssId] = { at: Date.now(), meta };
  return meta;
}

function a1(title, range) {
  return `'${String(title).replace(/'/g, "''")}'!${range}`;
}

/**
 * Reads several ranges in one call. Dates come back as serial numbers, like the
 * numbers Apps Script would turn into Date objects.
 * With formattedDates, dates come back as text instead (used to tell dates apart).
 */
async function batchGet(ssId, ranges, formattedDates) {
  if (!ranges.length) return [];
  const qs = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&') +
    '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=' + (formattedDates ? 'FORMATTED_STRING' : 'SERIAL_NUMBER');
  const data = await request(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values:batchGet?${qs}`);
  return (data.valueRanges || []).map(v => v.values || []);
}

/* ---------- Firestore (one JSON field per document) ---------- */

const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

async function fsGet(path) {
  try {
    const doc = await request(`${FS}/${path}`);
    const f = doc.fields && doc.fields.json;
    return f && f.stringValue ? JSON.parse(f.stringValue) : null;
  } catch (err) {
    if (err && err.response && err.response.status === 404) return null;
    throw err;
  }
}

async function fsSet(path, obj) {
  await request(`${FS}/${path}`, { method: 'PATCH', data: { fields: { json: { stringValue: JSON.stringify(obj) } } } });
}

module.exports = { PROJECT_ID, request, sheetMeta, batchGet, a1, fsGet, fsSet };
