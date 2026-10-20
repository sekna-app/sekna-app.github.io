// SEKNA server on Firebase. It answers the two heavy dashboard requests
// (getDashboardData, getMonthCompareData) straight from the Google Sheets. Everything
// else, and these two whenever this server fails, still goes to Apps Script.
const { onRequest } = require('firebase-functions/v2/https');
const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { buildDashboardData, getMonthCompareData, normalizeAccountKey_ } = require('./dash');
const { assertAccess, assertAdmin } = require('./access');
const { fsGet, fsSet, request, PROJECT_ID } = require('./google');

const VERSION = 'server-1';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzjgZ1nXxLTcFdeFCIEznOj2H0XCo9YGUeu1YF2pJdsQiOo_aM-Mn6HxKKNk8peEuM1Ig/exec';
const SERVER_ACCOUNT = 'sekna-server@human-appeal-media-plan.iam.gserviceaccount.com';
const ORIGINS = ['https://sekna-app.web.app', 'https://sekna-app.firebaseapp.com', 'https://sekna-app.github.io'];
const DASH_CACHE_MS = 25 * 1000;
const MONTHS_CACHE_MS = 30 * 60 * 1000;

const started = Date.now();
const stats = { served: 0, errors: 0, lastError: '', lastErrorAt: 0 };
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

const CALLS = {
  async getDashboardData(args) {
    await assertAccess(args[2]);
    const key = normalizeAccountKey_(args[0]);
    return cached('dash:' + key, DASH_CACHE_MS, !!args[1], () => buildDashboardData(key));
  },
  async getMonthCompareData(args) {
    await assertAccess(args[1]);
    const key = normalizeAccountKey_(args[0]);
    return cached('months:' + key, MONTHS_CACHE_MS, false, () => getMonthCompareData(key));
  }
};

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

const SKIP = { generatedAt: 1, userEmail: 1 };

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
  serviceAccount: SERVER_ACCOUNT,
  memory: '512MiB',
  cpu: 1,
  concurrency: 20,
  minInstances: 0,
  maxInstances: 2,
  timeoutSeconds: 60,
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
  if (route === '/ping') { res.json({ ok: true, version: VERSION }); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only.' }); return; }

  const b = body(req);
  try {
    if (route === '/call') {
      const fn = String(b.fn || '');
      if (!Object.prototype.hasOwnProperty.call(CALLS, fn)) { res.json({ ok: false, error: 'Unknown request.', fallback: true }); return; }
      const result = await CALLS[fn](Array.isArray(b.args) ? b.args.slice(0, 6) : []);
      stats.served++;
      res.json({ ok: true, result, server: VERSION });
      return;
    }
    if (route === '/status') {
      await assertAdmin(b.token);
      let billing = null, billingError = '';
      try { billing = await fsGet('server/billing'); } catch (e) { billingError = errorText(e); }
      res.json({ ok: true, result: {
        version: VERSION, region: 'europe-west2', now: Date.now(), startedAt: started,
        served: stats.served, errors: stats.errors, lastError: stats.lastError, lastErrorAt: stats.lastErrorAt,
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
    stats.errors++; stats.lastError = text; stats.lastErrorAt = Date.now();
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
