// TikTok · Human Appeal US: the Daily Performance, Day by Day and Monthly Progress data, built from the
// TikTok tracker sheet (one tab per month, e.g. "Nov 2026", and the "Media plan" tab) in the same shape as
// buildDashboardData, so the Google pages draw it as they are.
// Conversions and value are the CTA ones (the media plan targets are CTA). Money is in US dollars.
const { sheetMeta, batchGet, a1, request, fsGet, fsUpdate } = require('./google');

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
const { assertAccess, assertAdmin } = require('./access');
const notify = require('./notify');
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
const TT_PEOPLE = 'server/tt-people', TT_LINKS = 'server/tt-issue-links', TT_ME = 'server/tt-me';
const sha = t => require('crypto').createHash('sha256').update(String(t)).digest('hex');
/** The person's own page: sign in with the work email (the one linked in Team accounts), a 6-digit code by email, a session for 60 days. */
// v702 Alexandra's own voice (Gemini, the same voice as in the app) for one message on the page; kept in memory
const sayCache = new Map(), viewToks = new Map();
async function meSay(b) {
  let who = '';
  if (b.vt && viewToks.has(String(b.vt))) { const v = viewToks.get(String(b.vt)); if (v.exp > Date.now()) who = v.who; }
  if (!who) { const st = (await fsGet(TT_ME).catch(() => null)) || {}, se = (st.sess || {})[sha(b.sess || '')]; if (!se || se.exp < Date.now()) return { ok: false, signedOut: true, error: 'Please sign in again.' }; who = se.who; }
  const k = String(b.k || ''), d = (await fsGet(TT_PEOPLE).catch(() => null)) || {}, map = d.map || {}, acct = await ttAcct(); await arLoad();
  const first = String((map[who] && map[who].name) || '').trim().split(/\s+/)[0] || 'there', bad = c => String(c.problems || '').trim() && !/^ok$/i.test(String(c.problems).trim());
  const L = (acct.issues || []).filter(x => String(x.by || '').toLowerCase().indexOf(who) >= 0).map(x => sayIssue(first, x)).concat((acct.checks || []).filter(c => bad(c) && String(c.by || '').toLowerCase().indexOf(who) >= 0).map(c => sayCheck(first, c)));
  const en = L.find(t => sayKey(t) === k); if (!en) return { ok: false, error: 'This message is not here any more.' };
  const ak = require('./ak'), admin = require('./access').ACCESS.ADMIN_EMAILS[1], mine = String((map[who] && map[who].email) || '');
  // no Egyptian copy yet: Alexandra writes it now (the person's own Alexandra account, or the owner's until they join the app) and it is kept
  if (!AR[k]) { const bad = e => { console.error('TikTok Egyptian text: ' + ((e && e.message) || e)); return ''; };
    let eg = ''; if (mine) eg = await ak.ttEgy(en, mine, first).catch(bad); if (!eg) eg = await ak.ttEgy(en, admin, 'TikTok page').catch(bad);
    if (/[؀-ۿ]/.test(eg)) { AR[k] = eg; await fsUpdate('server/tt-ar', d => { d = d || {}; d.map = d.map || {}; d.map[k] = eg; return d; }).catch(() => null); } }
  const text = AR[k] || en;
  if (sayCache.has(text)) return Object.assign({ text, ar: !!AR[k] }, sayCache.get(text));
  let r = await ak.tts({ text }, { email: String((map[who] && map[who].email) || admin), name: first }).catch(e => ({ ok: false, error: String(e.message || e) }));
  if (!r || !r.ok) r = await ak.tts({ text }, { email: admin, name: 'TikTok page' }).catch(e => ({ ok: false, error: String(e.message || e) }));
  if (!r || !r.ok) return { ok: false, error: 'Alexandra cannot talk right now.' };
  const out = { ok: true, mime: r.mime, data: r.data };
  if (sayCache.size > 80) sayCache.delete(sayCache.keys().next().value);
  sayCache.set(text, out); return Object.assign({ text, ar: !!AR[k] }, out);
}
async function meRoute(op, b) {
  if (op === 'say') return meSay(b);
  const email = String(b.email || '').trim().toLowerCase();
  if (op === 'code') {
    if (!/^[^@\s]+@sekna\.co\.uk$/.test(email)) throw new Error('Use your work email.');
    const doc = (await fsGet(TT_PEOPLE).catch(() => null)) || {}, who = Object.keys(doc.map || {}).find(k => String((doc.map[k] || {}).email || '').toLowerCase() === email);
    // the same answer either way, so the page does not tell who is in the team
    if (who) {
      const st = (await fsGet(TT_ME).catch(() => null)) || {}, c = (st.codes || {})[sha(email)];
      if (c && Date.now() - c.at < 45000) throw new Error('A code was just sent. Wait a few seconds and try again.');
      const code = String(require('crypto').randomInt(0, 1000000)).padStart(6, '0');
      await fsUpdate(TT_ME, d => { d = d || {}; d.codes = d.codes || {}; const now = Date.now(); Object.keys(d.codes).forEach(k => { if (d.codes[k].exp < now) delete d.codes[k]; }); d.codes[sha(email)] = { h: sha(email + '|' + code), exp: now + 10 * 60000, at: now, tries: 0, who }; return d; });
      if (notify.mailReady()) await notify.sendMail({ to: email, subject: 'Your HEMERA code: ' + code, rawHtml: codeMailHtml(code) });
    }
    return { ok: true };
  }
  if (op === 'verify') {
    const code = String(b.code || '').replace(/\D/g, ''); let out = null, bad = 'That code is not right. Check it and try again.';
    await fsUpdate(TT_ME, d => { d = d || {}; d.codes = d.codes || {}; d.sess = d.sess || {}; const k = sha(email), c = d.codes[k];
      if (!c || c.exp < Date.now()) { bad = 'The code has expired. Ask for a new one.'; return d; }
      if (c.tries >= 5) { bad = 'Too many tries. Ask for a new code.'; return d; }
      if (c.h !== sha(email + '|' + code)) { c.tries++; return d; }
      delete d.codes[k]; const tok = require('crypto').randomBytes(24).toString('base64url'), now = Date.now();
      Object.keys(d.sess).forEach(t => { if (d.sess[t].exp < now) delete d.sess[t]; });
      d.sess[sha(tok)] = { who: c.who, email, exp: now + 60 * 864e5 }; out = tok; return d; });
    if (!out) throw new Error(bad);
    return { ok: true, sess: out };
  }
  const st = (await fsGet(TT_ME).catch(() => null)) || {}, se = (st.sess || {})[sha(b.sess || '')];
  if (op === 'out') { if (se) await fsUpdate(TT_ME, d => { d = d || {}; if (d.sess) delete d.sess[sha(b.sess || '')]; return d; }); return { ok: true }; }
  if (!se || se.exp < Date.now()) return { ok: false, signedOut: true, error: 'Please sign in again.' };
  const doc = (await fsGet(TT_PEOPLE).catch(() => null)) || {};
  if (String(((doc.map || {})[se.who] || {}).email || '').toLowerCase() !== se.email) return { ok: false, signedOut: true, error: 'This email is not linked any more.' };
  if (op === 'push') {
    const token = String(b.token || ''), on = b.on !== false;
    if (on && (token.length < 20 || token.length > 4096)) throw new Error('Invalid notification token.');
    const acct = await ttAcct();
    await fsUpdate(TT_ME, d => { d = d || {}; d.push = d.push || {}; d.seen = d.seen || {}; let l = (d.push[se.who] || []).filter(t => t !== token);
      if (on) { l.push(token); d.seen[se.who] = seenOf(se.who, acct); } d.push[se.who] = l.slice(-10); if (!d.push[se.who].length) delete d.push[se.who]; return d; });
    return { ok: true, on };
  }
  // v697 how often each person opens their page (shown to admins in Team accounts)
  const st2 = (await fsUpdate(TT_ME, d => { d = d || {}; d.opens = d.opens || {}; const o = d.opens[se.who] || { n: 0 }, dy = new Date().toISOString().slice(0, 10); o.n++; o.last = Date.now(); o.days = o.days || {}; o.days[dy] = (o.days[dy] || 0) + 1; Object.keys(o.days).sort().slice(0, -90).forEach(k => delete o.days[k]); d.opens[se.who] = o; return d; }).catch(() => null)) || {};
  await arLoad();
  return { ok: true, html: personPage(se.who, await ttAcct(), doc.map || {}, true, ((st2.push || {})[se.who] || []).length > 0, await ttFeed().catch(() => null)) };
}
/** What the person has open now: issue keys and the IDs of their ads that need a fix. */
function seenOf(who, acct) {
  const W = String(who || '').toLowerCase();
  return { iss: (acct.issues || []).filter(x => !/^yes/i.test(x.fixed) && String(x.by || '').toLowerCase().indexOf(W) >= 0).map(issueKey),
    ads: (acct.checks || []).filter(c => String(c.by || '').toLowerCase().indexOf(W) >= 0 && String(c.problems || '').trim() && !/^ok$/i.test(String(c.problems).trim())).map(c => String(c.id || c.ad)) };
}
/** Once a day: a notification to each signed-up person about new issues or new ads that need a fix. */
async function dailyMail(acct, st) {
  if (!notify.mailReady()) return;
  const doc = (await fsGet(TT_PEOPLE).catch(() => null)) || {}, map = doc.map || {}, first = !st.mailed, mailedNew = {}, mlogNew = {};
  for (const who of Object.keys(map)) {
    const m = map[who]; if (who.charAt(0) === '_' || !m || !m.email) continue;
    const dg = digestOf(who, acct), keys = dg.L.map(issueKey), was = (st.mailed || {})[who] || [];
    const fresh = keys.filter(k => was.indexOf(k) < 0);
    mailedNew[who] = [...new Set(was.concat(keys))].slice(-300);
    if (first || !fresh.length) continue; // the first run only notes what is open now
    const name = nameOf(m, who) || 'there';
    try { mlogNew[who] = { at: Date.now(), n: fresh.length, by: 'auto' }; await notify.sendMail({ to: m.email, subject: 'TikTok: ' + (fresh.length === 1 ? 'a new issue' : fresh.length + ' new issues') + ' on your ads', rawHtml: digestMailHtml(name, dg.L.slice(0, 3), dg.L.length, dg.toFix, 'https://sekna-app.web.app/tiktok/me') }); }
    catch (e) { console.warn('TikTok mail: ' + ((e && e.message) || e)); delete mailedNew[who]; delete mlogNew[who]; }
  }
  await fsUpdate(TT_ME, d => { d = d || {}; d.mailed = Object.assign({}, d.mailed || {}, mailedNew); d.mlog = d.mlog || {}; Object.keys(mlogNew).forEach(w => { d.mlog[w] = (d.mlog[w] || []).concat([mlogNew[w]]).slice(-200); }); return d; });
}
async function dailyPush() {
  const st = (await fsGet(TT_ME).catch(() => null)) || {}, P = st.push || {};
  acctHeld = null; const acct = await ttAcct();
  await dailyMail(acct, st).catch(e => console.warn('TikTok mail: ' + ((e && e.message) || e)));
  if (!Object.keys(P).length) return;
  const dead = [], seenNew = {};
  for (const who of Object.keys(P)) {
    const now = seenOf(who, acct), was = (st.seen || {})[who] || { iss: [], ads: [] };
    const ni = now.iss.filter(k => was.iss.indexOf(k) < 0).length, na = now.ads.filter(k => was.ads.indexOf(k) < 0).length;
    seenNew[who] = now;
    if (!ni && !na) continue;
    const body = [ni ? ni + ' new issue' + (ni === 1 ? '' : 's') : '', na ? na + ' ad' + (na === 1 ? '' : 's') + ' to fix' : ''].filter(Boolean).join(' · ');
    for (const token of P[who]) {
      try { await notify.fcm({ token, data: { title: 'TikTok · your ads', body, url: '/tiktok/me', eventType: 'tiktok' }, webpush: { headers: { Urgency: 'high', TTL: '86400' } } }); }
      catch (e) { const s2 = e && e.response && e.response.status; if (s2 === 404 || s2 === 400) dead.push([who, token]); else console.warn('TikTok push: ' + ((e && e.message) || e)); }
    }
  }
  await fsUpdate(TT_ME, d => { d = d || {}; d.seen = Object.assign({}, d.seen || {}, seenNew); dead.forEach(([w, t]) => { if (d.push && d.push[w]) d.push[w] = d.push[w].filter(x => x !== t); }); return d; });
}
function codeMailHtml(code) {
  const F = "font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif";
  return `<!doctype html><html><body style="margin:0;background:#F4F6FB;padding:24px 12px"><table role="presentation" width="100%"><tr><td align="center"><table role="presentation" width="100%" style="max-width:460px"><tr><td style="background:#ffffff;border-radius:20px;padding:26px 24px;text-align:center">
<p style="margin:0;${F};font-size:11px;font-weight:900;letter-spacing:1.5px;color:#B0812E">HEMERA · TIKTOK</p><h1 style="margin:8px 0 6px;${F};font-size:21px;font-weight:900;color:#0F1F52">Your sign-in code</h1>
<p style="margin:0 0 18px;${F};font-size:13px;color:#6B7385">Enter it on the page to see the issues on your TikTok ads.</p>
<div style="display:inline-block;background:#203C8E;color:#fff;border-radius:14px;padding:14px 22px;${F};font-size:30px;font-weight:900;letter-spacing:8px">${code}</div>
<p style="margin:18px 0 0;${F};font-size:12px;color:#8A93A8">It works for 10 minutes. If you did not ask for it, ignore this email.</p></td></tr></table></td></tr></table></body></html>`;
}
/** The sign-in screen, in HEMERA's sign-in look. */
let gateHtml = null, akPicHeld = null;
/** The sign-in page: the app's own gate (functions/me-gate.html). */
function meGate() {
  if (!gateHtml) gateHtml = require('fs').readFileSync(require('path').join(__dirname, 'me-gate.html'), 'utf8');
  return gateHtml;
}
/** v683 the email's page: the app's look (header, account, TikTok), the person's navy card with all their open issues, and their Ad Checks. */
// v701 what Alexandra says, in English; the Egyptian Arabic copy is made once by the app (Alexandra's translate) and kept here
const sayIssue = (first, x) => `Hi ${first}. This is Alexandra. There is an issue on your TikTok ads: ${x.type || 'an issue'}. ${String(x.what || '').replace(/[_/]+/g, ' ')}. Please fix it when you can. Thank you!`;
const sayCheck = (first, c) => `Hi ${first}. This is Alexandra. One of your ads in ${String(c.campaign).replace(/^HAUS_/, '').replace(/_TikTok.*$/, '').replace(/_/g, ' ')} needs a fix. ${String(c.problems).split(';').map(p => p.trim()).filter(Boolean).join('. ')}. Please fix it when you can. Thank you!`;
const sayKey = t => require('crypto').createHash('sha1').update(String(t)).digest('hex').slice(0, 16);
let AR = {}, arAt = 0;
async function arLoad() { if (Date.now() - arAt < 5 * 60000) return AR; AR = (((await fsGet('server/tt-ar').catch(() => null)) || {}).map) || {}; arAt = Date.now(); return AR; }
/** Every message Alexandra would say to the people who have an email in Team accounts (for the app to translate). */
function sayAll(acct, map) {
  const out = [], bad = c => String(c.problems || '').trim() && !/^ok$/i.test(String(c.problems).trim());
  Object.keys(map || {}).forEach(W => { if (W.charAt(0) === '_' || !map[W] || !map[W].email) return; const first = String(map[W].name || '').trim().split(/\s+/)[0] || 'there';
    (acct.issues || []).filter(x => !/^yes/i.test(x.fixed) && String(x.by || '').toLowerCase().indexOf(W) >= 0).forEach(x => out.push(sayIssue(first, x)));
    (acct.checks || []).filter(c => bad(c) && String(c.by || '').toLowerCase().indexOf(W) >= 0).forEach(c => out.push(sayCheck(first, c))); });
  return [...new Set(out)];
}
function personPage(who, acct, map, signedIn, pushOn, feed) {
  const E = notify.esc, W = String(who || '').toLowerCase(), m = /^([^@]+)@(.+)$/.exec(W), nm = (map[W] && map[W].name) || nameOf(map[W], W) || (m ? m[1] : 'Your ads');
  const mon = k => { const x = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(k || '')); return x ? (+x[3]) + ' ' + MON[+x[2] - 1] + ' ' + x[1] + (x[4] ? ' · ' + x[4] : '') : String(k || ''); };
  const PIC = u => 'https://europe-west2-human-appeal-media-plan.cloudfunctions.net/tiktok/pic?u=' + encodeURIComponent(u);
  const iss = (acct.issues || []).filter(x => !/^yes/i.test(x.fixed) && W && String(x.by || '').toLowerCase().indexOf(W) >= 0);
  const chk = (acct.checks || []).filter(c => W && String(c.by || '').toLowerCase().indexOf(W) >= 0 && String(c.problems || '').trim() && !/^ok$/i.test(String(c.problems).trim()));
  const prob = t => /same video/i.test(t) ? ['Same video twice in a campaign', '#7B5CF0'] : /utm/i.test(t) ? ['UTM medium not Paid', '#1D9CC8'] : /videos in one ad/i.test(t) ? ['Too many videos in one ad', '#E05566'] : /ptr|spark/i.test(t) ? ['Spark post without PTR', '#2453D6'] : /name/i.test(t) ? ['Name not in the pattern', '#C99A45'] : /https|link/i.test(t) ? ['Link not https', '#B0812E'] : /country/i.test(t) ? ['Country in text ≠ page', '#C63A4A'] : [String(t).slice(0, 40), '#8A93A8'];
  const kindOf = t => /landing|link|https?/i.test(t) ? 'LANDING PAGE' : /utm|pixel|track/i.test(t) ? 'TRACKING' : /name|duplicate|videos in one/i.test(t) ? 'NAMING' : /country|text|content|caption/i.test(t) ? 'CONTENT' : 'ISSUE';
  const person = part => { let lab = '', w = part; const c = part.indexOf(': '); if (c > 0 && c < 40) { lab = part.slice(0, c); w = part.slice(c + 2); }
    const mm = /([^\s@(]+)@([a-z0-9.-]+)/i.exec(w), k = mm ? (mm[1] + '@' + mm[2]).toLowerCase() : '', n = k && map && map[k] && map[k].name;
    return { name: n || (mm ? mm[1] : /claude/i.test(w) ? 'Claude' : /older/i.test(w) ? 'Older' : w), sub: [mm ? (n ? k : '@' + mm[2]) + (/api/i.test(w) ? ' · via API' : '') : /older/i.test(w) ? 'before the change log' : /api/i.test(w) ? 'via API' : '', lab].filter(Boolean).join(' · ') }; };
  const G = new Map(); chk.forEach(c => [...new Set(String(c.problems).split(';').map(p => prob(p.trim())[0]))].forEach(k => { if (!G.has(k)) G.set(k, { col: prob(k)[1], L: [] }); const L = G.get(k).L, same = L.find(o => o.ad === c.ad && o.campaign === c.campaign);
    if (same) { if (c.id && same.ids.indexOf(String(c.id)) < 0) same.ids.push(String(c.id)); } else L.push(Object.assign({}, c, { ids: c.id ? [String(c.id)] : [] })); }));
  const mine = (acct.checks || []).filter(c => W && String(c.by || '').toLowerCase().indexOf(W) >= 0);
  const made = feed ? (feed.acts || []).filter(a => W && String(a.op || '').toLowerCase().indexOf(W) >= 0 && /^create/i.test(a.act) && /^ad$/i.test(a.obj)).length : null;
  const hero = made == null ? '' : `<div class="hr"><span class="glow"></span><small>ADS YOU MADE</small><b>${made.toLocaleString('en-US')}</b><span class="hs">ads created in the ad account</span>
    <div class="k3"><div><em class="kg">${mine.length - chk.length}</em>Pass checks</div><div><em class="ky">${chk.length}</em>Need a fix</div><div><em class="kr">${iss.length}</em>Open issues</div></div></div>`;
  // the person's own changes (newest first), the landing page folded into the creative change of the same ad
  let ah = null;
  if (feed) { const L = (feed.acts || []).filter(a => W && String(a.op || '').toLowerCase().indexOf(W) >= 0), U = {}, hasC = new Set(L.filter(a => /^creative$/i.test(a.name)).map(a => a.id));
    L.forEach(a => { if (/^destination page$/i.test(a.name)) { const m = /https?:\/\/\S+/.exec(a.det || ''); if (m && !U[a.id]) U[a.id] = m[0]; } });
    ah = L.filter(a => !(/^destination page$/i.test(a.name) && hasC.has(a.id))).slice(0, 1500).map(a => [a.d, a.tm, a.name, a.act, a.obj, a.id, a.det, a.src, /^creative$/i.test(a.name) ? (U[a.id] || '') : '']); }
  const ac = acct.account || {}, acOk = /^active$/i.test(ac.status) && !(acct.rejected || []).length;
  const apCard = `<div class="card apc"><div class="aph ${acOk ? 'g' : 'r'}"><span></span><b>${acOk ? 'Account is healthy' : !/^active$/i.test(ac.status) ? 'Account is ' + E(ac.status || 'not active') : 'Some ads need a look'}</b></div><div class="apr"><img class="apl" src="https://sekna-app.web.app/icons/ha-brand.png" alt=""><div><b>${E(ac.name || 'Human Appeal US')}</b><small>Ad account</small></div><img class="apt" src="https://sekna-app.web.app/icons/tiktok-ads.png" alt="TikTok Ads"></div>
    <div class="kv"><span>Status</span><b class="${/^active$/i.test(ac.status) ? 'g' : 'r'}">${E(ac.status || '—')}</b></div>
    <div class="kv"><span>Balance</span><b>${ac.balance != null ? '$' + Number(ac.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</b></div>
    <div class="kv"><span>Rejected ads</span><b class="${(acct.rejected || []).length ? 'r' : 'g'}">${(acct.rejected || []).length || 'None'}</b></div>
    <div class="kv"><span>Opened</span><b>${E(mon(ac.opened) || '—')}</b></div>
    <div class="kv"><span>Checked</span><b>${E(mon(ac.checked) || '—')}</b></div></div>`;
  // v699 Alexandra reads the problem out (the phone's own voice; nothing is sent anywhere)
  const first = nameOf(map[W], W) || 'there';
  const VOICE = false; // v705 Alexandra is off on this page for now (the code stays for later)
  const vn = t0 => { if (!VOICE) return ''; const ar = AR[sayKey(t0)], t = ar || t0; return `<button type="button" class="vb" data-k="${sayKey(t0)}" data-say="${E(t)}"${ar ? ' data-lang="ar"' : ''} onclick="event.stopPropagation();say(this)" aria-label="Alexandra explains"><i class="vai">AI</i><svg class="vp" viewBox="0 0 24 24"><path d="M9 6.5l9 5.5-9 5.5z"/></svg><span class="vd"><i></i><i></i><i></i></span></button>`; };
  const others = by => String(by || '').split(/\s+·\s+/).length - 1;
  const list = iss.map((x, i) => `<button type="button" class="ir" onclick="go('i${i}')"><div class="it"><b>${E(x.type || 'Issue')}</b><span class="ch">›</span></div><p>${E(x.what || '')}</p><div class="im"><span class="gold">${others(x.by) > 0 ? '+' + others(x.by) + ' more made these ads' : ''}</span><span class="dt">${E(mon(x.found))}</span></div></button>`).join('');
  const pages = iss.map((x, i) => `<section class="pg" id="i${i}" hidden><button type="button" class="bk" onclick="go('')">‹&nbsp; Issues Log</button>
    <div class="hh hv"><div><small>${kindOf(x.type)} · FOUND ${E(mon(x.found).toUpperCase())}</small><h2>${E(x.type || 'Issue')}</h2></div>${vn(sayIssue(first, x))}${iss.length > 1 ? `<div class="inv"><span class="inc"><b>${i + 1}</b>/${iss.length}</span><div class="ina"><button type="button" aria-label="Previous issue"${i ? ` onclick="slide(${i},-1)"` : ' disabled'}>‹</button><button type="button" aria-label="Next issue"${i < iss.length - 1 ? ` onclick="slide(${i},1)"` : ' disabled'}>›</button></div></div>` : ''}</div><p class="vcap" hidden></p>
    <div class="c"><div class="l">What's wrong</div><p class="w">${E(x.what || '—')}</p></div>
    ${x.ads ? `<div class="c"><div class="l">Ads affected</div>${String(x.ads).split(/\n+|,\s+(?=[A-Za-z])/).filter(Boolean).map(a => `<div class="r"><b>${E(a)}</b></div>`).join('')}</div>` : ''}
    ${x.by ? `<div class="c"><div class="l">Made by</div>${String(x.by).split(/\s+·\s+/).map(person).map(p => `<div class="p"><i>${E(String(p.name).charAt(0).toUpperCase())}</i><div><b>${E(p.name)}</b><small>${E(p.sub)}</small></div></div>`).join('')}</div>` : ''}
    ${x.made ? `<div class="c"><div class="l">Ads created · your time</div>${String(x.made).split(/\n+/).filter(Boolean).map(l => { const q = /^\s*(\d+)\s*:\s*(.+)$/.exec(l); return q ? `<div class="r mk"><div><b>${E(q[1])}</b><span data-ny="${E(q[2].trim())}">${E(q[2])}</span></div><button type="button" class="cp" onclick="cp('${E(q[1])}',this)">Copy</button></div>` : `<div class="r"><b>${E(l)}</b></div>`; }).join('')}</div>` : ''}</section>`).join('');
  let ai = 0;
  const checks = [...G.entries()].sort((a, b) => b[1].L.length - a[1].L.length).map(([k, g]) => `<details class="cg"><summary style="--c:${g.col}"><i></i><b>${E(k)}</b><em>${g.L.length}</em><span class="ar">⌄</span></summary>
    ${g.L.map(c => { const id = 'a' + (ai++); return `<div class="ca" onclick="tg('${id}')"><b class="an"><span>${E(c.ad)}</span>${c.ids.length > 1 ? `<span class="x2">×${c.ids.length}</span>` : ''}</b>${(c.pics || []).length ? `<div class="pics">${c.pics.slice(0, 5).map(u => u === 'spark' ? '<span class="sp">Spark</span>' : `<span class="pc"><img src="${E(PIC(u))}" alt="" loading="lazy"></span>`).join('')}${c.pics.length > 5 ? `<em>+${c.pics.length - 5}</em>` : ''}</div>` : ''}
      <span class="dt">${E(String(c.campaign).replace(/^HAUS_/, '').replace(/_TikTok.*$/, ''))} · ${E(mon(c.created).replace(/ · .*/, ''))}</span>
      <div class="dd" id="${id}" hidden>${VOICE ? `<div class="vrow">${vn(sayCheck(first, c))}<span>Hear it from Alexandra</span></div><p class="vcap" hidden></p>` : ''}<div class="wr">${String(c.problems).split(';').map(p => p.trim()).filter(Boolean).map(p => `<span>${E(p)}</span>`).join('')}</div>${c.by ? `<small>Created by</small><p>${E(c.by)}</p>` : ''}<small>Campaign</small><p>${E(c.campaign)}</p>${c.adgroup ? `<small>Ad group</small><p>${E(c.adgroup)}</p>` : ''}${c.ids.length ? `<small>Ad ID${c.ids.length > 1 ? 's · ' + c.ids.length + ' copies' : ''}</small>${c.ids.map(d => `<p>${E(d)} <button type="button" class="cp" onclick="event.stopPropagation();cp('${E(d)}',this)">Copy</button></p>`).join('')}` : ''}</div></div>`; }).join('<div class="sp2"><i></i></div>')}</details>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex"><meta name="theme-color" content="#132457"><link rel="manifest" href="/tiktok/me-manifest.json"><link rel="apple-touch-icon" href="/icons/icon-192.png"><link rel="icon" href="/icons/icon-192.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="HEMERA"><title>${E(nm)} · TikTok · HEMERA</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&family=DM+Serif+Display&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0}body{background:#F1F3F8;font-family:Inter,system-ui,sans-serif;color:#141B33;padding-bottom:0;min-height:100vh;display:flex;flex-direction:column}button{font:inherit;color:inherit}
.hd{position:sticky;top:0;z-index:5;padding:10px 16px;display:flex;align-items:center;gap:12px;background:linear-gradient(120deg,#132457,#203C8E 60%,#3B5BC8)}.lo{display:flex;flex-direction:column;align-items:center;gap:3px}.lo img{height:22px;display:block}.lo span{font-size:9px;font-weight:900;letter-spacing:.34em;padding-left:.34em;color:#E2B874}
.bl{position:relative;width:38px;height:38px;border-radius:12px;border:0;background:rgba(255,255,255,.13);color:#fff;display:grid;place-items:center;cursor:pointer}.bl svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.bl.on{background:#E2B874;color:#132457}.bl.on::after{content:"";position:absolute;top:7px;right:8px;width:7px;height:7px;border-radius:50%;background:#13804F;box-shadow:0 0 0 2px #E2B874}
.tst{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#141B33;color:#fff;font-size:13px;font-weight:700;padding:10px 16px;border-radius:12px;max-width:90vw;text-align:center;z-index:9}.x2{display:inline-block;font-size:10.5px;font-weight:900;color:#B0812E;background:#FBF1DE;border-radius:6px;padding:1px 6px;margin-left:4px;vertical-align:1px}
.w{max-width:560px;margin:0 auto;padding:14px 16px}.acc{display:inline-flex;align-items:center;gap:8px;background:#fff;border-radius:99px;padding:5px 14px 5px 7px;box-shadow:0 6px 16px rgba(20,40,110,.07);font-weight:800;font-size:13px}.acc img{width:22px;height:22px}.acc small{font-size:11px;color:#8A93A8;font-weight:700;margin-left:2px}.acc img.tta{width:auto;height:11px;margin-left:4px;opacity:.9}
.t{font-family:"DM Serif Display",Georgia,serif;font-size:32px;margin:18px 2px 4px}.t span{background:linear-gradient(transparent 58%,#F2D38F 0)}.sub{font-size:11px;font-weight:900;letter-spacing:.1em;color:#8A93A8;margin:0 2px 12px;text-transform:uppercase}
.card{background:#fff;border-radius:18px;box-shadow:0 10px 26px rgba(20,40,110,.08);overflow:hidden;margin-bottom:14px}
.nb{position:relative;overflow:hidden;display:flex;align-items:center;gap:14px;padding:18px;background:linear-gradient(135deg,#132457,#203C8E 55%,#2C4FB8);color:#fff}.nb .glow{position:absolute;right:-34px;top:-40px;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle,rgba(226,184,116,.42),transparent 70%)}
.av{width:56px;height:56px;border-radius:50%;background:#fff;color:#203C8E;display:grid;place-items:center;font-weight:900;font-size:24px;flex:none;box-shadow:0 6px 16px rgba(0,0,0,.25)}.nb div.n{flex:1;min-width:0}.nb b{font-size:20px}.nb small{display:block;color:#C9D3F5;font-size:12px;font-weight:700}.big{position:relative;text-align:right}.big em{display:block;font-style:normal;font-size:34px;font-weight:900;color:#E2B874;line-height:1}.big span{font-size:11px;color:#C9D3F5;font-weight:800}
.ir{display:block;width:100%;text-align:left;border:0;background:#fff;border-top:1px solid #EEF1F6;padding:14px 18px;cursor:pointer}.ir:first-of-type{border-top:0}.it{display:flex;justify-content:space-between;gap:10px}.it b{font-size:16px}.ch{color:#B0812E;font-size:22px;font-weight:900;line-height:1}
.ir p{font-size:13.5px;color:#6B7385;font-weight:600;margin-top:4px;line-height:1.45}.im{display:flex;justify-content:space-between;margin-top:10px;font-size:12.5px;font-weight:800}.gold{color:#B0812E}.dt{color:#8A93A8;font-size:12px;font-weight:700}
details summary{list-style:none;cursor:pointer}details summary::-webkit-details-marker{display:none}
.cg{border-top:1px solid #EEF1F6}.cg:first-of-type{border-top:0}.cg summary{display:flex;align-items:center;gap:10px;padding:15px 18px}.cg summary i{width:10px;height:10px;border-radius:3px;background:var(--c)}.cg summary b{flex:1;font-size:14px}.cg summary em{font-style:normal;font-weight:900;color:var(--c);font-size:16px}.ar{color:#8A93A8;font-weight:900;font-size:15px;transition:transform .2s}.cg[open] .ar{transform:rotate(180deg)}
.ca{padding:12px 18px 12px 15px;border-left:3px solid transparent;background:#F4F6FB;cursor:pointer}.cg summary+.ca{border-top:1px solid #E6EAF3}.ca.op{border-left-color:#E2B874}
.sp2{display:flex;align-items:center;gap:8px;height:18px;padding:0 18px;background:#F4F6FB}.sp2:before,.sp2:after{content:"";flex:1;height:1px;background:#DDE2EE}.sp2 i{width:5px;height:5px;border-radius:50%;background:#E2B874}
.dd p:has(.cp){display:flex;justify-content:space-between;align-items:center}.wr{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin-top:8px}.wr span{background:#FBDDE1;color:#C63A4A;font-size:12px;font-weight:800;border-radius:8px;padding:4px 10px;line-height:1.35}.ca b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ca .an{display:flex;align-items:center}.an span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis}.an .x2{flex:none}.pics{display:flex;gap:4px;align-items:center;margin:7px 0 5px}.pc{width:30px;height:40px;border-radius:7px;overflow:hidden;background:#E3E8F5;display:block}.pc img{width:100%;height:100%;object-fit:cover;display:block}.sp{display:grid;place-items:center;width:30px;height:40px;border-radius:7px;background:#E3E8F5;color:#203C8E;font-size:8px;font-weight:900}.pics em{font-style:normal;font-size:11px;font-weight:900;color:#8A93A8}
.dd{margin-top:8px}.dd small{display:block;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#8A93A8;margin-top:8px}.dd p{font-size:13px;font-weight:700;margin-top:2px;word-break:break-word}.cp{border:0;background:#E3E8F5;color:#203C8E;font-size:11px;font-weight:800;border-radius:7px;padding:3px 9px;margin-left:6px;cursor:pointer}
.hr{position:relative;overflow:hidden;border-radius:20px;padding:18px;margin-bottom:14px;color:#fff;background:linear-gradient(135deg,#132457,#203C8E 55%,#2C4FB8);box-shadow:0 12px 28px rgba(20,40,110,.18)}.hr .glow{position:absolute;right:-34px;top:-40px;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle,rgba(226,184,116,.32),transparent 70%)}
.hr small{position:relative;font-size:11px;font-weight:900;letter-spacing:.12em;color:#E2B874}.hr>b{position:relative;display:block;font-size:42px;font-weight:900;line-height:1.05;margin-top:6px}.hr .hs{position:relative;font-size:14px;font-weight:700;color:#C9D3F5}
.k3{position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.k3 div{background:rgba(255,255,255,.1);border-radius:12px;padding:9px 11px;font-size:11.5px;font-weight:700;color:#C9D3F5}.k3 em{display:block;font-style:normal;font-size:20px;font-weight:900}.k3 .kg{color:#5EE0A0}.k3 .ky{color:#E2B874}.k3 .kr{color:#FF9AA8}
.apc{padding:15px 16px}.aph{display:flex;align-items:center;gap:9px}.aph span{width:10px;height:10px;border-radius:50%}.aph b{font-size:16px}.aph.g span{background:#13804F;box-shadow:0 0 0 4px #E3F6EC}.aph.g b{color:#13804F}.aph.r span{background:#C63A4A;box-shadow:0 0 0 4px #FBDDE1}.aph.r b{color:#C63A4A}.apc small{display:block;margin:6px 0 6px 19px;font-size:12px;color:#8A93A8;font-weight:700}.kv{display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #EEF1F6;font-size:13px;font-weight:700;color:#6B7385}.kv b{color:#141B33;font-weight:900}.kv b.g{color:#13804F}.kv b.r{color:#C63A4A}html.dk .kv{border-color:#26326A}html.dk .kv b{color:#E7EBF3}
.hv{display:flex;align-items:center;gap:12px}.hv>div{flex:1;min-width:0}
.vb{position:relative;width:46px;height:46px;border-radius:50%;border:0;padding:0;flex:none;cursor:pointer;display:grid;place-items:center;background:conic-gradient(from 200deg,#5B8CFF,#A78BFA,#F3D58E,#5B8CFF);box-shadow:0 6px 16px rgba(120,100,250,.35)}
.vb:before{content:"";position:absolute;inset:2.5px;border-radius:50%;background:linear-gradient(135deg,#5B8CFF,#A78BFA);transition:opacity .25s}
.vb .vp{position:relative;z-index:1;width:18px;height:18px;fill:#fff}.vai{position:absolute;top:-4px;left:-6px;z-index:2;font:900 8px/1 Inter,system-ui,sans-serif;font-style:normal;color:#fff;background:linear-gradient(90deg,#5B8CFF,#A78BFA);border-radius:6px;padding:3px 4px;box-shadow:0 0 0 1.5px #fff}
.vd{display:none;position:relative;z-index:1;gap:3px}.vd i{width:5px;height:5px;border-radius:50%;background:#fff;animation:vdot .9s ease-in-out infinite}.vd i:nth-child(2){animation-delay:.15s}.vd i:nth-child(3){animation-delay:.3s}@keyframes vdot{50%{transform:translateY(-4px);opacity:.5}}
.vb.ld{animation:vspin 1.1s linear infinite}.vb.ld .vp,.vb.ld .vai{display:none}.vb.ld .vd{display:flex;animation:vspin 1.1s linear infinite reverse}@keyframes vspin{to{transform:rotate(360deg)}}
.vb.on{background:conic-gradient(#E2B874 calc(var(--p,0)*1%),rgba(255,255,255,.28) 0);box-shadow:0 0 0 3px rgba(226,184,116,.25),0 6px 16px rgba(0,0,0,.25)}.vb.on:before{inset:3px;background:url(https://europe-west2-human-appeal-media-plan.cloudfunctions.net/tiktok/akpic) center/cover,#203C8E}.vb.on .vp,.vb.on .vai{display:none}
.vcap{margin:-2px 0 10px;background:#fff;border-radius:12px;padding:9px 12px;font-size:12.5px;font-weight:600;color:#4b5263;line-height:1.45;box-shadow:0 6px 16px rgba(20,40,110,.07)}.vcap b{color:#141B33}html.dk .vcap{background:#16204A;color:#C9D3F5}
.vrow{display:flex;align-items:center;gap:10px;margin:10px 0 6px}.vrow .vb{width:38px;height:38px}.vrow span{font-size:12px;font-weight:800;color:#203C8E}.dd .vcap{margin:4px 0 6px;box-shadow:none}
@media (min-width:1000px){.ov{display:none!important}.hd .bl{display:none}.hd{padding:12px 24px}.drw .dh{display:none}
 body{padding-left:280px}.drw{transform:none!important;width:280px!important;max-width:280px!important;height:100vh!important;box-shadow:none}
 .w{max-width:640px;margin:0 auto;padding:22px 16px}}
.drw{position:fixed;left:0;top:0;height:100vh;height:100lvh;z-index:20;width:84%;max-width:340px;padding:16px 14px 18px;overflow-y:auto;display:flex;flex-direction:column;color:#fff;background:linear-gradient(170deg,#132457,#203C8E 60%,#2C4FB8);transform:translateX(-105%);transition:transform .28s cubic-bezier(.2,.75,.25,1)}.drw.on{transform:none}.drw>*{flex-shrink:0}
.ov{position:fixed;left:0;right:0;top:0;height:100vh;height:100lvh;z-index:19;background:rgba(10,20,50,.45);opacity:0;pointer-events:none;transition:opacity .25s}.ov.on{opacity:1;pointer-events:auto}
.dh{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.dh img{height:26px}.dx{width:38px;height:38px;border-radius:12px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.06);color:#fff;display:grid;place-items:center;cursor:pointer}.dx svg,.dni svg,.chv,.ck,.lk{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.dlb{font-size:10.5px;font-weight:900;letter-spacing:.16em;color:#B7C3EA;margin:4px 4px 8px}
.dac{background:rgba(255,255,255,.1);border-radius:16px;margin-bottom:12px;overflow:hidden}.dac1{width:100%;display:flex;align-items:center;gap:10px;border:0;background:none;padding:11px 12px;cursor:pointer;text-align:left;color:#fff}.dlg{position:relative;width:38px;height:38px;border-radius:11px;background:#fff;display:grid;place-items:center;flex:none}.dlg>img{width:26px;height:26px}.dlg i{position:absolute;right:-4px;bottom:-4px;width:17px;height:17px;border-radius:50%;background:#000;border:2px solid #203C8E;display:grid;place-items:center}.dlg i img{width:13px;height:13px;border-radius:50%}
.dat{flex:1;min-width:0}.dat b{display:block;font-size:14.5px}.dat small{font-size:11.5px;font-weight:700;color:#B7C3EA}.chv{color:#B7C3EA;transition:transform .2s}.dac1.up .chv{transform:rotate(180deg)}
.dam{border-top:1px solid rgba(255,255,255,.1);padding:4px 0}.dao{display:flex;align-items:center;gap:10px;padding:8px 12px;font-size:13.5px}.dao b{flex:1}.dao .dlg{width:30px;height:30px;border-radius:9px}.dao .dlg>img{width:20px;height:20px}.dao small{display:block;font-size:10.5px;color:#B7C3EA;font-weight:700}.ck{color:#E2B874}.dao.off{opacity:.42;filter:grayscale(1)}.lk{color:#B7C3EA}
.drw .hr{margin-bottom:12px;padding:15px;background:rgba(255,255,255,.1);box-shadow:none}.drw .hr>b{font-size:34px}.drw .hr .glow{display:none}
.dg:empty{display:none}.dg{background:rgba(255,255,255,.08);border-radius:16px;overflow:hidden;margin-bottom:12px}.dn{width:100%;display:flex;align-items:center;gap:12px;border:0;background:none;color:#fff;padding:12px 14px;font-size:14.5px;font-weight:800;cursor:pointer;text-align:left}.dn+.dn{border-top:1px solid rgba(255,255,255,.08)}.dn.on{background:rgba(255,255,255,.1);box-shadow:inset 3px 0 0 #E2B874}.dni{width:30px;height:30px;border-radius:9px;background:rgba(255,255,255,.12);display:grid;place-items:center;flex:none}.dn .tog{margin-left:auto}
.dme{margin-top:auto;display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.08);border-radius:16px;padding:10px 12px}.dav{width:38px;height:38px;border-radius:50%;background:#fff;color:#203C8E;display:grid;place-items:center;font-weight:900;flex:none}.dme>div{flex:1;min-width:0}.dme small{display:block;overflow:hidden;text-overflow:ellipsis}.dso{width:38px;height:38px;border-radius:12px;border:0;background:rgba(255,92,112,.16);color:#FF9AA8;display:grid;place-items:center;cursor:pointer;flex:none}.dso svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.dme b{display:block;font-size:14px}.dme small{font-size:11.5px;color:#B7C3EA;font-weight:700}
.tog{position:relative;width:40px;height:23px;border-radius:99px;background:rgba(138,147,168,.45);flex:none;transition:background .2s}.tog:after{content:"";position:absolute;left:3px;top:3px;width:17px;height:17px;border-radius:50%;background:#fff;transition:transform .2s}.tog.on{background:#13804F}.tog.on:after{transform:translateX(17px)}
.sts{padding:4px 0}.str{width:100%;display:flex;align-items:center;gap:12px;border:0;background:none;padding:13px 16px;cursor:pointer;text-align:left}.str+.str{border-top:1px solid #EEF1F6}.str b{flex:1;font-size:15px}.str b small{display:block;font-size:11.5px;color:#8A93A8;font-weight:700;margin-top:2px}.sti{width:34px;height:34px;border-radius:11px;background:#EEF2FB;color:#203C8E;display:grid;place-items:center;flex:none}.sti svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.sti.red{background:#FBDDE1;color:#C63A4A}b.red{color:#C63A4A}
.seg{position:relative;display:flex;flex-wrap:wrap;gap:1px;background:#E9EDF5;border-radius:10px;padding:3px;margin:0 0 8px}.seg button{position:relative;z-index:1;flex:1 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:0;background:transparent;border-radius:8px;padding:5px 8px;font:inherit;font-size:11px;font-weight:700;color:#4b5263;cursor:pointer;transition:color .25s}.seg button.on{color:#fff}.seg button svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.sgp{position:absolute;left:0;top:0;border-radius:8px;background:#203C8E;box-shadow:0 2px 6px rgba(32,60,142,.25);transition:transform .32s cubic-bezier(.2,.75,.25,1),width .32s,opacity .2s;pointer-events:none}html.dk .seg{background:#16204A}html.dk .seg button{color:#C9D3F5}
.calo{position:fixed;inset:0;z-index:30;background:rgba(10,20,50,.4);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:grid;place-items:center;padding:16px;opacity:0;transition:opacity .2s}.calo.on{opacity:1}
.calc{width:100%;max-width:400px;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 30px 60px rgba(0,0,0,.25);transform:translateY(14px) scale(.98);transition:transform .25s cubic-bezier(.2,.75,.25,1)}.calo.on .calc{transform:none}
.calh{display:flex;justify-content:space-between;align-items:center;padding:16px 18px 6px}.calh small{font-size:11px;font-weight:900;letter-spacing:.14em;color:#6B7385}.calx{width:36px;height:36px;border-radius:12px;border:1px solid #E3E7F0;background:#fff;display:grid;place-items:center;cursor:pointer}.calx svg{width:16px;height:16px;stroke:#4b5263;stroke-width:2;fill:none}
.calp{display:flex;gap:6px;padding:6px 18px;flex-wrap:wrap}.calp button{border:1.5px solid #E3E7F0;background:#fff;border-radius:99px;padding:7px 12px;font:inherit;font-size:12.5px;font-weight:800;color:#4b5263;cursor:pointer}.calp button.on{background:#203C8E;border-color:#203C8E;color:#fff}
.calm{display:flex;align-items:center;justify-content:space-between;padding:8px 18px}.calm b{font-size:16px}.calm button{width:36px;height:36px;border-radius:12px;border:1px solid #E3E7F0;background:#fff;font-size:20px;font-weight:900;color:#203C8E;cursor:pointer}.calm button[disabled]{opacity:.3}
.calw,.calg{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;padding:0 18px}.calw span{text-align:center;font-size:11px;font-weight:800;color:#8A93A8;padding:4px 0}
.calg{padding-bottom:14px}.calg button{aspect-ratio:1;border:1.5px solid #E3E7F0;background:#fff;border-radius:12px;font:inherit;font-size:14px;font-weight:800;color:#141B33;cursor:pointer}.calg button[disabled]{opacity:.35;cursor:default}.calg button.mid{background:#E8EEFF;border-color:#C9D6FF;color:#203C8E}.calg button.td{border-color:#B7C3EA}.calg button.on{background:radial-gradient(circle at 30% 20%,#5d86ff,#203c8e 70%);border-color:transparent;color:#fff;box-shadow:0 6px 14px rgba(61,107,255,.35)}
.calf{display:flex;align-items:center;gap:8px;padding:14px 18px;background:#F6F8FD;border-top:1px solid #EEF1F6}.calf div{flex:1;min-width:0}.calf b{display:block;font-size:15px}.calf small{font-size:11.5px;color:#8A93A8;font-weight:700}.calcl{border:1.5px solid #E3E7F0;background:#fff;border-radius:12px;padding:10px 14px;font:inherit;font-weight:800;color:#4b5263;cursor:pointer}.calsh{border:0;background:#203C8E;color:#fff;border-radius:12px;padding:11px 18px;font:inherit;font-weight:800;cursor:pointer}
.l,.dd small{color:#B0812E!important}.pg .t{margin-top:2px}.bk{padding-bottom:4px!important}
.fu{animation:fu .38s cubic-bezier(.2,.75,.25,1) both}@keyframes fu{from{opacity:0;transform:translateY(10px)}}
.chp{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.chp button{border:0;background:#fff;border-radius:99px;padding:7px 13px;font-size:12.5px;font-weight:800;color:#203C8E;cursor:pointer;box-shadow:0 4px 12px rgba(20,40,110,.06)}.chp button.on{background:#203C8E;color:#fff}
.tl{position:relative;padding-left:20px}.tl:before{content:"";position:absolute;left:6px;top:8px;bottom:8px;width:2px;background:linear-gradient(#E2B874,#C9D3F5)}.tday{font-size:11px;font-weight:900;letter-spacing:.08em;color:#B0812E;margin:12px 0 6px;text-transform:uppercase}.ti{position:relative}.tdot{position:absolute;left:-19px;top:15px;width:12px;height:12px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 0 0 1px #DDE2EE}.tdot.g{background:#13804F}.tdot.b{background:#203C8E}.tdot.r{background:#C63A4A}
.tc{margin-bottom:8px;padding:12px 14px}.tct{display:flex;justify-content:space-between;gap:8px}.tct b{font-size:14px}.tct small{font-size:11.5px;color:#8A93A8;font-weight:800}.ttag{display:inline-block;margin-top:5px;font-size:10.5px;font-weight:800;color:#203C8E;background:#EEF2FB;border-radius:7px;padding:2px 8px;word-break:break-all}
.ba{margin-top:7px}.ba small{display:block;font-size:9.5px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#8A93A8}.ba div{font-size:12.5px;font-weight:700;word-break:break-word}.ba s{color:#C63A4A;opacity:.75}.ba i{font-style:normal;color:#8A93A8;margin:0 5px}.ba b{color:#13804F;background:#E7F6EE;border-radius:6px;padding:1px 5px}.tdet{font-size:12.5px;color:#4b5263;margin-top:6px;word-break:break-word}.tsrc{display:inline-block;margin:7px 0 0 6px;font-size:11px;font-weight:800;color:#B0812E}
.tc{border-left:3px solid #8FA6E8}.rw{margin-top:6px}.rr{display:block;padding:7px 0;border-top:1px solid #F1F3F8}.rr:first-child{border-top:0}.rr>span{display:block;font-size:9.5px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#B0812E;margin-bottom:2px}.rr>b{display:block;font-size:12.5px;font-weight:600;color:#141B33;line-height:1.4;word-break:break-word}.rr em{font-style:normal}.rr em.r{color:#C63A4A;font-weight:700}.rr em.g{color:#13804F;font-weight:700}.rr i{font-style:normal;color:#A3AABB;margin:0 5px}.rr .pin{margin-top:0}html.dk .rr{border-color:#26326A}html.dk .rr>b{color:#E7EBF3}
.hv>.inv{flex:none;text-align:center}.inc{display:block;font-size:13px;font-weight:700;color:#C9D3F5}.inc b{font-size:20px;font-weight:800;color:#E2B874}
.so-l{animation:soL .2s ease-in forwards}.so-r{animation:soR .2s ease-in forwards}.si-r{animation:siR .32s cubic-bezier(.2,.75,.25,1) both}.si-l{animation:siL .32s cubic-bezier(.2,.75,.25,1) both}
@keyframes soL{to{transform:translateX(-60%);opacity:0}}@keyframes soR{to{transform:translateX(60%);opacity:0}}@keyframes siR{from{transform:translateX(60%);opacity:0}}@keyframes siL{from{transform:translateX(-60%);opacity:0}}.ina{display:flex;gap:6px;margin-top:6px}.ina button{width:32px;height:32px;border:0;border-radius:10px;background:rgba(255,255,255,.14);color:#fff;font-size:18px;font-weight:900;cursor:pointer}.ina button[disabled]{opacity:.3;cursor:default}
.pin{display:inline-flex;align-items:center;gap:4px;margin-top:7px;max-width:100%;font-size:11.5px;font-weight:800;color:#203C8E;background:#EEF2FB;border-radius:99px;padding:4px 10px 4px 7px;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:capitalize}.pin svg{width:14px;height:14px;flex:none;fill:#E2B874;stroke:#B0812E;stroke-width:1.6}.pin svg circle{fill:#fff}
.more{display:block;width:100%;border:0;border-radius:14px;background:#fff;color:#203C8E;font-weight:800;padding:12px;margin-top:6px;cursor:pointer}
.bl svg{fill:none}
html.dk body{background:#0B1430;color:#E7EBF3}html.dk .card,html.dk .c,html.dk .ir,html.dk .acc,html.dk .chp button,html.dk .more{background:#16204A;color:#E7EBF3}html.dk .chp button.on{background:#E2B874;color:#132457}html.dk .ca,html.dk .sp2{background:#1b2656}html.dk .ir,html.dk .cg,html.dk .str+.str,html.dk .r{border-color:#26326A}html.dk .sti,html.dk .ttag,html.dk .pin,html.dk .cp{background:#26326A;color:#DCE3F8}html.dk .bk{color:#C9D3F5}html.dk .tdot{border-color:#0B1430}html.dk .ba b{background:#173a2c;color:#5EE0A0}html.dk .tdet,html.dk .ir p{color:#B7C3EA}
.empty{padding:20px;text-align:center;font-weight:700;color:#13804F}
.bk{border:0;background:none;color:#203C8E;font-weight:800;font-size:15px;padding:6px 2px 12px;cursor:pointer}
.hh{background:linear-gradient(140deg,#203C8E,#2C4FB8);color:#fff;border-radius:18px;padding:13px 16px 14px;margin-bottom:10px;box-shadow:0 10px 26px rgba(20,40,110,.12)}.hh small{font-size:10.5px;font-weight:900;letter-spacing:.1em;color:#E2B874}.hh h2{font-size:21px;font-weight:900;margin-top:5px}
.c{background:#fff;border-radius:16px;padding:14px 16px;margin-bottom:10px;box-shadow:0 8px 22px rgba(20,40,110,.07)}.l{font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#8A93A8;margin-bottom:8px}.w2,.w{font-size:15px;font-weight:700;line-height:1.5}
.r{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid #F1F3F8;font-size:13px}.l+.r{border-top:0}.r b{word-break:break-word}.r span{color:#8A93A8;font-weight:700;font-size:12px;flex:none}
.p{display:flex;align-items:center;gap:10px;padding:7px 0}.p>div{flex:1;min-width:0}.p i{width:34px;height:34px;border-radius:50%;background:linear-gradient(140deg,#2C4FB8,#203C8E);color:#fff;font-style:normal;font-weight:900;display:grid;place-items:center;flex:none}.p b{font-size:14px}.p small{display:block;font-size:11.5px;color:#8A93A8;font-weight:700}
.gl{height:3px;margin:26px auto 14px;max-width:220px;background:linear-gradient(90deg,transparent,#E2B874,transparent);border-radius:99px}.ft{text-align:center;font-size:11.5px;color:#8A93A8;font-weight:700}.ft a{color:#B0812E;text-decoration:none;font-weight:800}
html{background:#132457}.w{flex:1 0 auto;width:100%}.pg .w{padding:0}.r.mk{align-items:center}.r.mk>div{min-width:0}.r.mk>div span{display:block;margin-top:2px}.ba .r,.ba s.r{color:#C63A4A}.ba s.g{color:#13804F}.ba b.r{color:#C63A4A;background:#FBE4E7}
.fb{margin-top:30px;position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px;color:#fff;padding:9px 16px calc(9px + env(safe-area-inset-bottom));background:linear-gradient(120deg,#132457,#203C8E 60%,#3B5BC8)}.fb:before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,transparent,#E2B874 20%,#F2D38F 50%,#E2B874 80%,transparent)}
.fb p{font-size:11.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.fb p span{color:#B7C3EA;font-weight:700}.fb a{flex:none;font-size:10.5px;color:#E2B874;font-weight:800;text-decoration:none;border:1px solid rgba(226,184,116,.6);border-radius:99px;padding:4px 10px;white-space:nowrap}
/* v711 slimmer: everything a size smaller, the menu narrower */
.fb{all:unset;display:block;text-align:center;padding:22px 16px calc(26px + env(safe-area-inset-bottom))!important;margin-top:26px}.fb:before{display:none!important}
.fb[hidden]{display:none!important}.fbt{font-size:10px!important;font-weight:900;letter-spacing:.18em;color:#A3AABB!important;white-space:normal!important}.fbl{display:inline-flex!important;align-items:center;gap:6px;margin-top:9px;font-size:12.5px!important;font-weight:800;color:#B0812E!important;text-decoration:none;border:0!important;padding:5px 12px 5px 5px!important;border-radius:99px!important;background:rgba(226,184,116,.12)}.fbl img{width:20px;height:20px;border-radius:6px}.fbl span{font-size:15px;line-height:1}
.dd.pop{animation:pop .3s cubic-bezier(.2,.9,.3,1.25) both;transform-origin:top center}@keyframes pop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}

.t.pg-in{animation:pgIn .45s cubic-bezier(.2,.8,.2,1) both}.t.pg-in span{animation:pgMark .6s .15s cubic-bezier(.2,.8,.2,1) both;background-size:100% 100%;background-repeat:no-repeat}
@keyframes pgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@keyframes pgMark{from{background-size:0% 100%}to{background-size:100% 100%}}
.apr{display:flex;align-items:center;gap:8px;background:#F6F8FD;border-radius:10px;padding:6px 9px;margin:8px 0 6px}.apl{width:24px;height:24px;border-radius:7px;background:#fff;padding:2px;box-shadow:0 1px 3px rgba(20,40,110,.12)}.apr div{flex:1;min-width:0}.apr b{display:block;font-size:12.5px}.apr small{display:block!important;margin:0!important;font-size:10px!important}.apt{height:10px;width:auto}html.dk .apr{background:#1b2656}

.hd{padding:8px 14px}.lo img{height:18px}.lo span{font-size:8px}.bl{width:34px;height:34px;border-radius:11px}
.w{padding:12px 14px}.t{font-size:26px!important;margin-top:12px}.sub{font-size:10px;margin-bottom:10px}.acc{font-size:12px;padding:4px 12px 4px 6px}.acc img{width:20px;height:20px}
.card{border-radius:16px}.nb{padding:14px;gap:12px}.av{width:46px;height:46px;font-size:20px}.nb b{font-size:17px}.nb small{font-size:11px}.big em{font-size:28px}.big span{font-size:10px}
.ir{padding:12px 16px}.it b{font-size:14.5px}.ir p{font-size:12.5px}.im{font-size:11.5px;margin-top:8px}.dt{font-size:11px}
.cg summary{padding:12px 16px}.cg summary b{font-size:13px}.ca{padding:10px 16px 10px 13px}.ca b{font-size:12.5px}
.hh{padding:11px 14px 12px;border-radius:16px}.hh small{font-size:9.5px}.hh h2{font-size:18px}.c{padding:12px 14px;border-radius:14px}.w2,.c .w{font-size:13.5px}.r{font-size:12.5px}.p b{font-size:13px}.p i{width:30px;height:30px}
.hr{padding:15px;border-radius:18px}.hr>b{font-size:34px}.hr .hs{font-size:12.5px}.k3 div{padding:8px 10px;font-size:10.5px}.k3 em{font-size:17px}
.tc{padding:10px 12px}.tct b{font-size:13px}.rr>b{font-size:12px}
.drw{max-width:290px;padding:12px 12px 14px}.dlb{font-size:9.5px;margin-bottom:6px}.dac1{padding:9px 10px}.dlg{width:32px;height:32px}.dlg>img{width:22px;height:22px}.dat b{font-size:13px}.dat small{font-size:10.5px}
.dn{padding:9px 12px;font-size:13px;gap:10px}.dni{width:26px;height:26px;border-radius:8px}.dx svg,.dni svg{width:15px;height:15px}.dme{padding:8px 10px}.dav{width:32px;height:32px;font-size:14px}.dme b{font-size:13px}.dme small{font-size:10.5px}.dso{width:32px;height:32px}
@media (min-width:1000px){body{padding-left:240px}.drw{width:240px!important;max-width:240px!important}.w{max-width:600px}}
/* Team Board effect on every filter: the blue pill with its glow glides under the picked one */
.sgp{background:radial-gradient(circle at 30% 20%,#5d86ff,#203c8e 70%)!important;box-shadow:0 4px 12px rgba(61,107,255,.38)!important}
.calp{position:relative;display:flex;gap:1px;flex-wrap:nowrap;background:#E9EDF5;border-radius:10px;padding:3px;margin:6px 18px}.calp button{position:relative;z-index:1;flex:1;border:0!important;background:transparent!important;border-radius:8px;padding:6px 6px;font-size:11.5px;font-weight:700;color:#4b5263;transition:color .25s}.calp button.on{color:#fff!important}
.calg button.on{background:radial-gradient(circle at 30% 20%,#5d86ff,#203c8e 70%);box-shadow:0 4px 12px rgba(61,107,255,.38)}.calg button{transition:transform .15s}.calg button:active{transform:scale(.94)}
</style></head>
<body><div class="hd"><button type="button" class="bl" onclick="dr(1)" aria-label="Menu"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button><div class="lo"><img src="https://sekna-app.web.app/get/logo-white.webp" alt=""><span>HEMERA</span></div>${signedIn ? `<span id="bell" class="${pushOn ? 'on' : ''}" hidden></span>` : ''}</div>
<div class="w"><div id="home" class="fu"><span class="acc"><img src="https://sekna-app.web.app/icons/ha-brand.png" alt="">Human Appeal US<img class="tta" src="https://sekna-app.web.app/icons/tiktok-ads.png" alt="TikTok Ads"></span>
<div class="t">Issues <span>Log</span></div><div class="sub">${iss.length} open · active ads only · tap one</div>
<div class="card"><div class="nb"><span class="glow"></span><span class="av">${E(String(nm).charAt(0).toUpperCase())}</span><div class="n"><b>${E(nm)}</b><small>${E(W)}</small></div><div class="big"><em>${iss.length}</em><span>open issue${iss.length === 1 ? '' : 's'}</span></div></div>${list || '<div class="empty">No open issue. Thank you!</div>'}</div>
<div class="t">Ad <span>Checks</span></div><div class="sub">${chk.length} of your live ads need a fix · tap a problem</div>
<div class="card">${checks || '<div class="empty">Every live ad you made passes.</div>'}</div></div>
${pages}
<section class="pg" id="ah" hidden><button type="button" class="bk" onclick="go('')">‹&nbsp; Issues Log</button><div class="t">Activity <span>History</span></div><div id="ahb"></div></section>
<section class="pg" id="ap" hidden><button type="button" class="bk" onclick="go('')">‹&nbsp; Issues Log</button><div class="t">Account <span>&amp; Policy</span></div>${apCard}</section>

</div><footer class="fb" id="fb"><p class="fbt">HEMERA · ISSUES &amp; AD CHECKS · HUMAN APPEAL</p><a class="fbl" href="https://sekna-app.web.app/get/" target="_blank" rel="noopener"><img src="https://sekna-app.web.app/icons/icon-192.png" alt="">Get the HEMERA app<span>›</span></a></footer>
<div class="ov" id="ov" onclick="dr(0)"></div><aside class="drw" id="drw" aria-label="Menu">
 <div class="dh"><img src="https://sekna-app.web.app/get/logo-white.webp" alt="HEMERA"><button type="button" class="dx" onclick="dr(0)" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
 <div class="dlb">CLIENT ACCOUNT</div>
 <div class="dac"><button type="button" class="dac1" onclick="var m=document.getElementById('dam');m.hidden=!m.hidden;this.classList.toggle('up',!m.hidden)"><span class="dlg"><img src="https://sekna-app.web.app/icons/ha-brand.png" alt=""><i><img src="https://sekna-app.web.app/icons/alexandra/logo-tiktok.png?v=3" alt=""></i></span><span class="dat"><b>Human Appeal US</b><small>TikTok Ads</small></span><svg class="chv" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
  <div class="dam" id="dam" hidden><div class="dao"><span class="dlg"><img src="https://sekna-app.web.app/icons/ha-brand.png" alt=""></span><b>Human Appeal US</b><svg class="ck" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
   <div class="dao off"><span class="dlg"><img src="https://sekna-app.web.app/icons/ha-brand.png" alt=""></span><b>Human Appeal AR<small>Soon</small></b><svg class="lk" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div></div></div>
 <div class="dg"><button type="button" class="dn on" data-v="" onclick="go('')"><span class="dni"><svg viewBox="0 0 24 24"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg></span>Issues &amp; Ad Checks</button>
  <button type="button" class="dn" data-v="ah" onclick="go('ah')"><span class="dni"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg></span>Activity History</button>
  <button type="button" class="dn" data-v="ap" onclick="go('ap')"><span class="dni"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M8.5 12l2.5 2.5 4.5-4.5"/></svg></span>Account &amp; Policy</button></div>
 <div class="dg">${signedIn ? `<button type="button" class="dn" onclick="bell()"><span class="dni"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></span>Notifications<span class="tog${pushOn ? ' on' : ''}" data-n></span></button>` : ''}</div>
 <div class="dme"><span class="dav">${E(String(nm).charAt(0).toUpperCase())}</span><div><b>${E(nm)}</b><small>${E(W)}</small></div>${signedIn ? `<button type="button" class="dso" onclick="out()" aria-label="Sign out" title="Sign out"><svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/></svg></button>` : ''}</div>
</aside>
<script>var AH=${JSON.stringify(ah).replace(/</g, '\\u003c')};
function dr(o){if(innerWidth>=1000)o=0;document.getElementById('drw').classList.toggle('on',!!o);document.getElementById('ov').classList.toggle('on',!!o)}
function dk(v){var on=v==null?!document.documentElement.classList.contains('dk'):v;document.documentElement.classList.toggle('dk',on);var t=document.getElementById('dkt');if(t)t.classList.toggle('on',on);if(v==null)try{localStorage.setItem('tt_me_dk',on?'1':'')}catch(e){}}
try{dk(localStorage.getItem('tt_me_dk')==='1')}catch(e){}
// v707 the issues slide left and right (the Slide animation)
var SLB=0;function slide(i,d){if(SLB&&Date.now()-SLB<900)return;var a=document.getElementById('i'+i),b=document.getElementById('i'+(i+d));if(!a||!b)return;SLB=1;SLB=Date.now();a.classList.add(d>0?'so-l':'so-r');
 setTimeout(function(){a.classList.remove('so-l','so-r');try{go('i'+(i+d),1)}catch(e){}b.classList.remove('si-r','si-l','fu');void b.offsetWidth;b.classList.add(d>0?'si-r':'si-l');setTimeout(function(){b.classList.remove('si-r','si-l');SLB=0},340)},200)}
function fu(el){if(!el)return;el.classList.remove('fu');void el.offsetWidth;el.classList.add('fu');el.querySelectorAll('.t').forEach(function(t){t.classList.remove('pg-in');void t.offsetWidth;t.classList.add('pg-in')})}
addEventListener('DOMContentLoaded',function(){fu(document.getElementById('home'))});
function go(id,ns){setTimeout(function(){if(!ns)fu(id?document.getElementById(id):document.getElementById('home'));segPos()},0);dr(0);document.getElementById('fb').hidden=!!id;document.querySelectorAll('.dn[data-v]').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-v')===(id||''))});if(id==='ah')ahDraw();document.getElementById('home').hidden=!!id;document.querySelectorAll('.pg').forEach(function(p){p.hidden=p.id!==id});try{if(id)history.pushState({p:id},'','#'+id);else if(location.hash)history.pushState({},'',location.pathname)}catch(e){}scrollTo(0,0)}
addEventListener('popstate',function(){var id=location.hash.slice(1);document.getElementById('fb').hidden=!!id;if(id==='ah')ahDraw();document.getElementById('home').hidden=!!id;document.querySelectorAll('.pg').forEach(function(p){p.hidden=p.id!==id})});
function tg(id){var d=document.getElementById(id);if(d){d.hidden=!d.hidden;d.parentNode.classList.toggle('op',!d.hidden);d.classList.remove('pop');if(!d.hidden){void d.offsetWidth;d.classList.add('pop')}}}
function out(){var s='';try{s=localStorage.getItem('tt_me')||'';localStorage.removeItem('tt_me')}catch(e){}fetch('/tiktok/me/out',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({sess:s})}).finally(function(){location.href='/tiktok/me'})}
function nt(o){document.querySelectorAll('[data-n]').forEach(function(x){x.classList.toggle('on',o)})}
var MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],AF={r:'all',f:'',n:100};
function es(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function nyOff(u){try{var p={};new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(u)).forEach(function(x){p[x.type]=x.value});return Date.UTC(+p.year,p.month-1,+p.day,+p.hour%24,+p.minute)-u}catch(e){return -18e6}}
function loc(d,tm){var a=String(d||'').split('-'),t=String(tm||'').split(':');if(a.length<3||t.length<2)return {d:d,tm:tm};var u=Date.UTC(+a[0],a[1]-1,+a[2],+t[0],+t[1]),x=new Date(u-nyOff(u)),P=function(n){return (n<10?'0':'')+n};var hh=x.getHours();return {d:x.getFullYear()+'-'+P(x.getMonth()+1)+'-'+P(x.getDate()),tm:((hh%12)||12)+':'+P(x.getMinutes())+(hh<12?' AM':' PM')}}
function day(d){var a=String(d||'').split('-');return a.length<3?d:(+a[2])+' '+MO[a[1]-1]+' '+a[0]}
function dm(d){return day(d).split(' ').slice(0,2).join(' ')}
function tdy(){return new Date(Date.now()-18e6).toISOString().slice(0,10)}
function add(k,n){var d=new Date(k+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function inR(d){var t=tdy();return AF.r==='7'?(d>=add(t,-7)&&d<=t):AF.r==='30'?(d>=add(t,-30)&&d<=t):AF.r==='y'?d===add(t,-1):AF.r==='day'?d===AF.day:AF.r==='rng'?(d>=AF.from&&d<=AF.to):true}
function fld(n){n=String(n||'').toLowerCase();return /status|on.off/.test(n)?'Status':/budget|bid|cost/.test(n)?'Budget':/creative|video|text|identity|spark/.test(n)?'Creative':/url|destination|deeplink|page/.test(n)?'Landing':/review/.test(n)?'Review':(n==='ad'||/name/.test(n))?'Ad':'Other'}
function chg(det){return String(det||'').split(' | ').map(function(p){var i=p.indexOf(': '),j=p.indexOf(' -> ');if(i<1||j<i)return null;return {f:p.slice(0,i).trim(),b:p.slice(i+2,j).trim().slice(0,90),a:p.slice(j+4).trim().slice(0,90)}}).filter(Boolean)}
function tone(v,d){v=String(v||'').toLowerCase();return /^(enabled?|active|on|approved|delivering|running|live)\b/.test(v)?'g':/^(paused|disabled|off|rejected|deleted|not delivering|suspended|inactive|in review|under review)\b/.test(v)?'r':d}
function ahR(r){AF.r=r;AF.n=100;ahDraw()}function ahF(f){AF.f=AF.f===f?'':f;AF.n=100;ahDraw()}function ahM(){AF.n+=100;ahDraw()}
function pin(u){var l='Landing page';try{var x=new URL(u);l=(x.pathname.replace(/[/]$/,'').split('/').pop()||x.hostname).replace(/[-_]+/g,' ')}catch(e){}return '<a class="pin" href="'+es(u)+'" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>'+es(l)+'</a>'}
function ahDraw(){var h=document.getElementById('ahb');if(!h)return;segKeep();if(!AH){h.innerHTML='<div class="card"><div class="empty" style="color:#8A93A8">Activity could not load. Pull to refresh.</div></div>';return}
 var A=AH.filter(function(a){return inR(a[0])}),c=0,ch=0,dl=0;A.forEach(function(a){if(/^create/i.test(a[3]))c++;else if(/^delete/i.test(a[3]))dl++;else ch++});
 var F=[];A.forEach(function(a){var f=fld(a[2]);if(f!=='Landing'&&f!=='Ad'&&F.indexOf(f)<0)F.push(f)});if(AF.f&&F.indexOf(AF.f)<0)AF.f='';
 var L=A.filter(function(a){return !AF.f||fld(a[2])===AF.f}),last='',rk=AF.r==='30'?'7':AF.r,b=function(k,l){return '<button type="button" class="'+(rk===k?'on':'')+'" onclick="ahR(\\''+k+'\\')">'+l+'</button>'};
 h.innerHTML='<div class="hr"><span class="glow"></span><small>'+(AF.r==='rng'?(dm(AF.from)+' – '+day(AF.to)).toUpperCase():AF.r==='day'?day(AF.day).toUpperCase():({all:'ALL CHANGES','7':'LAST 7 DAYS','30':'LAST 30 DAYS',y:'YESTERDAY'})[AF.r])+'</small><b>'+A.length.toLocaleString('en-US')+'</b><span class="hs">change'+(A.length===1?'':'s')+' you made</span><div class="k3"><div><em class="kg">'+c+'</em>Created</div><div><em>'+ch+'</em>Changed</div><div><em class="kr">'+dl+'</em>Deleted</div></div></div>'
  +'<div class="seg"><i class="sgp"></i>'+b('all','All')+b('7',AF.r==='30'?'Last 30 days':'Last 7 days')+b('y','Yesterday')+'<button type="button" class="'+(AF.r==='day'||AF.r==='rng'?'on':'')+'" onclick="calOpen()"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>'+(AF.r==='rng'?dm(AF.from)+' – '+dm(AF.to):AF.r==='day'?dm(AF.day):'Pick a day')+'</button></div>'
  +(F.length>1?'<div class="seg sg2"><i class="sgp"></i>'+F.map(function(f){return '<button type="button" class="'+(AF.f===f?'on':'')+'" onclick="ahF(\\''+f+'\\')">'+f+'</button>'}).join('')+'</div>':'')
  +(L.length?'<div class="tl">'+L.slice(0,AF.n).map(function(a){var l=loc(a[0],a[1]),k=/^create/i.test(a[3])?'g':/^delete/i.test(a[3])?'r':'b',hd=l.d!==last?(last=l.d,'<div class="tday">'+day(l.d)+'</div>'):'',cs=chg(a[6]).slice(0,3);
   return hd+'<div class="ti"><span class="tdot '+k+'"></span><div class="c tc"><div class="tct"><b>'+es(a[2])+'</b><small>'+es(l.tm)+'</small></div><span class="ttag">'+es(a[3])+' · '+es(a[4])+(a[5]?' · '+es(a[5]):'')+'</span>'
    +'<div class="rw">'+(cs.length?cs.map(function(x){var ta=tone(x.a,''),tb=tone(x.b,'');return '<div class="rr"><span>'+es(x.f||a[2])+'</span><b>'+(x.b?'<em class="'+tb+'">'+es(x.b)+'</em><i>→</i>':'')+'<em class="'+ta+'">'+es(x.a||'—')+'</em></b></div>'}).join(''):(a[6]&&a[6]!==a[2]?'<div class="rr"><span>Detail</span><b>'+es(a[6])+'</b></div>':''))
    +(a[8]?'<div class="rr"><span>Page</span><b>'+pin(a[8])+'</b></div>':'')+'</div>'+(a[7]&&a[7]!=='--'?'<small class="tsrc">'+es(a[7])+'</small>':'')+'</div></div>'}).join('')+'</div>'+(L.length>AF.n?'<button type="button" class="more" onclick="ahM()">Show more ('+(L.length-AF.n)+')</button>':''):'<div class="card"><div class="empty" style="color:#8A93A8">No change on these days.</div></div>')
  +'<p class="ft" style="margin-top:12px">Times in your local time</p>';segPos()}
// the blue pill glides under the picked filter (as on the Team Board)
var SEGW=[];function segKeep(){SEGW=[].map.call(document.querySelectorAll('.seg .sgp'),function(p){return [p.style.transform,p.style.width,p.style.height,p.style.opacity]})}
function segPos(){var P=document.querySelectorAll('.seg .sgp');if(SEGW.length){P.forEach(function(p,i){var w=SEGW[i];if(!w)return;p.style.transition='none';p.style.transform=w[0];p.style.width=w[1];p.style.height=w[2];p.style.opacity=w[3];void p.offsetWidth;p.style.transition=''});SEGW=[]}
 document.querySelectorAll('.seg').forEach(function(g){var p=g.querySelector('.sgp'),o=g.querySelector('button.on');if(!p)return;if(!o){p.style.opacity=0;return}p.style.opacity=1;p.style.width=o.offsetWidth+'px';p.style.height=o.offsetHeight+'px';p.style.transform='translate('+o.offsetLeft+'px,'+o.offsetTop+'px)'})}
addEventListener('resize',segPos);if(document.fonts&&document.fonts.ready)document.fonts.ready.then(segPos);
// Pick a day: the app's Report Period calendar (days only)
var CAL={m:'',sel:'',end:''};
function calOpen(){CAL.sel=AF.r==='day'?AF.day:AF.r==='rng'?AF.from:'';CAL.end=AF.r==='rng'?AF.to:'';CAL.pre=AF.r!=='day'&&AF.r!=='all'?AF.r:'';CAL.m=(CAL.sel||tdy()).slice(0,7);var o=document.getElementById('cal');if(!o){o=document.createElement('div');o.id='cal';o.className='calo';o.onclick=function(e){if(e.target===o)calClose()};document.body.appendChild(o)}calDraw();requestAnimationFrame(function(){o.classList.add('on')})}
function calClose(){var o=document.getElementById('cal');if(o){o.classList.remove('on');setTimeout(function(){o.remove()},220)}}
function calNav(n){var a=CAL.m.split('-'),d=new Date(Date.UTC(+a[0],a[1]-1+n,1));CAL.m=d.toISOString().slice(0,7);calDraw()}
function calPick(d){if(!CAL.sel||CAL.end||d<CAL.sel){CAL.sel=d;CAL.end=''}else if(d>CAL.sel)CAL.end=d;else CAL.end='';CAL.pre='';calDraw()}function calPre(r){CAL.pre=r;CAL.sel='';calDraw()}
function calDraw(){var o=document.getElementById('cal');if(!o)return;segKeep();var a=CAL.m.split('-'),y=+a[0],mo=+a[1],first=new Date(Date.UTC(y,mo-1,1)),days=new Date(Date.UTC(y,mo,0)).getUTCDate(),lead=(first.getUTCDay()+6)%7,t=tdy(),min=(AH&&AH.length?AH[AH.length-1][0]:t),cells='',P=function(n){return (n<10?'0':'')+n};
 for(var i=0;i<lead;i++)cells+='<span></span>';
 for(var d=1;d<=days;d++){var k=y+'-'+P(mo)+'-'+P(d),off=k>t||k<min;cells+='<button type="button" class="'+(k===CAL.sel||k===CAL.end?'on':CAL.sel&&CAL.end&&k>CAL.sel&&k<CAL.end?'mid':'')+(k===t?' td':'')+'"'+(off?' disabled':' onclick="calPick(\\''+k+'\\')"')+'>'+d+'</button>'}
 var nd=CAL.sel&&CAL.end?Math.round((Date.parse(CAL.end)-Date.parse(CAL.sel))/864e5)+1:0,lab=nd?dm(CAL.sel)+' – '+day(CAL.end):CAL.sel?day(CAL.sel):CAL.pre==='y'?'Yesterday':CAL.pre==='7'?'Last 7 days':CAL.pre==='30'?'Last 30 days':'Pick a day',pb=function(r,l){return '<button type="button" class="'+(CAL.pre===r?'on':'')+'" onclick="calPre(\\''+r+'\\')">'+l+'</button>'};
 o.innerHTML='<div class="calc"><div class="calh"><small>PICK DAYS</small><button type="button" class="calx" onclick="calClose()" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>'
  +'<div class="calp seg"><i class="sgp"></i>'+pb('y','Yesterday')+pb('7','Last 7 days')+pb('30','Last 30 days')+'</div>'
  +'<div class="calm"><button type="button" onclick="calNav(-1)"'+(CAL.m<=min.slice(0,7)?' disabled':'')+'>‹</button><b>'+['January','February','March','April','May','June','July','August','September','October','November','December'][mo-1]+' '+y+'</b><button type="button" onclick="calNav(1)"'+(CAL.m>=t.slice(0,7)?' disabled':'')+'>›</button></div>'
  +'<div class="calw"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div class="calg">'+cells+'</div>'
  +'<div class="calf"><div><b>'+lab+'</b><small>'+(nd?nd+' days':CAL.sel?'one day · tap another day for a range':CAL.pre?'until today':'tap a day')+'</small></div><button type="button" class="calcl" onclick="calPre(\\'\\');CAL.sel=\\'\\';CAL.end=\\'\\';calDraw()">Clear</button><button type="button" class="calsh" onclick="calShow()">Show</button></div></div>';segPos()}
function calShow(){if(CAL.sel&&CAL.end){AF.r='rng';AF.from=CAL.sel;AF.to=CAL.end}else if(CAL.sel){AF.r='day';AF.day=CAL.sel}else if(CAL.pre){AF.r=CAL.pre}else AF.r='all';AF.n=100;calClose();ahDraw()}
document.querySelectorAll('[data-ny]').forEach(function(e){var v=e.getAttribute('data-ny'),l=loc(v.slice(0,10),v.slice(11,16));if(l.tm&&l.d)e.textContent=day(l.d)+' · '+l.tm});
if(location.hash==='#ah'||location.hash==='#ap'){var h0=location.hash.slice(1);document.getElementById('fb').hidden=true;document.getElementById('home').hidden=true;document.getElementById(h0).hidden=false;if(h0==='ah')ahDraw()}
var SAY=null,SAYT=null;
function sayStop(){try{if(AU)AU.pause()}catch(e){}clearInterval(SAYT);document.querySelectorAll('.vb.on,.vb.ld').forEach(function(x){x.classList.remove('on','ld');x.style.removeProperty('--p')});document.querySelectorAll('.vcap').forEach(function(c){c.hidden=true});SAY=null}
var VT=window.VT||'',AU=null,VC={};
function wav(b64,mime){var bin=atob(b64),n=bin.length,pcm=new Uint8Array(n);for(var i=0;i<n;i++)pcm[i]=bin.charCodeAt(i);if(/wav|mpeg|mp3|ogg/i.test(mime))return new Blob([pcm],{type:mime});
 var rate=+((/rate=(\d+)/.exec(mime)||[])[1]||24000),h=new ArrayBuffer(44),v=new DataView(h),w=function(o,s){for(var k=0;k<s.length;k++)v.setUint8(o+k,s.charCodeAt(k))};
 w(0,'RIFF');v.setUint32(4,36+n,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n,true);
 return new Blob([h,pcm],{type:'audio/wav'})}
function say(b){var was=SAY===b;sayStop();if(AU){try{AU.pause()}catch(e){}AU=null}if(was)return;SAY=b;
 var t=b.getAttribute('data-say'),ar=b.getAttribute('data-lang')==='ar',k=b.getAttribute('data-k'),cap=b.closest('.hv')?b.closest('.hv').nextElementSibling:b.closest('.vrow')?b.closest('.vrow').nextElementSibling:null,t0=Date.now();
 b.classList.add('ld');
 var a=new Audio();a.preload='auto';AU=a;try{a.play().catch(function(){})}catch(e){}
 function show(){if(SAY!==b)return;b.classList.remove('ld');b.classList.add('on');if(cap&&cap.classList.contains('vcap')){cap.dir=ar?'rtl':'ltr';var q=ar?t.search(/[.،!]\s/):t.indexOf('. ');cap.innerHTML='<b>'+es(t.slice(0,q>0?q+1:0))+'</b> '+es(t.slice(q>0?q+2:0));cap.hidden=false}
  SAYT=setInterval(function(){if(SAY!==b||!a.duration)return;b.style.setProperty('--p',Math.min(100,a.currentTime/a.duration*100))},100)}
 function play(url){if(SAY!==b)return;a.src=url;a.onended=function(){if(SAY!==b)return;b.style.setProperty('--p',100);setTimeout(function(){if(SAY===b)sayStop()},450)};a.onerror=function(){if(SAY===b){sayStop();toast('Could not play her voice.')}};
  setTimeout(function(){if(SAY!==b)return;a.play().then(show).catch(function(){sayStop();toast('Tap again to hear her.')})},Math.max(0,700-(Date.now()-t0)))}
 if(VC[k]){play(VC[k]);return}
 var s0='';try{s0=localStorage.getItem('tt_me')||''}catch(e){}
 fetch('/tiktok/me/say',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({sess:s0,vt:VT,k:k})}).then(function(r){return r.json()}).then(function(j){if(!j||!j.ok)throw new Error((j&&j.error)||'Alexandra cannot talk right now.');if(j.text){t=j.text;ar=!!j.ar;b.setAttribute('data-say',t);if(ar)b.setAttribute('data-lang','ar')}VC[k]=URL.createObjectURL(wav(j.data,j.mime||''));play(VC[k])})
  .catch(function(e){if(SAY===b){sayStop();toast(e.message||'Try again.')}})}
try{speechSynthesis.getVoices();speechSynthesis.onvoiceschanged=function(){}}catch(e){}
function toast(t){var d=document.createElement('div');d.className='tst';d.textContent=t;document.body.appendChild(d);setTimeout(function(){d.remove()},3200)}
function sess(){try{return localStorage.getItem('tt_me')||''}catch(e){return ''}}
function bell(){var b=document.getElementById('bell'),on=b.classList.contains('on');
 if(!('serviceWorker' in navigator)||!('Notification' in window)||!('PushManager' in window)){toast(/iPhone|iPad/.test(navigator.userAgent)?'On iPhone: Share → Add to Home Screen, then open it from there.':'This browser can’t show notifications.');return}
 b.disabled=true;var F='https://www.gstatic.com/firebasejs/10.12.2/';
 function js(u){return new Promise(function(r,j){var s=document.createElement('script');s.src=u;s.onload=r;s.onerror=j;document.head.appendChild(s)})}
 js('/firebase-config.js').then(function(){return js(F+'firebase-app-compat.js')}).then(function(){return js(F+'firebase-messaging-compat.js')}).then(function(){
  if(!firebase.apps.length)firebase.initializeApp(self.SEKNA_FIREBASE);
  return navigator.serviceWorker.register('/tiktok/me-sw.js',{scope:'/tiktok/me'})}).then(function(reg){
  if(on)return firebase.messaging().getToken({vapidKey:self.SEKNA_FIREBASE.vapidKey,serviceWorkerRegistration:reg}).catch(function(){return ''}).then(function(t){return fetch('/tiktok/me/push',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({sess:sess(),token:t,on:false})})}).then(function(){b.classList.remove('on');nt(false);toast('Notifications off.')});
  return Notification.requestPermission().then(function(p){if(p!=='granted')throw new Error('Allow notifications for this site first.');
   return firebase.messaging().getToken({vapidKey:self.SEKNA_FIREBASE.vapidKey,serviceWorkerRegistration:reg})}).then(function(t){
   return fetch('/tiktok/me/push',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({sess:sess(),token:t,on:true})}).then(function(r){return r.json()})}).then(function(j){if(!j.ok)throw new Error(j.error||'Try again.');b.classList.add('on');nt(true);toast('Done. We’ll tell you once a day if something new needs a fix.')})
 }).catch(function(e){toast((e&&e.message)||'Try again.')}).finally(function(){b.disabled=false})}
function cp(t,b){try{navigator.clipboard.writeText(t).then(function(){b.textContent='Copied';setTimeout(function(){b.textContent='Copy'},1200)})}catch(e){}}</script></body></html>`;
}
/** The issue on a page of its own (HEMERA's look), for the email's link. */
function issuePage(x, msg, map, key) {
  const E = notify.esc, mon = k => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(k || '')); return m ? (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + m[1] + (m[4] ? ' · ' + m[4] : '') : String(k || ''); };
  const person = part => { let lab = '', who = part; const c = part.indexOf(': '); if (c > 0 && c < 40) { lab = part.slice(0, c); who = part.slice(c + 2); }
    const m = /([^\s@(]+)@([a-z0-9.-]+)/i.exec(who), k = m ? (m[1] + '@' + m[2]).toLowerCase() : '', n = k && map && map[k] && map[k].name;
    return { name: n || (m ? m[1] : /claude/i.test(who) ? 'Claude' : /older/i.test(who) ? 'Older' : who), sub: m ? (n ? k : '@' + m[2]) + (/api/i.test(who) ? ' · via API' : '') : /older/i.test(who) ? 'before the change log' : '', lab }; };
  const kind = x ? (/landing|link|https?/i.test(x.type) ? 'LANDING PAGE' : /utm|pixel|track/i.test(x.type) ? 'TRACKING' : /name|duplicate|videos in one/i.test(x.type) ? 'NAMING' : /country|text|content|caption/i.test(x.type) ? 'CONTENT' : 'ISSUE') : '';
  const card = (t, b) => `<div class="c"><div class="l">${t}</div>${b}</div>`;
  const body = x ? `<div class="h"><small>${kind} · FOUND ${E(mon(x.found).toUpperCase())}</small><h1>${E(x.type || 'Issue')}</h1><span class="${/^yes/i.test(x.fixed) ? 'sg' : 'sr'}">${/^yes/i.test(x.fixed) ? 'Fixed' : 'Open'}</span></div>
   ${card("What's wrong", `<p class="w">${E(x.what || '—')}</p>`)}
   ${x.ads ? card('Ads affected', String(x.ads).split(/\n+|,\s+(?=[A-Za-z])/).filter(Boolean).map(a => `<div class="r"><b>${E(a)}</b></div>`).join('')) : ''}
   ${x.made ? card('Ads created · New York time', String(x.made).split(/\n+/).filter(Boolean).map(l => { const m = /^\s*(\d+)\s*:\s*(.+)$/.exec(l); return m ? `<div class="r"><b>${E(m[1])}</b><span>${E(m[2])}</span></div>` : `<div class="r"><b>${E(l)}</b></div>`; }).join('')) : ''}
   ${x.by ? card('Made by', String(x.by).split(/\s+·\s+/).map(person).map(p => `<div class="p"><i>${E(String(p.name).charAt(0).toUpperCase())}</i><div><b>${E(p.name)}</b><small>${E(p.sub)}</small></div>${p.lab ? `<em>${E(p.lab)}</em>` : ''}</div>`).join('')) : ''}
   <a class="b" href="https://sekna-app.web.app/tiktok/?is=${E(key || '')}">Open in HEMERA</a><p class="n">For the HEMERA team: open it in the app to ask Alexandra about it.</p>`
    : `<div class="c e"><p>${E(msg)}</p></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${x ? E(x.type) + ' · ' : ''}TikTok issue · HEMERA</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&family=DM+Serif+Display&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0}body{background:#F4F6FB;font-family:Inter,system-ui,sans-serif;color:#141B33;padding:18px 16px 40px}.wrap{max-width:560px;margin:0 auto}
.top{display:flex;align-items:center;gap:8px;margin:2px 2px 14px;font-weight:900;color:#203C8E;font-size:15px;letter-spacing:.06em}.top i{width:26px;height:26px;border-radius:8px;background:linear-gradient(140deg,#203C8E,#2C4FB8);display:grid;place-items:center;color:#E2B874;font-style:normal;font-size:13px}
.t{font-family:"DM Serif Display",Georgia,serif;font-size:30px;margin:0 2px 12px}.t span{background:linear-gradient(transparent 58%,#F2D38F 0)}
.h{background:linear-gradient(140deg,#132457,#203C8E 55%,#2C4FB8);color:#fff;border-radius:18px;padding:18px;margin-bottom:10px;box-shadow:0 10px 26px rgba(20,40,110,.14)}.h small{font-size:10.5px;font-weight:900;letter-spacing:.1em;color:#E2B874}.h h1{font-size:23px;font-weight:900;margin:6px 0 10px;line-height:1.2}.h span{font-size:11px;font-weight:900;border-radius:99px;padding:4px 12px}.h .sr{background:#FBDDE1;color:#C63A4A}.h .sg{background:#E3F6EC;color:#13804F}
.c{background:#fff;border-radius:16px;padding:14px 16px;margin-bottom:10px;box-shadow:0 8px 22px rgba(20,40,110,.07)}.l{font-size:9.5px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#8A93A8;margin-bottom:8px}.w{font-size:15px;font-weight:600;line-height:1.55}
.r{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid #F1F3F8;font-size:13px}.l+.r{border-top:0}.r b{word-break:break-word}.r span{color:#8A93A8;font-weight:700;font-size:12px;flex:none}
.p{display:flex;align-items:center;gap:10px;padding:7px 0}.p>div{flex:1;min-width:0}.p i{width:32px;height:32px;border-radius:50%;background:linear-gradient(140deg,#2C4FB8,#203C8E);color:#fff;font-style:normal;font-weight:900;display:grid;place-items:center;flex:none}.p b{font-size:13.5px}.p small{display:block;font-size:11px;color:#8A93A8;font-weight:700}.p em{font-style:normal;font-size:11px;font-weight:800;color:#B0812E;text-align:right;max-width:130px}
.b{display:block;text-align:center;background:#203C8E;color:#fff;text-decoration:none;font-weight:800;font-size:14px;border-radius:14px;padding:14px;margin-top:6px}.n{font-size:11.5px;color:#8A93A8;font-weight:600;text-align:center;margin-top:8px}.e p{font-size:15px;font-weight:700;text-align:center;padding:16px 0}
.f{font-size:11px;color:#8A93A8;text-align:center;margin-top:22px}</style></head><body><div class="wrap"><div class="top"><i>H</i>HEMERA · TIKTOK</div><div class="t">Issue <span>to fix</span></div>${body}<p class="f">TikTok · Human Appeal US · Account Health</p></div></body></html>`;
}
/** A short id for an issue (the same on the page): its date, type and ads. */
function issueKey(x) { const t = String(x.found || '') + '|' + String(x.type || '') + '|' + String(x.ads || '').slice(0, 60); let h = 5381; for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36); }
/** The issue email (design C, "Personal note"); the button opens the issue on the TikTok page. */
/** v713 the TikTok email: the banner with the greeting, the person's newest 3 open issues, and one button. */
function digestMailHtml(name, list, open, toFix, link) {
  const E = notify.esc, F = "font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif", B = 'https://sekna-app.web.app/icons/email/';
  const mon = k => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(k || '')); return m ? (+m[3]) + ' ' + MON[+m[2] - 1] : ''; };
  const rows = list.map((x, i) => `<tr><td style="padding:11px 0;${i ? 'border-top:1px solid #EEF1F6;' : ''}" valign="top" width="16"><div style="width:8px;height:8px;border-radius:50%;background:#C63A4A;margin-top:6px"></div></td>
<td style="padding:11px 8px;${i ? 'border-top:1px solid #EEF1F6;' : ''}"><p style="margin:0;${F};font-size:14px;font-weight:800;color:#141B33">${E(x.type || 'Issue')}</p><p style="margin:3px 0 0;${F};font-size:12px;font-weight:600;color:#6B7385;line-height:1.45">${E(String(x.what || '').slice(0, 90))}${String(x.what || '').length > 90 ? '…' : ''}</p></td>
<td style="padding:11px 0;${i ? 'border-top:1px solid #EEF1F6;' : ''}${F};font-size:11px;font-weight:700;color:#8A93A8;white-space:nowrap" valign="top" align="right">${E(mon(x.found))}</td></tr>`).join('');
  const more = open > list.length ? `<p style="margin:4px 0 0;${F};font-size:12px;font-weight:700;color:#8A93A8">+${open - list.length} more on your page</p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#F4F6FB;padding:20px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td background="${B}tt-banner.jpg" bgcolor="#0F1F52" valign="top" style="background:#0F1F52 url(${B}tt-banner.jpg) right center / cover no-repeat;border-radius:18px;padding:0">
<table role="presentation" width="100%" height="170" cellpadding="0" cellspacing="0" style="height:170px"><tr><td valign="top" style="padding:16px 20px 0"><img src="${B}hemera-logo.png" alt="HEMERA" height="17" style="display:block;height:17px;border:0"></td></tr>
<tr><td valign="bottom" style="padding:0 20px 14px"><p style="margin:0;${F};font-size:20px;font-weight:900;color:#ffffff;text-shadow:0 1px 6px rgba(0,0,0,.6)">Hi ${E(name)}</p>
<p style="margin:2px 0 0;${F};font-size:12px;font-weight:700;color:#DCE3F8;text-shadow:0 1px 6px rgba(0,0,0,.6)">${open} open issue${open === 1 ? '' : 's'}${toFix ? ' · ' + toFix + ' ad' + (toFix === 1 ? '' : 's') + ' to fix' : ''}</p></td></tr></table></td></tr>
<tr><td style="height:12px;line-height:12px">&nbsp;</td></tr>
<tr><td style="background:#ffffff;border-radius:18px;padding:18px 18px 20px">
<p style="margin:0 0 4px;${F};font-size:10px;font-weight:900;letter-spacing:1.4px;color:#B0812E">${list.length < open ? 'YOUR NEWEST OPEN ISSUES' : 'YOUR OPEN ISSUES'}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>${more}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px auto 0"><tr><td style="background:#203C8E;border-radius:12px"><a href="${E(link)}" style="display:inline-block;padding:12px 26px;${F};font-size:14px;font-weight:800;color:#ffffff;text-decoration:none">Open my issues</a></td></tr></table></td></tr>
<tr><td style="padding:14px 0 0;${F};font-size:11px;color:#8A93A8;text-align:center">You get this because a new issue was found on ads you made.</td></tr></table></td></tr></table></body></html>`;
}
function nameOf(m, who) {
  const n = String((m && m.name) || '').trim().split(/\s+/)[0]; if (n) return n;
  const l = String((m && m.email) || '').split('@')[0].split(/[._\-+0-9]/).filter(Boolean)[0] || '';
  return l ? l.charAt(0).toUpperCase() + l.slice(1).toLowerCase() : '';
}
/** One person's open issues (newest first) and how many of their live ads need a fix. */
function digestOf(who, acct) {
  const W = String(who || '').toLowerCase(), L = (acct.issues || []).filter(x => !/^yes/i.test(x.fixed) && String(x.by || '').toLowerCase().indexOf(W) >= 0).sort((a, b) => String(b.found || '').localeCompare(String(a.found || '')));
  const toFix = (acct.checks || []).filter(c => String(c.by || '').toLowerCase().indexOf(W) >= 0 && String(c.problems || '').trim() && !/^ok$/i.test(String(c.problems).trim())).length;
  return { L, toFix };
}
function issueMailHtml(x, name, link) {
  const E = notify.esc, F = "font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif", url = link || ('https://sekna-app.web.app/tiktok/?is=' + issueKey(x));
  const kind = /landing|link|https?/i.test(x.type) ? 'LANDING PAGE' : /utm|pixel|track/i.test(x.type) ? 'TRACKING' : /name|duplicate|videos in one/i.test(x.type) ? 'NAMING' : /country|text|content|caption/i.test(x.type) ? 'CONTENT' : 'ISSUE';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x.found || '')), day = m ? (+m[3]) + ' ' + MON[+m[2] - 1].toUpperCase() + ' ' + m[1] : String(x.found || '').toUpperCase();
  return `<!doctype html><html><body style="margin:0;background:#F4F6FB;padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px"><tr><td style="background:#ffffff;border-radius:20px;padding:24px">
<table role="presentation" width="100%"><tr><td width="52" valign="middle"><div style="width:44px;height:44px;border-radius:50%;background:#203C8E;color:#fff;${F};font-size:19px;font-weight:900;text-align:center;line-height:44px">${E(String(name).charAt(0).toUpperCase())}</div></td>
<td valign="middle"><p style="margin:0;${F};font-size:16px;font-weight:900;color:#141B33">Hi ${E(name)}</p><p style="margin:2px 0 0;${F};font-size:12px;font-weight:700;color:#8A93A8">An open issue on your TikTok ads</p></td></tr></table>
<table role="presentation" width="100%" style="margin-top:18px;border-left:4px solid #C63A4A;background:#FFF7F8;border-radius:0 14px 14px 0"><tr><td style="padding:14px 16px">
<p style="margin:0;${F};font-size:10px;font-weight:900;letter-spacing:1px;color:#C63A4A">${kind} · ${E(day)}</p>
<p style="margin:6px 0 4px;${F};font-size:17px;font-weight:900;color:#141B33">${E(x.type || 'Issue')}</p>
<p style="margin:0;${F};font-size:13.5px;font-weight:600;color:#4b5263;line-height:1.5">${E(x.what || '')}</p>
${x.ads ? `<p style="margin:10px 0 0;${F};font-size:12px;font-weight:800;color:#203C8E">${E(String(x.ads).replace(/\n+/g, ' · '))}</p>` : ''}</td></tr></table>
<div style="height:20px"></div><table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td style="background:#203C8E;border-radius:12px"><a href="${url}" style="display:inline-block;padding:13px 26px;${F};font-size:14px;font-weight:800;color:#ffffff;text-decoration:none">See the issue</a></td></tr></table>
<p style="margin:14px 0 0;${F};font-size:12px;color:#6B7385;text-align:center">Sign in with your work email to see all the issues on your ads.</p></td></tr></table><p style="${F};font-size:11px;color:#8A93A8;text-align:center;margin:18px 0 0">TikTok · Human Appeal US · Account Health<br>You get this because an ad you made has an open issue.</p></td></tr></table></body></html>`;
}
let feedHeld = null, feedPending = null;
function ttFeed() {
  if (feedHeld && Date.now() - feedHeld.at < 5 * 60000) return Promise.resolve(feedHeld.v);
  if (feedPending) return feedPending;
  feedPending = buildTikTokFeed().then(v => { feedHeld = { at: Date.now(), v }; feedPending = null; return v; }, e => { feedPending = null; if (feedHeld) return feedHeld.v; throw e; });
  return feedPending;
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
  ...(notify.MAIL_ON_DEPLOY ? { secrets: [notify.GMAIL_PASSWORD] } : {}),
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
  // v685 the person's own page: /tiktok/me (work email → 6-digit code → their issues and ad checks)
  if (/^(?:\/tiktok)?\/me$/.test(route) && req.method === 'GET') { res.set('Content-Type', 'text/html; charset=utf-8'); res.set('X-Robots-Tag', 'noindex'); res.status(200).send(meGate()); return; }
  if (/^(?:\/tiktok)?\/me\/(code|verify|page|out|push|say)$/.test(route) && req.method === 'POST') {
    let b = req.body; if (!(b && typeof b === 'object' && !Buffer.isBuffer(b))) { try { b = JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : (typeof b === 'string' ? b : (req.rawBody ? req.rawBody.toString('utf8') : '{}'))); } catch (e) { b = {}; } }
    try { res.json(await meRoute(route.split('/').pop(), b || {})); } catch (e) { res.json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
    return;
  }
  // v700 GET /akpic: Alexandra's account photo (or her picture from the app when none was sent yet)
  if (/^(?:\/tiktok)?\/akpic$/.test(route) && req.method === 'GET') {
    try {
      if (!akPicHeld || Date.now() - akPicHeld.at > 30 * 60000) { const d = (await fsGet('server/tt-akpic').catch(() => null)) || {}; akPicHeld = { at: Date.now(), d }; }
      const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(akPicHeld.d.data || '');
      if (!m) { res.redirect(302, 'https://sekna-app.web.app/icons/alexandra/vn.webp'); return; }
      res.set('Content-Type', m[1]); res.set('Cache-Control', 'public, max-age=1800'); res.send(Buffer.from(m[2], 'base64'));
    } catch (e) { res.redirect(302, 'https://sekna-app.web.app/icons/alexandra/vn.webp'); }
    return;
  }
  // v681 the issue page from the email: /tiktok/i/<secret> (on sekna-app.web.app) or /i/<secret> here; no sign-in, 14 days
  const im = /^(?:\/tiktok)?\/i\/([A-Za-z0-9_-]{16,40})$/.exec(route);
  if (im && req.method === 'GET') {
    res.set('Content-Type', 'text/html; charset=utf-8'); res.set('X-Robots-Tag', 'noindex');
    try {
      const L = ((await fsGet(TT_LINKS).catch(() => null)) || {})[im[1]];
      if (!L || L.exp < Date.now()) { res.status(410).send(issuePage(null, 'This link has expired. Ask the team to send it again.')); return; }
      const acct = await ttAcct(), doc = (await fsGet(TT_PEOPLE).catch(() => null)) || {};
      await arLoad(); res.status(200).send(personPage(L.who || '', acct, doc.map || {}));
    } catch (e) { console.warn('Issue page: ' + ((e && e.message) || e)); res.status(500).send(issuePage(null, 'The page could not load. Try again in a minute.')); }
    return;
  }
  if (route === '/pic' && req.method === 'GET') {
    try {
      const u = String((req.query && req.query.u) || '');
      if (!/^https:\/\/[a-z0-9.-]+\.(tiktokcdn(-[a-z]+)?\.com|ibyteimg\.com)\//i.test(u)) { res.status(400).send(''); return; }
      const snap = await ttSnap().catch(() => null);
      if (!snap || !((snap.creatives || []).concat(snap.partners || []).some(c => c.pic === u) || (snap.topics || []).some(t => t.img === u) || (feedHeld && Object.values(feedHeld.v.vids || {}).some(v => v.pic === u)) || (acctHeld && (acctHeld.v.checks || []).some(c => (c.pics || []).indexOf(u) >= 0)))) { res.status(404).send(''); return; }
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
  if ((route !== '/data' && route !== '/months' && route !== '/snap' && route !== '/acct' && route !== '/feed' && route !== '/people' && route !== '/peopleSet' && route !== '/peopleView' && route !== '/akPicSet' && route !== '/mailPreview' && route !== '/peopleClear' && route !== '/arNeed' && route !== '/arSet' && route !== '/issueMail' && route !== '/issueMailTest') || req.method !== 'POST') { res.status(404).json({ ok: false, error: 'Not found' }); return; }
  let body = req.body;
  if (!(body && typeof body === 'object' && !Buffer.isBuffer(body))) {
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : typeof body === 'string' ? body : (req.rawBody ? req.rawBody.toString('utf8') : '');
    try { body = JSON.parse(text || '{}'); } catch (e) { body = {}; }
  }
  try {
    // v675 who is behind each masked TikTok email: a name, or a HEMERA profile (admins set it in Account & Policy)
    if (route === '/peopleSet') {
      await assertAdmin(body.token);
      const key = String(body.key || '').trim().toLowerCase().slice(0, 120);
      if (!key) throw new Error('No account.');
      const name = String(body.name || '').trim().slice(0, 60), email = String(body.email || '').trim().toLowerCase().slice(0, 120);
      if (email && !name) { const l = email.split('@')[0].split(/[._\-+0-9]/).filter(Boolean)[0] || ''; if (l) body.name = l.charAt(0).toUpperCase() + l.slice(1).toLowerCase(); }
      if (email) { const km = /^([^@]+)@(.+)$/.exec(key), em = /^([^@\s]+)@([a-z0-9.-]+)$/.exec(email);
        if (!em) throw new Error('Type a full email.');
        if (km && (em[2] !== km[2] || em[1].charAt(0) !== km[1].charAt(0) || em[1].slice(-1) !== km[1].slice(-1))) throw new Error('This email does not match ' + key + '.'); }
      const nm2 = String(body.name || '').trim().slice(0, 60);
      const doc = await fsUpdate(TT_PEOPLE, d => { d = d || {}; d.map = d.map || {}; if (!nm2 && !email) delete d.map[key]; else d.map[key] = { name: nm2, email, at: Date.now() }; return d; });
      res.json({ ok: true, result: (doc && doc.map) || {} }); return;
    }
    await assertAccess(body.token);
    // v701 the messages that still need an Egyptian Arabic copy, and saving the copies (admins; the app translates)
    if (route === '/arNeed') {
      await assertAdmin(body.token); arAt = 0; await arLoad();
      const d = (await fsGet(TT_PEOPLE).catch(() => null)) || {};
      res.json({ ok: true, result: sayAll(await ttAcct(), d.map || {}).filter(t => !AR[sayKey(t)]).slice(0, 30) }); return;
    }
    if (route === '/arSet') {
      await assertAdmin(body.token);
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40).map(x => [String(x.en || '').slice(0, 1500), String(x.ar || '').trim().slice(0, 1500)]).filter(x => x[0] && /[\u0600-\u06FF]/.test(x[1]));
      const doc = await fsUpdate('server/tt-ar', d => { d = d || {}; d.map = d.map || {}; items.forEach(([en, ar]) => { d.map[sayKey(en)] = ar; }); const K = Object.keys(d.map); if (K.length > 2000) K.slice(0, K.length - 2000).forEach(k => delete d.map[k]); return d; });
      AR = (doc && doc.map) || AR; arAt = Date.now();
      res.json({ ok: true, result: items.length }); return;
    }
    // v700 Alexandra's account photo, sent by the app when an admin opens Account & Policy
    if (route === '/akPicSet') {
      await assertAdmin(body.token);
      const data = String(body.data || ''), v = String(body.v || '').slice(0, 80);
      if (!/^data:image\/(png|jpe?g|webp);base64,/.test(data) || data.length > 700000) throw new Error('Not a photo.');
      await fsUpdate('server/tt-akpic', () => ({ v, data, at: Date.now() })); akPicHeld = null;
      res.json({ ok: true }); return;
    }
    // v714 the email this person would get now (to look at in the app), and clearing a person
    if (route === '/mailPreview') {
      await assertAdmin(body.token);
      const who = String(body.who || '').trim().toLowerCase(), d = (await fsGet(TT_PEOPLE).catch(() => null)) || {}, m = (d.map || {})[who] || {}, acct = await ttAcct(), dg = digestOf(who, acct);
      res.json({ ok: true, result: dg.L.length ? digestMailHtml(nameOf(m, who) || 'there', dg.L.slice(0, 3), dg.L.length, dg.toFix, 'https://sekna-app.web.app/tiktok/me') : '' }); return;
    }
    if (route === '/peopleClear') {
      await assertAdmin(body.token);
      const who = String(body.who || '').trim().toLowerCase(); if (!who) throw new Error('No account.');
      const doc = await fsUpdate(TT_PEOPLE, d => { d = d || {}; d.map = d.map || {}; delete d.map[who]; return d; });
      await fsUpdate(TT_ME, d => { d = d || {}; ['opens', 'mlog', 'mailed', 'push', 'seen'].forEach(k => { if (d[k]) delete d[k][who]; }); Object.keys(d.sess || {}).forEach(t => { if (d.sess[t].who === who) delete d.sess[t]; }); return d; });
      res.json({ ok: true, result: (doc && doc.map) || {} }); return;
    }
    // v696 an admin sees a person's emailed page exactly as it looks to them (no sign-in, no notifications)
    if (route === '/peopleView') {
      await assertAdmin(body.token);
      const who = String(body.who || '').trim().toLowerCase().slice(0, 120); if (!who) throw new Error('No account.');
      const d = (await fsGet(TT_PEOPLE).catch(() => null)) || {};
      await arLoad(); const vt = require('crypto').randomBytes(12).toString('base64url'); viewToks.set(vt, { who, exp: Date.now() + 3 * 3600e3 }); if (viewToks.size > 200) viewToks.delete(viewToks.keys().next().value);
      res.json({ ok: true, result: personPage(who, await ttAcct(), d.map || {}, false, false, await ttFeed().catch(() => null)).replace('var AH=', 'var VT=' + JSON.stringify(vt) + ';var AH=') }); return;
    }
    if (route === '/people') { const d = (await fsGet(TT_PEOPLE).catch(() => null)) || {}, me = (await fsGet(TT_ME).catch(() => null)) || {};
      res.json({ ok: true, result: Object.assign({}, d.map || {}, { _mails: d.mails || {}, _opens: me.opens || {}, _mlog: me.mlog || {} }) }); return; }
    // v680 email the person who made the ads of an issue (admins; only people linked to a HEMERA profile)
    // v682 a test: the email for one of this person's open issues, sent to the admin who taps it (not to the person)
    if (route === '/issueMailTest') {
      const me = await assertAdmin(body.token);
      if (!me || !me.email) throw new Error('No email for you.');
      const who = String(body.who || '').toLowerCase(), acct = await ttAcct();
      // v715 only the person's own open issues; none → nothing is sent
      const dg = digestOf(who, acct);
      if (!dg.L.length) throw new Error('No open issue for this person, so there is nothing to email.');
      if (!notify.mailReady()) throw new Error('Email is not set up on the server yet.');
      const doc = (await fsGet(TT_PEOPLE).catch(() => null)) || {}, m = (doc.map || {})[who] || {}, name = nameOf(m, who) || 'there';
      await notify.sendMail({ to: me.email, subject: '[Test] TikTok: ' + dg.L.length + ' open issue' + (dg.L.length === 1 ? '' : 's') + ' on your ads', rawHtml: digestMailHtml(name, dg.L.slice(0, 3), dg.L.length, dg.toFix, 'https://sekna-app.web.app/tiktok/me') });
      res.json({ ok: true, result: { to: me.email, issue: dg.L[0].type } }); return;
    }
    if (route === '/issueMail') {
      const me = await assertAdmin(body.token);
      const key = String(body.key || ''), who = String(body.who || '').toLowerCase();
      const acct = await ttAcct(), issue = (acct.issues || []).find(x => issueKey(x) === key);
      if (!issue) throw new Error('This issue is not in the sheet any more.');
      const doc = (await fsGet(TT_PEOPLE).catch(() => null)) || {}, m = (doc.map || {})[who];
      if (!m || !m.email) throw new Error('Link this person to a HEMERA profile first (Account & Policy → Team accounts).');
      if (!notify.mailReady()) throw new Error('Email is not set up on the server yet.');
      const name = nameOf(m, who) || 'there';
      const dg = digestOf(who, acct), L3 = (dg.L.length ? dg.L : [issue]).slice(0, 3);
      await notify.sendMail({ to: m.email, replyTo: me && me.email ? me.email : undefined, subject: 'TikTok: ' + (dg.L.length || 1) + ' open issue' + ((dg.L.length || 1) === 1 ? '' : 's') + ' on your ads', rawHtml: digestMailHtml(name, L3, dg.L.length || 1, dg.toFix, 'https://sekna-app.web.app/tiktok/me') });
      await fsUpdate(TT_ME, d => { d = d || {}; d.mailed = d.mailed || {}; d.mailed[who] = [...new Set((d.mailed[who] || []).concat(dg.L.map(issueKey)))]; d.mlog = d.mlog || {}; d.mlog[who] = (d.mlog[who] || []).concat([{ at: Date.now(), n: dg.L.length, by: 'admin' }]).slice(-200); return d; });
      const at = Date.now();
      await fsUpdate(TT_PEOPLE, d => { d = d || {}; d.mails = d.mails || {}; const l = d.mails[key] = (d.mails[key] || []).filter(x => x.who !== who); l.push({ who, at }); return d; });
      res.json({ ok: true, result: { at } }); return;
    }
    res.json({ ok: true, result: route === '/months' ? await ttMonths() : route === '/snap' ? await ttSnap() : route === '/acct' ? await ttAcct() : route === '/feed' ? await ttFeed() : await ttData(!!body.force) });
  } catch (e) {
    res.json({ ok: false, access: !!(e && (e.access || e.blocked)), error: String((e && e.message) || e).slice(0, 300) });
  }
});

// The Hijri month of each month, named exactly as Google's sheet does (the app marks 'Ramadan' and 'Dhu Hijjah' by these names).
/* ---------- Performance Snapshots: the Creatives, Topics & landing pages and Partners tabs, read by their headers ---------- */
/* ---------- Pictures: the sheet's "Image links" tab (Key → Image URL); other tabs show =IMAGE(VLOOKUP(key, 'Image links'!A:C, 3)) ---------- */
async function imageLinks(meta) {
  const tab = meta.sheets.find(s => /^image links$/i.test(String(s.title).trim()));
  if (!tab) return {};
  const rows = (await batchGet(TT_SHEET_ID, [a1(tab.title, 'A2:C4000')]))[0] || [];
  const m = {}; rows.forEach(r => { const k = String((r || [])[0] == null ? '' : r[0]).trim(), u = String((r || [])[2] || '').trim(); if (k && /^https:\/\//.test(u)) m[k] = u; });
  return m;
}
async function formulas(title, range) {
  try {
    const f = await request('https://sheets.googleapis.com/v4/spreadsheets/' + TT_SHEET_ID + '/values/' + encodeURIComponent(a1(title, range)) + '?valueRenderOption=FORMULA');
    return ((f && f.values) || []).map(r => String((r || [])[0] == null ? '' : r[0]));
  } catch (e) { console.warn('TikTok formulas ' + title + ': ' + ((e && e.message) || e)); return []; }
}
/** =IMAGE("url"), =IMAGE(VLOOKUP("key", …)) or a plain link → the picture's link */
function picOf(f, links) {
  f = String(f || '').trim();
  const a = /IMAGE\(\s*"(https:\/\/[^"]+)"/i.exec(f); if (a) return a[1];
  const b = /VLOOKUP\(\s*"([^"]+)"/i.exec(f); if (b) return links[b[1]] || '';
  const c = /^(https:\/\/\S+)$/.exec(f); return c ? c[1] : '';
}
/** The newest monthly tab of a kind, e.g. "Issues log – Nov 2026" (or the plain one, like "Issues log") */
function monthTab(meta, re) {
  const L = meta.sheets.filter(s => re.test(String(s.title).trim())).map(s => {
    const m = /([A-Z][a-z]{2})\s+(\d{4})\s*$/.exec(String(s.title).trim()), i = m ? MON.indexOf(m[1]) : -1;
    return { s, k: i >= 0 ? m[2] + '-' + pad(i + 1) : '0000' };
  }).sort((a, b) => (a.k < b.k ? 1 : -1));
  return L.length ? L[0].s : null;
}

async function buildTikTokSnap() {
  const meta = await sheetMeta(TT_SHEET_ID);
  const find = re => meta.sheets.find(s => re.test(String(s.title).trim()));
  const tabs = [find(/^creatives$/i), find(/^topics/i), find(/^partners$/i)];
  const [vals, links] = await Promise.all([batchGet(TT_SHEET_ID, tabs.map(t => a1(t ? t.title : 'Creatives', 'A1:T400'))), imageLinks(meta).catch(() => ({}))]);
  // The video pictures: column A of Creatives holds =IMAGE("url"), read as formulas (the link lasts about 7 days; the sheet renews it)
  let pics = [];
  if (tabs[0]) {
    try {
      const f = await request('https://sheets.googleapis.com/v4/spreadsheets/' + TT_SHEET_ID + '/values/' + encodeURIComponent(a1(tabs[0].title, 'A1:A400')) + '?valueRenderOption=FORMULA');
      pics = ((f && f.values) || []).map(r => picOf((r || [])[0], links));
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
    .map(o => ({ name: T(o.name), topic: T(o.topic), creator: T(o.creator), type: T(o.type), campaign: T(o.campaign), adgroup: T(o.adgroup), spend: N(o.spend), impr: N(o.impr), clicks: N(o.clicks), ctr: N(o.ctr), conv: N(o.conv), value: N(o.value), roas: N(o.roas), share: o.share === '' ? null : N(o.share), lp: T(o.lp), decision: T(o.decision), post: T(o.post), pic: pics[o._row] || links[T(o.type) === 'Catalog' ? T(o.name) : T(o.post)] || '' })).filter(o => o.name) : [];
  const topics = tabs[1] ? table(vals[1], { topic: ['topic'], spend: ['spend'], conv: ['conv (cta)', 'conv'], value: ['value (cta)', 'value'], roas: ['roas (cta)', 'roas'], best: ['best landing page'], bestRoas: ['its roas'], tried: ['pages tried'] })
    .map(o => ({ topic: T(o.topic), spend: N(o.spend), conv: N(o.conv), value: N(o.value), roas: N(o.roas), best: T(o.best), bestRoas: o.bestRoas === '' ? null : N(o.bestRoas), tried: N(o.tried), img: links[T(o.best)] || '' })).filter(o => o.topic) : [];
  // Partners: a profile picture ("Avatar" / "Profile image": =IMAGE("url") or a plain link) and "Active videos" when the sheet has them
  let avatars = [];
  if (tabs[2]) {
    const head = ((vals[2] || [])[0] || []).map(h => String(h || '').trim().toLowerCase());
    const ai = head.findIndex(h => /^(avatar|profile|photo)/.test(h));
    if (ai >= 0) {
      const col = String.fromCharCode(65 + ai);
      try {
        const f = await request('https://sheets.googleapis.com/v4/spreadsheets/' + TT_SHEET_ID + '/values/' + encodeURIComponent(a1(tabs[2].title, col + '1:' + col + '400')) + '?valueRenderOption=FORMULA');
        avatars = ((f && f.values) || []).map(r => picOf((r || [])[0], links));
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
  const tabs = [find(/^account/i), find(/^qa/i), monthTab(meta, /^issues/i)];
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
  // v678 the creatives in each ad ("Creative 1" … "Creative 31": =IMAGE(...) or "Spark post"), by Ad ID
  if (tabs[1] && checks.length) {
    try {
      const [f, links] = await Promise.all([request('https://sheets.googleapis.com/v4/spreadsheets/' + TT_SHEET_ID + '/values/' + encodeURIComponent(a1(tabs[1].title, 'A1:AN800')) + '?valueRenderOption=FORMULA'), imageLinks(meta).catch(() => ({}))]);
      const R = (f && f.values) || [], head = (R[0] || []).map(h => String(h || '').trim().toLowerCase()), idc = head.indexOf('ad id'), cc = head.map((h, i) => (/^creative \d+$/.test(h) ? i : -1)).filter(i => i >= 0);
      const by = {};
      R.slice(1).forEach(r => { const id = String((r || [])[idc] == null ? '' : r[idc]).trim(); if (!id) return;
        by[id] = cc.map(i => { const v = String((r || [])[i] == null ? '' : r[i]).trim(); if (!v) return null; const u = picOf(v, links); return u ? u : (/spark/i.test(v) ? 'spark' : null); }).filter(Boolean); });
      checks.forEach(c => { c.pics = by[c.id] || []; });
    } catch (e) { console.warn('TikTok ad pictures: ' + ((e && e.message) || e)); }
  }
  const issues = tabs[2] ? tbl(vals[2], { found: ['found'], type: ['type'], ads: ['ad(s)', 'ads'], what: ['description'], by: ['created by'], owner: ['owner'], fixed: ['fixed'], fixedOn: ['fixed on'], made: ['ads created'] }).filter(o => o.type || o.what) : [];
  return {
    account: { name: account.account || '', status: account.status || '', balance: num(account.balance), currency: account.currency || 'USD', opened: account.opened || '', checked: account['checked on'] || '' },
    rejected: ads, note, checks, issues, at: Date.now()
  };
}

/* ---------- Comments and Activity history: the two newest month tabs of each ("Comments – Nov 2026", "Activity history – Nov 2026") ---------- */
async function buildTikTokFeed() {
  const meta = await sheetMeta(TT_SHEET_ID);
  const months = re => meta.sheets.filter(s => re.test(String(s.title).trim())).map(s => {
    const m = /([A-Z][a-z]{2})\s+(\d{4})\s*$/.exec(String(s.title).trim()), i = m ? MON.indexOf(m[1]) : -1;
    return { s, k: i >= 0 ? m[2] + '-' + pad(i + 1) : '0000' }; }).sort((a, b) => (a.k < b.k ? 1 : -1)).slice(0, 2).map(x => x.s);
  const cT = months(/^comments/i), aT = months(/^activity/i);
  const [vals, links, snap] = await Promise.all([
    batchGet(TT_SHEET_ID, cT.map(t => a1(t.title, 'A1:M5000')).concat(aT.map(t => a1(t.title, 'A1:I8000'))), true),
    imageLinks(meta).catch(() => ({})), ttSnap().catch(() => null)]);
  const T = v => String(v == null ? '' : v).trim();
  const rows = (v, map) => { const R = (v || []).filter(r => r && r.some(c => T(c))), head = (R[0] || []).map(h => T(h).toLowerCase());
    const ix = {}; Object.keys(map).forEach(k => { let i = -1; for (const n of map[k]) { i = head.indexOf(n); if (i >= 0) break; }
      if (i < 0) for (const n of map[k]) { i = head.findIndex(h => h.indexOf(n) === 0); if (i >= 0) break; } ix[k] = i; });
    return R.slice(1).map(r => { const o = {}; Object.keys(map).forEach(k => { o[k] = ix[k] >= 0 ? T(r[ix[k]]) : ''; }); return o; }); };
  const seen = new Set(), comments = [];
  cT.forEach((t, i) => rows(vals[i], { t: ['time'], camp: ['campaign'], ag: ['ad group'], post: ['post id'], user: ['user'], text: ['comment'], type: ['type'], status: ['status'], likes: ['likes'], replies: ['replies'], blocked: ['blocked'], id: ['comment_id', 'comment id'], cat: ['category'] })
    .forEach(o => { if (!o.text && !o.id) return; const k = o.id || (o.t + o.user + o.text); if (seen.has(k)) return; seen.add(k);
      comments.push({ t: o.t, camp: o.camp, ag: o.ag, post: o.post, user: o.user, text: o.text.slice(0, 600), type: o.type, status: o.status.toLowerCase(), likes: num(o.likes), replies: num(o.replies), blocked: /^y/i.test(o.blocked), id: o.id, cat: o.cat || 'Other' }); }));
  const acts = [];
  aT.forEach((t, i) => rows(vals[cT.length + i], { d: ['date'], tm: ['time'], obj: ['object'], id: ['id'], name: ['name'], act: ['action'], det: ['details'], op: ['operator'], src: ['source'] })
    .forEach(o => { if (!o.d) return; acts.push({ d: o.d.slice(0, 10), tm: o.tm.slice(0, 5), obj: o.obj, id: o.id, name: o.name.slice(0, 120), act: o.act, det: o.det.slice(0, 420), op: o.op, src: o.src }); }));
  // the videos the comments are on: name from Creatives, picture from Image links
  const vids = {}, cr = (snap && snap.creatives) || [];
  comments.forEach(c => { if (!c.post || vids[c.post]) return; const v = cr.find(x => x.post === c.post); vids[c.post] = { name: v ? v.name : '', pic: (v && v.pic) || links[c.post] || '' }; });
  comments.sort((a, b) => (a.t < b.t ? 1 : -1)); acts.sort((a, b) => ((a.d + a.tm) < (b.d + b.tm) ? 1 : -1));
  return { comments, acts, vids, tabs: cT.map(t => t.title).concat(aT.map(t => t.title)), at: Date.now() };
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

const daily = require('firebase-functions/v2/scheduler').onSchedule({ schedule: '15 9 * * *', timeZone: 'America/New_York', region: 'europe-west2', ...(notify.MAIL_ON_DEPLOY ? { secrets: [notify.GMAIL_PASSWORD] } : {}),
  serviceAccount: 'sekna-server@human-appeal-media-plan.iam.gserviceaccount.com', memory: '256MiB', timeoutSeconds: 120 }, () => dailyPush());

module.exports = { daily, dailyPush, buildTikTokData, buildTikTokMonths, buildTikTokSnap, buildTikTokAcct, buildTikTokFeed, TT_CH, TT_SHEET_ID, fn };
