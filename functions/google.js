// Small REST helpers for Google Sheets and Firestore. The function runs as the
// sekna-server service account, so no keys are stored anywhere.
const { GoogleAuth } = require('google-auth-library');

const PROJECT_ID = 'human-appeal-media-plan';
const auth = new GoogleAuth({
  scopes: [
    // Read and write; what the server can actually change is decided by how each sheet is shared.
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/cloud-platform'
  ]
});

async function request(url, opts = {}) {
  const client = await auth.getClient();
  const res = await client.request({ url, method: opts.method || 'GET', data: opts.data, headers: opts.headers, timeout: opts.timeout || 25000 });
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

/** The shown text and the fill colour (conditional formatting included) of every cell of a range. */
async function cellLooks(ssId, range) {
  const fields = 'sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor)';
  const data = await request(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}?ranges=${encodeURIComponent(range)}&fields=${encodeURIComponent(fields)}`);
  const rows = (((data.sheets || [])[0] || {}).data || [])[0];
  return ((rows && rows.rowData) || []).map(r => (r.values || []).map(c => ({ v: c.formattedValue || '', bg: (c.effectiveFormat && c.effectiveFormat.backgroundColor) || null })));
}

/** Writes values exactly as given (numbers stay numbers, text stays text). */
async function valuesUpdate(ssId, range, values) {
  return request(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { method: 'PUT', data: { range, majorDimension: 'ROWS', values } });
}

/** Several ranges in one write, values exactly as given ('' empties a cell). */
async function valuesBatchUpdate(ssId, data) {
  return request(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values:batchUpdate`,
    { method: 'POST', data: { valueInputOption: 'RAW', data: data.map(d => ({ range: d.range, majorDimension: 'ROWS', values: d.values })) } });
}

/** Writes values as if typed in Sheets (so "2026-10-21 15:52:00" becomes a date). */
async function valuesUpdateTyped(ssId, range, values) {
  return request(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    { method: 'PUT', data: { range, majorDimension: 'ROWS', values } });
}

/** Empties the values of a range and keeps its formatting (like clearContent). */
async function valuesClear(ssId, range) {
  return request(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}/values/${encodeURIComponent(range)}:clear`, { method: 'POST', data: {} });
}

async function sheetsBatchUpdate(ssId, requests) {
  return request(`https://sheets.googleapis.com/v4/spreadsheets/${ssId}:batchUpdate`, { method: 'POST', data: { requests } });
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

async function fsDelete(path) {
  try { await request(`${FS}/${path}`, { method: 'DELETE' }); }
  catch (err) { if (!(err && err.response && err.response.status === 404)) throw err; }
}

/** Adds one JSON item to a list document in a single write, so two devices never overwrite each other. */
async function fsAppend(path, obj) {
  const name = `projects/${PROJECT_ID}/databases/(default)/documents/${path}`;
  await request(`${FS}:commit`, { method: 'POST', data: { writes: [{
    transform: { document: name, fieldTransforms: [{ fieldPath: 'items', appendMissingElements: { values: [{ stringValue: JSON.stringify(obj) }] } }] }
  }] } });
}

async function fsList(path) {
  try {
    const doc = await request(`${FS}/${path}`);
    const items = doc.fields && doc.fields.items && doc.fields.items.arrayValue && doc.fields.items.arrayValue.values;
    return (items || []).map(v => { try { return JSON.parse(v.stringValue); } catch (e) { return null; } }).filter(Boolean);
  } catch (err) {
    if (err && err.response && err.response.status === 404) return [];
    throw err;
  }
}

/** Writes a whole list document at once (used when copying old logs over). */
async function fsSetList(path, list) {
  await request(`${FS}/${path}`, { method: 'PATCH', data: { fields: { items: { arrayValue: { values: list.map(o => ({ stringValue: JSON.stringify(o) })) } } } } });
}

async function fsClearList(path) {
  await request(`${FS}/${path}`, { method: 'PATCH', data: { fields: { items: { arrayValue: { values: [] } } } } });
}

/**
 * Read-change-write of one JSON document that never loses a change made at the same moment:
 * the write only goes through if the document is still the version that was read, else it retries.
 */
async function fsUpdate(path, change) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let doc = null;
    try { doc = await request(`${FS}/${path}`); } catch (err) { if (!(err && err.response && err.response.status === 404)) throw err; }
    const f = doc && doc.fields && doc.fields.json;
    const before = f && f.stringValue ? JSON.parse(f.stringValue) : null;
    const out = await change(before);
    if (out === undefined) return before;
    const pre = doc ? `currentDocument.updateTime=${encodeURIComponent(doc.updateTime)}` : 'currentDocument.exists=false';
    try {
      await request(`${FS}/${path}?${pre}`, { method: 'PATCH', data: { fields: { json: { stringValue: JSON.stringify(out) } } } });
      return out;
    } catch (err) {
      const st = err && err.response && err.response.status;
      if (st !== 400 && st !== 409 && st !== 412) throw err;
      await new Promise(r => setTimeout(r, 80 + Math.random() * 200));
    }
  }
  throw new Error('Someone else is saving at the same time. Please try again.');
}

/** Forgets the cached tab list, so the next read sees a sheet's new size. */
function forgetMeta(ssId) { delete metaCache[ssId]; }

module.exports = { cellLooks, PROJECT_ID, request, sheetMeta, batchGet, a1, valuesBatchUpdate, fsGet, fsSet, fsDelete, fsUpdate, fsAppend, fsList, fsSetList, fsClearList,
  valuesUpdate, valuesUpdateTyped, valuesClear, sheetsBatchUpdate, forgetMeta };
