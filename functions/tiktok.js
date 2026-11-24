// TikTok · Human Appeal US: the Daily Performance, Day by Day and Monthly Progress data, built from the
// TikTok tracker sheet (one tab per month, e.g. "Nov 2026", and the "Media plan" tab) in the same shape as
// buildDashboardData, so the Google pages draw it as they are.
// Conversions and value are the CTA ones (the media plan targets are CTA). Money is in US dollars.
const { sheetMeta, batchGet, a1, request } = require('./google');

const TT_SHEET_ID = '1n-aHvbMFQalzmYn1vjHUDPYszF_B5-FVJIcPDY6PSUU';
const TT_ACCOUNT = { key: 'tt', label: 'Human Appeal US', shortLabel: 'TikTok', dashboardTitle: 'TikTok · Human Appeal US' };
// The four campaign types in the order the app shows them (the sheet calls Reach "Awareness").
const TT_TYPES = [['Partnership', 'Partnership'], ['Sales', 'Sales'], ['Catalog', 'Catalog'], ['Awareness', 'Reach']];
const TT_CH = TT_TYPES.map(t => t[1]);
const COL = { DATE: 0, CAT: 3, SPEND: 4, IMPR: 5, CLICKS: 6, CONV: 9, VALUE: 12 };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HIJRI = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { timeZone: 'UTC', month: 'long', day: 'numeric' });

const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : 0; };
const div = (a, b) => (b ? a / b : null);
const pad = n => String(n).padStart(2, '0');
const chOf = cat => { const t = TT_TYPES.find(x => x[0].toLowerCase() === String(cat || '').trim().toLowerCase()); return t ? t[1] : null; };
/** A sheet date (serial number or yyyy-mm-dd text) as yyyy-mm-dd. */
function dayKey(v) {
  if (typeof v === 'number' && v > 20000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '').trim());
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}
const utc = k => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)));
const hijriOf = k => { const p = {}; HIJRI.formatToParts(utc(k)).forEach(x => { p[x.type] = x.value; }); return p.day + ' ' + p.month; };
const blank = () => ({ spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0 });
function add(t, r) { t.spend += num(r[COL.SPEND]); t.impressions += num(r[COL.IMPR]); t.clicks += num(r[COL.CLICKS]); t.conversions += num(r[COL.CONV]); t.value += num(r[COL.VALUE]); }

/** "Media plan" tab: the block under "<Month> <Year>" → budget, CTA conversion and value targets per type. */
function readPlan(rows, monthKey) {
  const title = MONTHS[+monthKey.slice(5, 7) - 1] + ' ' + monthKey.slice(0, 4);
  const at = rows.findIndex(r => String(r[0] || '').trim().toLowerCase() === title.toLowerCase());
  const out = {};
  TT_CH.forEach(c => { out[c] = { budget: 0, conv: 0, value: 0 }; });
  if (at < 0) return { found: false, types: out };
  const head = (rows[at + 1] || []).map(h => String(h || '').trim().toLowerCase());
  const ix = name => head.indexOf(name);
  const iB = ix('budget'), iC = ix('cta conv target'), iV = ix('cta value target');
  for (let i = at + 2; i < rows.length; i++) {
    const name = String((rows[i] || [])[0] || '').trim();
    if (!name || /^total$/i.test(name)) break;
    const ch = chOf(name);
    if (ch) out[ch] = { budget: num(rows[i][iB]), conv: num(rows[i][iC]), value: num(rows[i][iV]) };
  }
  return { found: true, types: out };
}

/* ---------- Month history (History to Oct 2026 + the month tabs), in the shape of Google's getMonthCompareData ----------
 * months[yyyy-mm] = {spend, impressions, clicks, conversions, value, days, channels{type:{spend,clicks,conversions,value}}}
 * days[yyyy-mm-dd] = [spend, impressions, clicks, conversions, value] for each type in TT_CH order. CTA conversions and value.
 */
let histHeld = null;
const HIST_TTL = 30 * 60 * 1000;
function aggregate(rows, months, days) {
  rows.forEach(r => {
    const k = dayKey(r[COL.DATE]), ch = chOf(r[COL.CAT]); if (!k || !ch) return;
    const mk = k.slice(0, 7), ci = TT_CH.indexOf(ch);
    const m = months[mk] || (months[mk] = { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0, days: {}, channels: {} });
    const c = m.channels[ch] || (m.channels[ch] = { spend: 0, clicks: 0, conversions: 0, value: 0 });
    const sp = num(r[COL.SPEND]), im = num(r[COL.IMPR]), cl = num(r[COL.CLICKS]), cv = num(r[COL.CONV]), va = num(r[COL.VALUE]);
    m.spend += sp; m.impressions += im; m.clicks += cl; m.conversions += cv; m.value += va; m.days[k] = 1;
    c.spend += sp; c.clicks += cl; c.conversions += cv; c.value += va;
    const d = days[k] || (days[k] = new Array(TT_CH.length * 5).fill(0));
    d[ci * 5] += sp; d[ci * 5 + 1] += im; d[ci * 5 + 2] += cl; d[ci * 5 + 3] += cv; d[ci * 5 + 4] += va;
  });
}
function monthTabsOf(meta) {
  return meta.sheets.map(s => {
    const m = /^([A-Z][a-z]{2})\s+(\d{4})$/.exec(String(s.title).trim());
    const i = m ? MON.indexOf(m[1]) : -1;
    return i >= 0 ? { title: s.title, key: m[2] + '-' + pad(i + 1) } : null;
  }).filter(Boolean).sort((a, b) => (a.key < b.key ? 1 : -1));
}
/** The history tab (it changes once a month), kept for 30 minutes. */
async function historyRows(meta) {
  if (histHeld && Date.now() - histHeld.at < HIST_TTL) return histHeld.rows;
  const tab = meta.sheets.find(s => /^history/i.test(String(s.title).trim()));
  const rows = tab ? ((await batchGet(TT_SHEET_ID, [a1(tab.title, 'A2:M')]))[0] || []) : [];
  histHeld = { at: Date.now(), rows };
  return rows;
}
async function buildTikTokMonths(meta, monthRows) {
  meta = meta || await sheetMeta(TT_SHEET_ID);
  const months = {}, days = {};
  aggregate(await historyRows(meta), months, days);
  if (!monthRows) {
    const tabs = monthTabsOf(meta);
    const vals = tabs.length ? await batchGet(TT_SHEET_ID, tabs.map(t => a1(t.title, 'A2:M'))) : [];
    monthRows = tabs.map((t, i) => ({ key: t.key, rows: vals[i] || [] }));
  }
  // A month tab replaces the history for its month.
  monthRows.forEach(t => {
    const part = { m: {}, d: {} }; aggregate(t.rows, part.m, part.d);
    Object.keys(part.m).forEach(mk => { months[mk] = part.m[mk]; Object.keys(days).forEach(dk => { if (dk.slice(0, 7) === mk) delete days[dk]; }); });
    Object.keys(part.d).forEach(dk => { days[dk] = part.d[dk]; });
  });
  Object.keys(months).forEach(mk => { months[mk].days = Object.keys(months[mk].days).length; });
  Object.keys(days).forEach(dk => { days[dk] = days[dk].map(v => Math.round(v * 100) / 100); });
  return { months, days, channels: TT_CH.slice(), generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') };
}
const HPARTS = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
function hijriNum(k) { const p = {}; HPARTS.formatToParts(utc(k)).forEach(x => { p[x.type] = x.value; }); return { y: parseInt(p.year, 10), m: +p.month, d: +p.day }; }
const isoAdd = (k, n) => { const d = utc(k); d.setUTCDate(d.getUTCDate() + n); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
/** The same Hijri day one Hijri year back (Umm al-Qura), as yyyy-mm-dd. */
function sameHijriLastYear(k) {
  const h = hijriNum(k);
  for (let n = 350; n <= 360; n++) { const c = isoAdd(k, -n), x = hijriNum(c); if (x.y === h.y - 1 && x.m === h.m && x.d === h.d) return c; }
  for (let n = 350; n <= 360; n++) { const c = isoAdd(k, -n), x = hijriNum(c); if (x.y === h.y - 1 && x.m === h.m && Math.abs(x.d - h.d) <= 1) return c; }
  return '';
}

async function buildTikTokData() {
  let meta;
  try { meta = await sheetMeta(TT_SHEET_ID); }
  catch (e) { throw new Error('Could not open the TikTok sheet (' + String((e && e.message) || e).slice(0, 120) + '). Check that it is shared with the HEMERA server.'); }
  // The month tabs ("Nov 2026"), newest first; the newest one with a day of spend is the month shown.
  const monthTabs = meta.sheets.map(s => {
    const m = /^([A-Z][a-z]{2})\s+(\d{4})$/.exec(String(s.title).trim());
    const i = m ? MON.indexOf(m[1]) : -1;
    return i >= 0 ? { title: s.title, key: m[2] + '-' + pad(i + 1) } : null;
  }).filter(Boolean).sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, 3);
  if (!monthTabs.length) throw new Error('TikTok: no month tab (like "Nov 2026") was found.');
  const planTab = meta.sheets.find(s => /^media plan$/i.test(String(s.title).trim()));
  const vals = await batchGet(TT_SHEET_ID, monthTabs.map(t => a1(t.title, 'A2:M')).concat(planTab ? [a1(planTab.title, 'A1:O80')] : []));
  const hist = await buildTikTokMonths(meta, monthTabs.map((t, i) => ({ key: t.key, rows: vals[i] || [] })));

  let tab = null, rows = [];
  for (let i = 0; i < monthTabs.length; i++) {
    const r = (vals[i] || []).filter(x => dayKey(x[COL.DATE]) && chOf(x[COL.CAT]));
    if (r.some(x => num(x[COL.SPEND]) > 0)) { tab = monthTabs[i]; rows = r; break; }
  }
  if (!tab) throw new Error('TikTok: no day with spend was found in ' + monthTabs.map(t => t.title).join(' or ') + '.');
  const monthKey = tab.key, y = +monthKey.slice(0, 4), mo = +monthKey.slice(5, 7);
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const plan = readPlan(planTab ? vals[monthTabs.length] || [] : [], monthKey);
  const P = plan.types;
  const perDay = { spend: 0, conv: 0, value: 0 };
  TT_CH.forEach(c => { perDay.spend += P[c].budget / dim; perDay.conv += P[c].conv / dim; perDay.value += P[c].value / dim; });

  // Day × type totals.
  const byDay = {}, byDayCh = {}, month = blank(), monthCh = {};
  TT_CH.forEach(c => { monthCh[c] = blank(); });
  rows.forEach(r => {
    const k = dayKey(r[COL.DATE]); if (k.slice(0, 7) !== monthKey) return;
    const ch = chOf(r[COL.CAT]);
    add(byDay[k] || (byDay[k] = blank()), r);
    const dc = byDayCh[k] || (byDayCh[k] = {}); add(dc[ch] || (dc[ch] = blank()), r);
    add(month, r); add(monthCh[ch], r);
  });
  const liveDays = Object.keys(byDay).filter(k => byDay[k].spend > 0).sort();
  const latestKey = liveDays[liveDays.length - 1];
  const L = byDay[latestKey], ld = utc(latestKey);

  const dayPlan = [];
  for (let d = 1; d <= dim; d++) {
    const k = monthKey + '-' + pad(d), a = byDay[k], live = !!(a && (a.spend || a.clicks || a.conversions || a.value));
    dayPlan.push({
      date: k, label: MON[mo - 1] + ' ' + d, dayNumber: d, dayName: DAYS[utc(k).getUTCDay()], hijri: hijriOf(k),
      plan: {
        spend: perDay.spend, channels: TT_CH.map(c => ({ channel: c, spend: P[c].budget / dim })),
        clicks: 0, conversions: perDay.conv, value: perDay.value,
        cpa: div(perDay.spend, perDay.conv), cvr: null, aov: div(perDay.value, perDay.conv), roas: div(perDay.value, perDay.spend)
      },
      actual: live ? {
        target: perDay.spend, spend: a.spend, clicks: a.clicks, conversions: a.conversions, value: a.value,
        cpa: div(a.spend, a.conversions), cvr: div(a.conversions, a.clicks), ctr: div(a.clicks, a.impressions), roas: div(a.value, a.spend),
        spendAchievement: div(a.spend, perDay.spend), clicksAchievement: null,
        convAchievement: div(a.conversions, perDay.conv), valueAchievement: div(a.value, perDay.value)
      } : null
    });
  }

  const planSpend = TT_CH.reduce((s, c) => s + P[c].budget, 0), planValue = TT_CH.reduce((s, c) => s + P[c].value, 0);
  const roasToDate = div(month.value, month.spend), targetRoas = div(planValue, planSpend);
  const weekly = [[1, 7], [8, 14], [15, 21], [22, dim]].map(([from, to], i) => {
    const t = blank(); let days = 0;
    for (let d = from; d <= to; d++) { days++; const a = byDay[monthKey + '-' + pad(d)]; if (a) ['spend', 'impressions', 'clicks', 'conversions', 'value'].forEach(f => { t[f] += a[f]; }); }
    const ps = perDay.spend * days, pv = perDay.value * days;
    return {
      week: 'Week ' + (i + 1), sourceLabel: MON[mo - 1] + ' ' + from, days, planSpend: ps, planConversions: perDay.conv * days, planValue: pv,
      actualSpend: t.spend, actualValue: t.value, actualConversions: t.conversions, actualClicks: t.clicks,
      spendAccuracy: div(t.spend, ps), spendAchievement: div(t.spend, ps), roas: div(t.value, t.spend),
      hasActual: !!(t.spend || t.value || t.conversions || t.clicks)
    };
  });
  const channels = TT_CH.map(c => {
    const a = monthCh[c];
    return {
      channel: c, planSpend: P[c].budget, actualSpend: a.spend, spendAchievement: div(a.spend, P[c].budget),
      clicks: a.clicks, impressions: a.impressions, conversions: a.conversions, planValue: P[c].value, actualValue: a.value,
      valueAchievement: div(a.value, P[c].value), roas: div(a.value, a.spend), cpa: div(a.spend, a.conversions),
      cvr: div(a.conversions, a.clicks), ctr: div(a.clicks, a.impressions)
    };
  });
  const dayCh = byDayCh[latestKey] || {};
  const dayChannels = TT_CH.map(c => {
    const a = dayCh[c] || blank();
    return { channel: c, spend: a.spend, clicks: a.clicks, conversions: a.conversions, value: a.value, planSpend: P[c].budget / dim, roas: div(a.value, a.spend) };
  }).filter(c => c.spend || c.value).sort((a, b) => (b.roas || 0) - (a.roas || 0));
  const daily = liveDays.slice(-14).map(k => {
    const a = byDay[k];
    return {
      date: MON[mo - 1] + ' ' + (+k.slice(8, 10)), fullDate: k, targetSpend: perDay.spend, planConversions: perDay.conv, planValue: perDay.value,
      spend: a.spend, clicks: a.clicks, conversions: a.conversions, value: a.value,
      convAchievement: div(a.conversions, perDay.conv), valueAchievement: div(a.value, perDay.value), spendAchievement: div(a.spend, perDay.spend),
      roas: div(a.value, a.spend), targetRoas: div(perDay.value, perDay.spend), ctr: div(a.clicks, a.impressions)
    };
  });
  const now = new Date(Date.now() + 4 * 3600e3); // Muscat time, like the rest of the app
  const stamp = now.getUTCFullYear() + '-' + pad(now.getUTCMonth() + 1) + '-' + pad(now.getUTCDate()) + ' ' + pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes()) + ':' + pad(now.getUTCSeconds());

  // Daily → Top 3 Projects: the topics of "Topics & landing pages" (last 30 days) by CTA ROAS, $100 spend or more
  const snap = await ttSnap().catch(() => null);
  const topProjects = ((snap && snap.topics) || []).filter(t => t.spend >= 100).sort((a, b) => b.roas - a.roas).slice(0, 3)
    .map(t => ({ name: t.topic, roas: t.roas, spend: t.spend, conversions: t.conv, value: t.value }));
  return {
    refreshSeconds: 60, platform: 'tiktok', baseCur: 'USD', planFound: plan.found,
    account: TT_ACCOUNT, userEmail: '',
    source: { spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + TT_SHEET_ID + '/edit', month: tab.title, mediaPlan: planTab ? planTab.title : '' },
    latest: {
      date: latestKey, dayNumber: ld.getUTCDate(), monthName: MONTHS[mo - 1], dayName: DAYS[ld.getUTCDay()], hijriDate: hijriOf(latestKey),
      targetSpend: perDay.spend, planClicks: 0, planConversions: perDay.conv, planValue: perDay.value,
      spend: L.spend, clicks: L.clicks, conversions: L.conversions, value: L.value,
      cpa: div(L.spend, L.conversions), cvr: div(L.conversions, L.clicks), ctr: div(L.clicks, L.impressions),
      convAchievement: div(L.conversions, perDay.conv), valueAchievement: div(L.value, perDay.value), spendAchievement: div(L.spend, perDay.spend)
    },
    // Same Hijri day last year: empty until TikTok's last-year days are added.
    yoy: lyOf(latestKey, L, hist),
    month: { planSpend, planValue, actualSpend: month.spend, actualValue: month.value, actualRoas: roasToDate, spendAchievement: div(month.spend, planSpend), valueAchievement: div(month.value, planValue) },
    mtd: {
      planSpend, actualSpend: month.spend, spendAchievement: div(month.spend, planSpend), planValue, actualValue: month.value, valueAchievement: div(month.value, planValue),
      actualRoas: roasToDate, targetRoas, roasAchievement: div(roasToDate, targetRoas), budgetRemaining: planSpend - month.spend,
      budgetVariancePct: div(planSpend - month.spend, planSpend), revenueRemaining: planValue - month.value,
      conversions: month.conversions, clicks: month.clicks, impressions: month.impressions
    },
    weekly, channels, daily, dayPlan, dayChannels,
    history: Object.keys(hist.months).sort().map(mk => { const m = hist.months[mk], h = hijriNum(mk + '-15');
      return { month: mk, hijri: HIJRI_M[h.m - 1], cost: m.spend, value: m.value, conversions: m.conversions, roas: div(m.value, m.spend), partial: mk === monthKey }; }).filter(x => x.cost || x.value || x.conversions),
    bestWorst: { rankBy: 'ROAS · last 30 days' },
    topProjects, topProjectsDay: '',
    generatedAt: stamp, generatedAtMs: Date.now()
  };
}

/* ---------- TikTok's own server (exports.tiktok): https://europe-west2-human-appeal-media-plan.cloudfunctions.net/tiktok ----------
 * POST /data {token, force}: the signed-in person (the same HEMERA sign-in) gets TikTok's numbers.
 * The sheet is read at most once a minute; the last good copy is kept in memory.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { assertAccess } = require('./access');
const ORIGINS = ['https://sekna-app.web.app', 'https://sekna-app.firebaseapp.com', 'https://sekna-app.github.io'];
let held = null, pending = null;
function ttData(force) {
  if (!force && held && Date.now() - held.at < 60000) return Promise.resolve(held.v);
  if (pending) return pending;
  pending = buildTikTokData().then(v => { held = { at: Date.now(), v }; pending = null; return v; }, e => { pending = null; if (held) return held.v; throw e; });
  return pending;
}
let monthsHeld = null, monthsPending = null;
function ttMonths() {
  if (monthsHeld && Date.now() - monthsHeld.at < 5 * 60000) return Promise.resolve(monthsHeld.v);
  if (monthsPending) return monthsPending;
  monthsPending = buildTikTokMonths().then(v => { monthsHeld = { at: Date.now(), v }; monthsPending = null; return v; }, e => { monthsPending = null; if (monthsHeld) return monthsHeld.v; throw e; });
  return monthsPending;
}
let snapHeld = null, snapPending = null;
function ttSnap() {
  if (snapHeld && Date.now() - snapHeld.at < 5 * 60000) return Promise.resolve(snapHeld.v);
  if (snapPending) return snapPending;
  snapPending = buildTikTokSnap().then(v => { snapHeld = { at: Date.now(), v }; snapPending = null; return v; }, e => { snapPending = null; if (snapHeld) return snapHeld.v; throw e; });
  return snapPending;
}
let acctHeld = null, acctPending = null;
function ttAcct() {
  if (acctHeld && Date.now() - acctHeld.at < 5 * 60000) return Promise.resolve(acctHeld.v);
  if (acctPending) return acctPending;
  acctPending = buildTikTokAcct().then(v => { acctHeld = { at: Date.now(), v }; acctPending = null; return v; }, e => { acctPending = null; if (acctHeld) return acctHeld.v; throw e; });
  return acctPending;
}
const fn = onRequest({
  region: 'europe-west2', serviceAccount: 'sekna-server@human-appeal-media-plan.iam.gserviceaccount.com',
  memory: '256MiB', cpu: 1, concurrency: 20, minInstances: 0, maxInstances: 3, timeoutSeconds: 60, invoker: 'public'
}, async (req, res) => {
  const origin = req.get('origin') || '';
  if (ORIGINS.indexOf(origin) >= 0) {
    res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'POST'); res.set('Access-Control-Allow-Headers', 'Content-Type'); res.set('Access-Control-Max-Age', '3600');
  }
  res.set('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  const route = String(req.path || '/').replace(/\/+$/, '') || '/';
  if (route === '/ping') { res.json({ ok: true }); return; }
  // GET /pic?u=<TikTok picture link>: the picture through this server (only links that are in the sheet's Creatives tab)
  if (route === '/pic' && req.method === 'GET') {
    try {
      const u = String((req.query && req.query.u) || '');
      if (!/^https:\/\/[a-z0-9.-]+\.tiktokcdn(-[a-z]+)?\.com\//i.test(u)) { res.status(400).send(''); return; }
      const snap = await ttSnap().catch(() => null);
      if (!snap || !(snap.creatives || []).concat(snap.partners || []).some(c => c.pic === u)) { res.status(404).send(''); return; }
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36', Accept: 'image/avif,image/webp,image/*,*/*' } });
      if (!r.ok) { res.status(r.status === 404 ? 404 : 502).send(''); return; }
      const type = String(r.headers.get('content-type') || 'image/jpeg');
      if (!/^image\//i.test(type)) { res.status(502).send(''); return; }
      const buf = Buffer.from(await r.arrayBuffer());
      res.set('Content-Type', type); res.set('Cache-Control', 'public, max-age=86400'); res.set('Access-Control-Allow-Origin', '*');
      res.status(200).send(buf);
    } catch (e) { console.warn('TikTok picture: ' + ((e && e.message) || e)); res.status(502).send(''); }
    return;
  }
  if ((route !== '/data' && route !== '/months' && route !== '/snap' && route !== '/acct') || req.method !== 'POST') { res.status(404).json({ ok: false, error: 'Not found' }); return; }
  let body = req.body;
  if (!(body && typeof body === 'object' && !Buffer.isBuffer(body))) {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : (req.rawBody ? req.rawBody.toString('utf8') : '');
    try { body = JSON.parse(text || '{}'); } catch (e) { body = {}; }
  }
  try {
    await assertAccess(body.token);
    res.json({ ok: true, result: route === '/months' ? await ttMonths() : route === '/snap' ? await ttSnap() : route === '/acct' ? await ttAcct() : await ttData(!!body.force) });
  } catch (e) {
    res.json({ ok: false, access: !!(e && (e.access || e.blocked)), error: String((e && e.message) || e).slice(0, 300) });
  }
});

// The Hijri month of each month, named exactly as Google's sheet does (the app marks 'Ramadan' and 'Dhu Hijjah' by these names).
/* ---------- Performance Snapshots: the Creatives, Topics & landing pages and Partners tabs, read by their headers ---------- */
async function buildTikTokSnap() {
  const meta = await sheetMeta(TT_SHEET_ID);
  const find = re => meta.sheets.find(s => re.test(String(s.title).trim()));
  const tabs = [find(/^creatives$/i), find(/^topics/i), find(/^partners$/i)];
  const vals = await batchGet(TT_SHEET_ID, tabs.map(t => a1(t ? t.title : 'Creatives', 'A1:T400')));
  // The video pictures: column A of Creatives holds =IMAGE("url"), read as formulas (the link lasts about 7 days; the sheet renews it)
  let pics = [];
  if (tabs[0]) {
    try {
      const f = await request('https://sheets.googleapis.com/v4/spreadsheets/' + TT_SHEET_ID + '/values/' + encodeURIComponent(a1(tabs[0].title, 'A1:A400')) + '?valueRenderOption=FORMULA');
      pics = ((f && f.values) || []).map(r => { const m = /IMAGE\(\s*"(https:\/\/[^"]+)"/i.exec(String((r || [])[0] || '')); return m ? m[1] : ''; });
    } catch (e) { console.warn('TikTok pictures: ' + ((e && e.message) || e)); }
  }
  // Columns by their header: an exact name first, then one that starts with it (so "Conv (CTA)" is never taken for "Conv (total)")
  const table = (v, map, keepRow) => {
    const rows = v || [], head = (rows[0] || []).map(h => String(h || '').trim().toLowerCase());
    const ix = {}; Object.keys(map).forEach(k => { let i = -1;
      for (const n of map[k]) { i = head.indexOf(n); if (i >= 0) break; }
      if (i < 0) for (const n of map[k]) { i = head.findIndex(h => h.indexOf(n) === 0); if (i >= 0) break; }
      ix[k] = i; });
    return rows.slice(1).map((r, ri) => ({ r, ri: ri + 1 })).filter(x => x.r && x.r.some(c => c !== '' && c != null)).map(({ r, ri }) => {
      const o = {}; Object.keys(map).forEach(k => { const c = ix[k] >= 0 ? r[ix[k]] : ''; o[k] = c == null ? '' : c; }); if (keepRow) o._row = ri; return o;
    });
  };
  const N = v => num(v), T = v => String(v == null ? '' : v).trim();
  const creatives = tabs[0] ? table(vals[0], { name: ['creative'], topic: ['topic'], creator: ['creator'], type: ['type'], campaign: ['campaign'], adgroup: ['ad group'], spend: ['spend'], impr: ['impressions'], clicks: ['clicks'], ctr: ['ctr'], conv: ['conv (cta)', 'conv'], value: ['value (cta)', 'value'], roas: ['roas (cta)', 'roas'], share: ['share of ad group'], lp: ['landing page'], decision: ['decision'], post: ['post id'] }, true)
    .map(o => ({ name: T(o.name), topic: T(o.topic), creator: T(o.creator), type: T(o.type), campaign: T(o.campaign), adgroup: T(o.adgroup), spend: N(o.spend), impr: N(o.impr), clicks: N(o.clicks), ctr: N(o.ctr), conv: N(o.conv), value: N(o.value), roas: N(o.roas), share: o.share === '' ? null : N(o.share), lp: T(o.lp), decision: T(o.decision), post: T(o.post), pic: pics[o._row] || '' })).filter(o => o.name) : [];
  const topics = tabs[1] ? table(vals[1], { topic: ['topic'], spend: ['spend'], conv: ['conv (cta)', 'conv'], value: ['value (cta)', 'value'], roas: ['roas (cta)', 'roas'], best: ['best landing page'], bestRoas: ['its roas'], tried: ['pages tried'] })
    .map(o => ({ topic: T(o.topic), spend: N(o.spend), conv: N(o.conv), value: N(o.value), roas: N(o.roas), best: T(o.best), bestRoas: o.bestRoas === '' ? null : N(o.bestRoas), tried: N(o.tried) })).filter(o => o.topic) : [];
  // Partners: a profile picture ("Avatar" / "Profile image": =IMAGE("url") or a plain link) and "Active videos" when the sheet has them
  let avatars = [];
  if (tabs[2]) {
    const head = ((vals[2] || [])[0] || []).map(h => String(h || '').trim().toLowerCase());
    const ai = head.findIndex(h => /^(avatar|profile)/.test(h));
    if (ai >= 0) {
      const col = String.fromCharCode(65 + ai);
      try {
        const f = await request('https://sheets.googleapis.com/v4/spreadsheets/' + TT_SHEET_ID + '/values/' + encodeURIComponent(a1(tabs[2].title, col + '1:' + col + '400')) + '?valueRenderOption=FORMULA');
        avatars = ((f && f.values) || []).map(r => { const v = String((r || [])[0] || ''); const m = /IMAGE\(\s*"(https:\/\/[^"]+)"/i.exec(v) || /^(https:\/\/\S+)$/.exec(v.trim()); return m ? m[1] : ''; });
      } catch (e) { console.warn('TikTok avatars: ' + ((e && e.message) || e)); }
    }
  }
  const partners = tabs[2] ? table(vals[2], { creator: ['creator'], n: ['creatives'], spend: ['spend'], spark: ['spark spend'], repost: ['repost spend'], conv: ['conv (cta)', 'conv'], value: ['value (cta)', 'value'], roas: ['roas (cta)', 'roas'], best: ['best creative'], active: ['active videos', 'active'] }, true)
    .map(o => ({ creator: T(o.creator), n: N(o.n), spend: N(o.spend), spark: N(o.spark), repost: N(o.repost), conv: N(o.conv), value: N(o.value), roas: N(o.roas), best: T(o.best), active: o.active === '' ? null : N(o.active), pic: avatars[o._row] || '' })).filter(o => o.creator) : [];
  return { creatives, topics, partners, at: Date.now() };
}

/* ---------- Account Health: Account & policy, QA & naming (Ad Checks) and the Issues log ---------- */
async function buildTikTokAcct() {
  const meta = await sheetMeta(TT_SHEET_ID);
  const find = re => meta.sheets.find(s => re.test(String(s.title).trim()));
  const tabs = [find(/^account/i), find(/^qa/i), find(/^issues/i)];
  const vals = await batchGet(TT_SHEET_ID, tabs.map(t => a1(t ? t.title : 'Guide', 'A1:H800')), true);
  const T = v => String(v == null ? '' : v).trim();
  const rowsOf = v => (v || []).map(r => (r || []).map(T)).filter(r => r.some(c => c));
  // Account & policy: the account table, then the ads table (or one line saying none is rejected)
  const A = rowsOf(tabs[0] ? vals[0] : []), account = {}, ads = []; let note = '';
  if (A.length) {
    const h1 = A[0].map(x => x.toLowerCase()), r1 = A[1] || [];
    h1.forEach((h, i) => { if (h) account[h] = r1[i] || ''; });
    const at = A.findIndex((r, i) => i > 1 && /^ad$/i.test(r[0]));
    if (at > 0) {
      const h2 = A[at].map(x => x.toLowerCase());
      A.slice(at + 1).forEach(r => { if (r.slice(1).every(c => !c)) note = note || r[0]; else { const o = {}; h2.forEach((h, i) => { if (h) o[h] = r[i] || ''; }); ads.push(o); } });
    }
  }
  const tbl = (v, map) => { const R = rowsOf(v), head = (R[0] || []).map(h => h.toLowerCase());
    const ix = {}; Object.keys(map).forEach(k => { ix[k] = head.findIndex(h => map[k].some(n => h === n || h.indexOf(n) === 0)); });
    return R.slice(1).map(r => { const o = {}; Object.keys(map).forEach(k => { o[k] = ix[k] >= 0 ? (r[ix[k]] || '') : ''; }); return o; }); };
  const checks = tabs[1] ? tbl(vals[1], { ad: ['ad'], campaign: ['campaign'], adgroup: ['ad group'], created: ['created'], by: ['created by'], problems: ['problems'], id: ['ad id'] }).filter(o => o.ad) : [];
  const issues = tabs[2] ? tbl(vals[2], { found: ['found'], type: ['type'], ads: ['ad(s)', 'ads'], what: ['description'], by: ['created by'], owner: ['owner'], fixed: ['fixed'], fixedOn: ['fixed on'] }).filter(o => o.type || o.what) : [];
  return {
    account: { name: account.account || '', status: account.status || '', balance: num(account.balance), currency: account.currency || 'USD', opened: account.opened || '', checked: account['checked on'] || '' },
    rejected: ads, note, checks, issues, at: Date.now()
  };
}

const HIJRI_M = ['Muharram', 'Safar', 'Rabi I', 'Rabi II', 'Jumada I', 'Jumada II', 'Rajab', 'Shaban', 'Ramadan', 'Shawwal', 'Dhu Qadah', 'Dhu Hijjah'];
/** Daily → Same Hijri Day Last Year, from the month history. */
function lyOf(k, x, hist) {
  const ly = sameHijriLastYear(k), d = ly ? hist.days[ly] : null;
  const t = { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0 };
  if (d) for (let i = 0; i < d.length; i += 5) { t.spend += d[i]; t.impressions += d[i + 1]; t.clicks += d[i + 2]; t.conversions += d[i + 3]; t.value += d[i + 4]; }
  const ld = ly ? utc(ly) : null, ctr = div(t.clicks, t.impressions), xctr = div(x.clicks, x.impressions);
  return {
    mode: 'hijri', lyDate: ly, lyLabel: ld ? DAYS[ld.getUTCDay()].slice(0, 3) + ' ' + ld.getUTCDate() + ' ' + MON[ld.getUTCMonth()] + ' ' + ld.getUTCFullYear() : '',
    hasData: !!(d && (t.spend || t.value)), spend: t.spend, clicks: t.clicks, impressions: t.impressions, conversions: t.conversions, value: t.value, ctr: ctr || 0,
    convVsLy: div(x.conversions, t.conversions), valueVsLy: div(x.value, t.value), spendDelta: t.spend ? x.spend / t.spend - 1 : null, ctrDelta: ctr && xctr != null ? xctr / ctr - 1 : null
  };
}

module.exports = { buildTikTokData, buildTikTokMonths, buildTikTokSnap, buildTikTokAcct, TT_CH, TT_SHEET_ID, fn };
