// SEKNA server on Firebase. It answers the two heavy dashboard requests
// (getDashboardData, getMonthCompareData) straight from the Google Sheets. Everything
// else, and these two whenever this server fails, still goes to Apps Script.
const { onRequest } = require('firebase-functions/v2/https');
const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { buildDashboardData, getMonthCompareData, normalizeAccountKey_ } = require('./dash');
const { assertAccess, assertAdmin, assertPerm } = require('./access');
const { fsGet, fsSet, fsAppend, fsList, fsClearList, request, PROJECT_ID } = require('./google');
const { archiveStatus, archiveMove, archiveProgress } = require('./archive');
const tasks = require('./tasks');
const accounts = require('./accounts');
const rest = require('./rest');
const notify = require('./notify');

const VERSION = 'server-1';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzjgZ1nXxLTcFdeFCIEznOj2H0XCo9YGUeu1YF2pJdsQiOo_aM-Mn6HxKKNk8peEuM1Ig/exec';
const SERVER_ACCOUNT = 'sekna-server@human-appeal-media-plan.iam.gserviceaccount.com';
const ORIGINS = ['https://sekna-app.web.app', 'https://sekna-app.firebaseapp.com', 'https://sekna-app.github.io'];
// The keep-warm job rebuilds the data every 2 minutes, so people get it ready-made;
// Refresh in the app (forceFresh) still reads the sheets on the spot.
const DASH_CACHE_MS = 150 * 1000;
const WARM_ACCOUNTS = ['usa', 'ar'];
const API_URL = 'https://europe-west2-human-appeal-media-plan.cloudfunctions.net/api';
let lastWarm = 0;
const MONTHS_CACHE_MS = 30 * 60 * 1000;

const started = Date.now();
const stats = { served: 0, errors: 0, lastError: '', lastErrorAt: 0, warmErrors: {} };
const cache = {};

/** One build at a time per key; later callers share it, and the result is kept for ttl. */
function cached(key, ttl, fresh, build) {
  const hit = cache[key];
  if (!fresh && hit && hit.value && Date.now() - hit.at < ttl) return Promise.resolve(hit.value);
  if (hit && hit.pending) return hit.pending;
  const pending = build().then(value => {
    cache[key] = { at: Date.now(), value };
    return value;
  }, err => {
    delete cache[key];
    throw err;
  });
  cache[key] = Object.assign({}, hit, { pending });
  return pending;
}

/* ---------- When the sheets are read (Admin → Server → Reading the sheets) ----------
 * Inside the reading window the data is read from the sheets as before (every 2 minutes).
 * Outside it nothing reads the sheets: everyone gets the last read, kept in Firestore so a
 * restarted server still has it. Refresh in the app always reads the sheet on the spot.
 */
const READ_DOC = 'server/read-window';
const READ_DEFAULT = { on: true, from: '12:50', to: '13:10', tz: 'Asia/Muscat' };
let readCache = null;
async function readWindow() {
  if (readCache && Date.now() - readCache.at < 60000) return readCache.v;
  let v = null;
  try { v = await fsGet(READ_DOC); } catch (e) { console.error('Read window: ' + errorText(e)); }
  readCache = { at: Date.now(), v: Object.assign({}, READ_DEFAULT, v || {}) };
  return readCache.v;
}
const toMin = hm => { const m = String(hm || '').match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1] % 24) * 60 + (+m[2] % 60) : null; };
function inReadWindow(w, now) {
  if (!w || !w.on) return true;
  const f = toMin(w.from), t = toMin(w.to);
  if (f == null || t == null) return true;
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: w.tz || 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now || Date.now())).forEach(x => { p[x.type] = x.value; });
  const m = +p.hour * 60 + +p.minute;
  return f <= t ? m >= f && m <= t : m >= f || m <= t; // a window can go past midnight
}
const snapDoc = (kind, key) => 'server/snap-' + kind + '-' + key;
async function saveSnap(kind, key, value) {
  try {
    const json = JSON.stringify(value);
    if (json.length > 900000) { console.warn('Snapshot too big to keep: ' + kind + ' ' + key + ' ' + json.length); return; }
    await fsSet(snapDoc(kind, key), { at: Date.now(), v: value });
  } catch (e) { console.error('Snapshot ' + kind + ' ' + key + ': ' + errorText(e)); }
}
/** The dashboard ('dash') or month history ('months') of one account, read from the sheet only when allowed. */
async function sheetData(kind, key, force) {
  const ttl = kind === 'dash' ? DASH_CACHE_MS : MONTHS_CACHE_MS;
  const build = () => (kind === 'dash' ? buildDashboardData(key) : getMonthCompareData(key)).then(v => { saveSnap(kind, key, v); return v; });
  const ck = kind + ':' + key;
  if (force || inReadWindow(await readWindow())) return cached(ck, ttl, !!force, build);
  const hit = cache[ck];
  if (hit && hit.value) return hit.value;
  if (hit && hit.pending) return hit.pending;
  const snap = await fsGet(snapDoc(kind, key)).catch(() => null);
  if (snap && snap.v) { cache[ck] = { at: snap.at || Date.now(), value: snap.v }; return snap.v; }
  return cached(ck, ttl, true, build); // nothing kept yet: read once
}

/** The access check and the data are fetched together; nothing is returned unless access is approved. */
async function withAccess(token, dataPromise) {
  const [access, data] = await Promise.allSettled([assertAccess(token), dataPromise]);
  if (access.status === 'rejected') throw access.reason;
  if (await accounts.maintenanceBlocks(access.value.email)) { const e = new Error('SEKNA_MAINTENANCE'); e.access = true; throw e; }
  if (data.status === 'rejected') throw data.reason;
  return data.value;
}

const CALLS = {
  async getDashboardData(args) {
    const key = normalizeAccountKey_(args[0]);
    return withAccess(args[2], sheetData('dash', key, !!args[1]));
  },
  async getMonthCompareData(args) {
    const key = normalizeAccountKey_(args[0]);
    return withAccess(args[1], sheetData('months', key, false));
  },
  // Media Plan Lab → Close the month (Admin → Permissions → Lab).
  /** Admin → Server → Reading the sheets: when the server reads them, and when it last did. */
  async adminReadWindow(args) {
    await assertAdmin(args[0]);
    const w = await readWindow(), last = {};
    WARM_ACCOUNTS.forEach(k => { const h = cache['dash:' + k]; if (h && h.at) last[k] = h.at; });
    return { window: w, open: inReadWindow(w), last };
  },
  async adminReadWindowSet(args) {
    const me = await assertAdmin(args[0]);
    const c = args[1] || {};
    const tz = ['Africa/Cairo', 'Asia/Muscat', 'Europe/London', 'Asia/Dubai', 'Asia/Riyadh'].indexOf(c.tz) >= 0 ? c.tz : 'Africa/Cairo';
    if (c.on && (toMin(c.from) == null || toMin(c.to) == null)) throw new Error('Pick a start and an end time.');
    const v = { on: !!c.on, from: String(c.from || READ_DEFAULT.from), to: String(c.to || READ_DEFAULT.to), tz, by: me.email, at: Date.now() };
    await fsSet(READ_DOC, v);
    readCache = { at: Date.now(), v };
    return { window: v, open: inReadWindow(v) };
  },
  async adminArchiveStatus(args) {
    await assertPerm(args[0], 'lab');
    return archiveStatus(args[1]);
  },
  async adminArchiveProgress(args) {
    await assertPerm(args[0], 'lab');
    return archiveProgress(args[1]);
  },
  async adminArchiveMove(args) {
    const who = await assertPerm(args[0], 'lab');
    const key = normalizeAccountKey_(args[1]);
    const result = await archiveMove(key, who);
    delete cache['dash:' + key];
    delete cache['months:' + key];
    return result;
  }
};
// Team Tasks, days off and members (tasks.js): Apps Script answers until the admin moves them.
tasks.FNS.forEach(fn => { CALLS[fn] = args => tasks.call(fn, args); });
// Sign-in, approvals, devices and app state (accounts.js): Apps Script answers until the admin moves them.
accounts.FNS.forEach(fn => { CALLS[fn] = args => accounts.call(fn, args); });
// Usage, shares, ideas, plan history, monthly report, web notifications (rest.js): same rule.
rest.FNS.forEach(fn => { CALLS[fn] = args => rest.call(fn, args); });

/* ---------- Switch log (Firestore) ---------- */

const EVENTS = 'server/events';

async function logEvent(b) {
  const who = await assertAccess(b.token);
  const backup = b.kind !== 'firebase';
  const reason = String(b.reason || '').slice(0, 200);
  await fsAppend(EVENTS, { at: Date.now(), name: who.name || '', email: who.email || '',
    server: backup ? 'Backup (Apps Script)' : 'Firebase', reason, device: String(b.device || '').slice(0, 120), id: Math.random().toString(36).slice(2, 10) });
  // Apps Script sends the email (at most one every 3 hours); the log itself stays here.
  if (backup) {
    if (await rest.moved()) await rest.serverSwitchEmail(who, reason).catch(() => {});
    else await appsScriptCall('notifyServerSwitch', [b.token, reason]).catch(() => {});
  }
}

function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : (req.rawBody ? req.rawBody.toString('utf8') : '');
  try { return JSON.parse(text || '{}'); } catch (e) { return {}; }
}

function errorText(err) {
  return String((err && err.message) || err || 'Unknown error').slice(0, 300);
}

/* ---------- Admin: compare this server with Apps Script ---------- */

async function appsScriptCall(fn, args) {
  const res = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'call', fn, args }), redirect: 'follow' });
  const j = await res.json();
  if (!j || !j.ok) throw new Error((j && j.error) || 'Apps Script did not answer.');
  return j.result;
}

const SKIP = { generatedAt: 1, generatedAtMs: 1, userEmail: 1 };

function diff(a, b, path, out) {
  if (out.length >= 40) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) out.push({ path, firebase: a, appsScript: b });
    return;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.push({ path, firebase: short(a), appsScript: short(b) });
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push({ path, firebase: short(a), appsScript: short(b) }); return; }
  const keys = Array.from(new Set(Object.keys(a).concat(Object.keys(b))));
  for (const k of keys) {
    if (SKIP[k] && !path) continue;
    diff(a[k], b[k], path ? path + '.' + k : k, out);
    if (out.length >= 40) return;
  }
}

function short(v) {
  if (v === undefined) return '(missing)';
  const s = JSON.stringify(v);
  return s && s.length > 120 ? s.slice(0, 117) + '…' : v;
}

async function parity(token, account) {
  const key = normalizeAccountKey_(account);
  const out = {};
  for (const [name, fb, asArgs] of [
    ['getDashboardData', () => buildDashboardData(key), [key, true, token]],
    ['getMonthCompareData', () => getMonthCompareData(key), [key, token]]
  ]) {
    const t0 = Date.now();
    const [mine, theirs] = await Promise.all([
      fb().then(v => ({ v, ms: Date.now() - t0 }), e => ({ error: errorText(e) })),
      appsScriptCall(name, asArgs).then(v => ({ v, ms: Date.now() - t0 }), e => ({ error: errorText(e) }))
    ]);
    const differences = [];
    if (mine.v && theirs.v) diff(mine.v, theirs.v, '', differences);
    out[name] = {
      same: !!(mine.v && theirs.v && !differences.length),
      firebaseMs: mine.ms || null, appsScriptMs: theirs.ms || null,
      firebaseError: mine.error || '', appsScriptError: theirs.error || '',
      differences
    };
  }
  return { account: key, results: out };
}

/* ---------- HTTP ---------- */

exports.api = onRequest({
  region: 'europe-west2',
  // The Gmail App Password, only once it has been added (the deploy workflow says so).
  ...(notify.MAIL_ON_DEPLOY ? { secrets: [notify.GMAIL_PASSWORD] } : {}),
  serviceAccount: SERVER_ACCOUNT,
  memory: '512MiB',
  cpu: 1,
  concurrency: 20,
  minInstances: 0,
  maxInstances: 5,
  timeoutSeconds: 120,
  invoker: 'public'
}, async (req, res) => {
  const origin = req.get('origin') || '';
  if (ORIGINS.indexOf(origin) >= 0) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
  }
  res.set('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const route = String(req.path || '/').replace(/\/+$/, '') || '/';
  if (route === '/ping') { res.json({ ok: true, version: VERSION, mail: notify.mailReady() ? 'gmail' : 'apps-script' }); return; }
  if (route === '/warm') {
    // Called by keepWarm. At most once a minute; it only refreshes the shared data.
    if (Date.now() - lastWarm < 60 * 1000) { res.json({ ok: true, skipped: true }); return; }
    lastWarm = Date.now();
    const done = [], latest = {};
    const open = inReadWindow(await readWindow());
    for (const key of WARM_ACCOUNTS) {
      // Outside the reading window: the last read (no sheet), so the push checks still see the latest day.
      try { const d = open ? await sheetData('dash', key, true) : await sheetData('dash', key, false); if (open) done.push(key); latest[key] = d && d.latest; delete stats.warmErrors[key]; }
      catch (e) {
        // Shown on Admin → Server; USA failing also counts as a server error.
        stats.warmErrors[key] = { error: errorText(e), at: Date.now() };
        if (key === 'usa') { stats.errors++; stats.lastError = errorText(e); stats.lastErrorAt = Date.now(); }
      }
      if (open) try { await sheetData('months', key, false); } catch (e) {}
    }
    // New day / team message / app version notifications (after the rest moved here).
    let pushed = null;
    try { pushed = await rest.pushChecks(latest); } catch (e) { pushed = { error: errorText(e) }; console.error('Push checks: ' + errorText(e)); }
    // The 9 AM Cairo backup push rides on this check (no schedule of its own).
    try { const m = await tasks.morningPushIfDue(); if (m) pushed = Object.assign({}, pushed, { morning: m }); } catch (e) { console.error('Morning push: ' + errorText(e)); }
    try { await rest.fxRefreshIfDue(); } catch (e) { console.error('Rates: ' + errorText(e)); }
    // Kept for /diag/push: the latest day seen per account, and what the check did with it.
    stats.lastPush = { at: Date.now(), seen: Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, v && v.date])), pushed };
    if (pushed && Object.keys(pushed).some(k => k !== 'skipped' && k !== 'error')) stats.lastPushSent = stats.lastPush;
    res.json({ ok: true, warmed: done, pushed });
    return;
  }
  if (route === '/diag/push') {
    // Can this server send notifications itself? validate_only: nothing reaches any phone.
    const out = {};
    try {
      const r = await request(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, { method: 'POST',
        data: { validate_only: true, message: { topic: 'sekna-diag', data: { title: 'check' } } } });
      out.fcm = r && r.name ? 'ok' : 'unexpected';
    } catch (e) { out.fcm = String((e.response && e.response.status) || '') + ' ' + errorText(e).slice(0, 160); }
    out.lastCheck = stats.lastPush || null;
    out.lastSent = stats.lastPushSent || null;
    try { const st = await rest.pushState(); out.stored = st; } catch (e) { out.stored = errorText(e); }
    res.json({ ok: true, result: out });
    return;
  }
  if (route === '/review' && req.method === 'GET') {
    // The page the admin opens from an access request email (approve / deny / revoke).
    try { res.set('Content-Type', 'text/html; charset=utf-8').send(await accounts.reviewPage(req.query || {})); }
    catch (err) { res.status(500).send('Something went wrong. Please try again.'); }
    return;
  }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only.' }); return; }

  const b = body(req);
  try {
    if (route === '/call') {
      const fn = String(b.fn || '');
      if (!Object.prototype.hasOwnProperty.call(CALLS, fn)) { res.json({ ok: false, error: 'Unknown request.', fallback: true }); return; }
      const result = await CALLS[fn](Array.isArray(b.args) ? b.args.slice(0, 6) : []);
      stats.served++;
      // Which parts already live here, so the app never falls back to an out-of-date copy.
      const moved = await Promise.all([tasks.moved(), accounts.accessMovedFlag(), rest.moved()]).catch(() => null);
      res.json({ ok: true, result, server: VERSION, moved: moved ? { tasks: moved[0], access: moved[1], rest: moved[2] } : null });
      return;
    }
    if (route === '/event') {
      await logEvent(b);
      res.json({ ok: true, result: { ok: true } });
      return;
    }
    if (route === '/events') {
      await assertAdmin(b.token);
      const list = (await fsList(EVENTS)).sort((x, y) => y.at - x.at).slice(0, 50);
      res.json({ ok: true, result: list });
      return;
    }
    if (route === '/events/clear') {
      await assertAdmin(b.token);
      await fsClearList(EVENTS);
      res.json({ ok: true, result: { ok: true } });
      return;
    }
    if (route === '/status') {
      await assertAdmin(b.token);
      let billing = null, billingError = '';
      try { billing = await fsGet('server/billing'); } catch (e) { billingError = errorText(e); }
      res.json({ ok: true, result: {
        version: VERSION, region: 'europe-west2', now: Date.now(), startedAt: started,
        served: stats.served, errors: stats.errors, lastError: stats.lastError, lastErrorAt: stats.lastErrorAt, warmErrors: stats.warmErrors,
        billing, billingError
      } });
      return;
    }
    if (route === '/parity') {
      await assertAdmin(b.token);
      res.json({ ok: true, result: await parity(b.token, b.account) });
      return;
    }
    res.status(404).json({ ok: false, error: 'Not found.' });
  } catch (err) {
    const text = errorText(err);
    if (err && err.access) { res.json({ ok: false, error: text, access: true }); return; }
    const refusal = !(err && err.response) && /^(Error: )?(SEKNA_|Please |This |Choose |Give |Pick |Only |Unknown |That code|Too many|A code was|Revoke or deny|Already|Sign-in already|Team Tasks already|The report|The month|The media plan|There is no one|Your own device)/.test(text);
    if (!refusal) { stats.errors++; stats.lastError = text; stats.lastErrorAt = Date.now(); }
    console.error(route, text);
    res.json({ ok: false, error: text, fallback: true });
  }
});

/* ---------- Monthly limit ----------
 * The "SEKNA cap" budget ($3) posts the month's cost to the sekna-budget topic a few
 * times a day. The cost is kept for Admin → Server; at the limit, billing is switched
 * off for this project, Firebase stops, and the app carries on with Apps Script.
 */
exports.monthlyLimit = onMessagePublished({
  topic: 'sekna-budget',
  region: 'europe-west2',
  serviceAccount: SERVER_ACCOUNT,
  memory: '256MiB',
  maxInstances: 1,
  retry: false
}, async event => {
  const m = event.data.message;
  let msg = m.json;
  if (!msg) { try { msg = JSON.parse(Buffer.from(m.data || '', 'base64').toString('utf8')); } catch (e) { msg = {}; } }
  const cost = Number(msg.costAmount) || 0, budget = Number(msg.budgetAmount) || 0;
  const record = { cost, budget, currency: msg.currencyCode || 'USD', at: Date.now(), month: String(msg.costIntervalStart || '').slice(0, 7), stopped: false };
  if (budget > 0 && cost >= budget) {
    record.stopped = true;
    await fsSet('server/billing', record);
    await request(`https://cloudbilling.googleapis.com/v1/projects/${PROJECT_ID}/billingInfo`, { method: 'PUT', data: { billingAccountName: '' } });
    console.warn(`Monthly limit reached (${cost} of ${budget} ${record.currency}): billing switched off.`);
    return;
  }
  await fsSet('server/billing', record);
});

/* ---------- Keep warm ----------
 * Every 2 minutes: wakes the server and rebuilds the USA data, so opening SEKNA does not
 * wait for a cold start or for the sheets. About 22,000 calls a month, inside the free tier.
 */
exports.keepWarm = onSchedule({
  schedule: 'every 2 minutes',
  region: 'europe-west2',
  serviceAccount: SERVER_ACCOUNT,
  memory: '256MiB',
  maxInstances: 1,
  retryCount: 0
}, async () => {
  const res = await fetch(API_URL + '/warm', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } });
  if (!res.ok) throw new Error('Warm-up answered ' + res.status);
});

