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
async function meRoute(op, b) {
  const email = String(b.email || '').trim().toLowerCase();
  if (op === 'code') {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter your work email.');
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
  return { ok: true, html: personPage(se.who, await ttAcct(), doc.map || {}, true) };
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
function meGate() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#0c1a46"><title>TikTok · HEMERA</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0}html,body{height:100%}body{font-family:Inter,system-ui,sans-serif;background:#0c1a46;display:grid;place-items:center;padding:20px;overflow:hidden}
.o{position:fixed;border-radius:50%;filter:blur(42px);opacity:.75;pointer-events:none}.o1{width:360px;height:360px;left:-110px;top:-90px;background:#3d6bff;animation:a 14s ease-in-out infinite alternate}.o2{width:440px;height:440px;right:-170px;bottom:-150px;background:#c28d3e;opacity:.55;animation:a 18s ease-in-out infinite alternate-reverse}
@keyframes a{to{transform:translate(40px,30px) scale(1.08)}}
.card{position:relative;width:100%;max-width:380px;background:#fff;border-radius:24px;padding:26px 20px 22px;text-align:center;box-shadow:0 30px 60px rgba(0,0,0,.35);animation:in .6s cubic-bezier(.2,.75,.25,1) both}@keyframes in{from{opacity:0;transform:translateY(14px)}}
.lgb{margin:-26px -20px 14px;padding:18px 0 16px;border-radius:24px 24px 0 0;background:linear-gradient(120deg,#132457,#203C8E 60%,#3B5BC8)}.lg{width:150px;margin:0 auto;display:block}.tag{font-size:10px;font-weight:900;letter-spacing:.42em;padding-left:.42em;color:#B0812E;margin-bottom:18px}
h1{font-size:22px;letter-spacing:-.03em;color:#1d2433;margin:4px 0 8px}.sub{font-size:12.5px;line-height:1.6;color:#636b7a;margin:0 auto 18px;max-width:300px}
label{display:block;text-align:left;margin-bottom:14px}label span{display:block;margin:0 0 6px 2px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#7b8392}
input{width:100%;font:inherit;font-size:15px;font-weight:600;border:1.5px solid #dfe4ef;border-radius:14px;padding:13px 14px;outline:none}input:focus{border-color:#203C8E}
.code{font-size:26px;font-weight:900;letter-spacing:12px;text-align:center}
.btn{width:100%;border:0;border-radius:14px;padding:14px;font:inherit;font-size:14px;font-weight:800;color:#fff;background:linear-gradient(140deg,#203C8E,#2C4FB8);cursor:pointer;box-shadow:0 10px 22px rgba(32,60,142,.3)}.btn[disabled]{opacity:.6}
.ic{width:60px;height:60px;margin:0 auto 10px;border-radius:20px;display:grid;place-items:center;background:#eef2fd;color:#203c8e}.ic svg{width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.err{color:#c0392b;font-size:12px;font-weight:700;min-height:16px;margin:-4px 0 10px}.lk{display:flex;justify-content:center;gap:18px;margin-top:14px}.lk button{border:0;background:none;font:inherit;font-size:12px;font-weight:800;color:#203C8E;cursor:pointer}
.ft{position:fixed;bottom:14px;left:0;right:0;text-align:center;font-size:10.5px;font-weight:700;color:rgba(255,255,255,.7)}</style></head>
<body><span class="o o1"></span><span class="o o2"></span>
<main class="card"><div class="lgb"><img class="lg" src="https://sekna-app.web.app/get/logo-white.webp" alt="HEMERA"></div><div class="tag">TIKTOK ISSUES</div>
<section id="s1"><h1>Your TikTok ads</h1><p class="sub">Enter your work email. We'll send you a code to see the issues on the ads you made.</p>
<form onsubmit="send(event)"><label><span>Work email</span><input id="em" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="name@sekna.co.uk"></label><p class="err" id="e1"></p><button class="btn" id="b1">Send verification code</button></form></section>
<section id="s2" hidden><div class="ic"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 7l8 6 8-6"/></svg></div><h1>Check your inbox</h1><p class="sub">If <b id="echo"></b> is on the team, we sent it a 6-digit code.</p>
<form onsubmit="verify(event)"><label><span>Code</span><input id="cd" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"></label><p class="err" id="e2"></p><button class="btn" id="b2">Verify &amp; Continue</button></form>
<div class="lk"><button type="button" onclick="show(1)">Change email</button><button type="button" onclick="send()">Resend code</button></div></section></main>
<p class="ft">TikTok · Human Appeal US · Account Health</p>
<script>var B=location.pathname.indexOf('/tiktok/')===0?'/tiktok/me/':'me/';function api(op,b){return fetch(B+op,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(b)}).then(function(r){return r.json()})}
function show(n){document.getElementById('s1').hidden=n!==1;document.getElementById('s2').hidden=n!==2}
function S(){try{return localStorage.getItem('tt_me')||''}catch(e){return ''}}
function load(){var s=S();if(!s)return;api('page',{sess:s}).then(function(j){if(j&&j.ok){document.open();document.write(j.html);document.close()}else{try{localStorage.removeItem('tt_me')}catch(e){}}})}
function send(e){if(e)e.preventDefault();var em=document.getElementById('em').value.trim(),b=document.getElementById('b1');document.getElementById('e1').textContent='';b.disabled=true;
 api('code',{email:em}).then(function(j){b.disabled=false;if(!j.ok){document.getElementById('e1').textContent=j.error||'Try again.';show(1);return}document.getElementById('echo').textContent=em;show(2);document.getElementById('cd').focus()}).catch(function(){b.disabled=false;document.getElementById('e1').textContent='No connection. Try again.'})}
function verify(e){e.preventDefault();var b=document.getElementById('b2');b.disabled=true;document.getElementById('e2').textContent='';
 api('verify',{email:document.getElementById('em').value.trim(),code:document.getElementById('cd').value}).then(function(j){b.disabled=false;if(!j.ok){document.getElementById('e2').textContent=j.error||'Try again.';return}try{localStorage.setItem('tt_me',j.sess)}catch(x){}load()}).catch(function(){b.disabled=false})}
load();</script></body></html>`;
}
/** v683 the email's page: the app's look (header, account, TikTok), the person's navy card with all their open issues, and their Ad Checks. */
function personPage(who, acct, map, signedIn) {
  const E = notify.esc, W = String(who || '').toLowerCase(), m = /^([^@]+)@(.+)$/.exec(W), nm = (map[W] && map[W].name) || (m ? m[1] : 'Your ads');
  const mon = k => { const x = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(String(k || '')); return x ? (+x[3]) + ' ' + MON[+x[2] - 1] + ' ' + x[1] + (x[4] ? ' · ' + x[4] : '') : String(k || ''); };
  const PIC = u => 'https://europe-west2-human-appeal-media-plan.cloudfunctions.net/tiktok/pic?u=' + encodeURIComponent(u);
  const iss = (acct.issues || []).filter(x => !/^yes/i.test(x.fixed) && W && String(x.by || '').toLowerCase().indexOf(W) >= 0);
  const chk = (acct.checks || []).filter(c => W && String(c.by || '').toLowerCase().indexOf(W) >= 0 && String(c.problems || '').trim() && !/^ok$/i.test(String(c.problems).trim()));
  const prob = t => /same video/i.test(t) ? ['Same video twice in a campaign', '#7B5CF0'] : /utm/i.test(t) ? ['UTM medium not Paid', '#1D9CC8'] : /videos in one ad/i.test(t) ? ['Too many videos in one ad', '#E05566'] : /ptr|spark/i.test(t) ? ['Spark post without PTR', '#2453D6'] : /name/i.test(t) ? ['Name not in the pattern', '#C99A45'] : /https|link/i.test(t) ? ['Link not https', '#B0812E'] : /country/i.test(t) ? ['Country in text ≠ page', '#C63A4A'] : [String(t).slice(0, 40), '#8A93A8'];
  const kindOf = t => /landing|link|https?/i.test(t) ? 'LANDING PAGE' : /utm|pixel|track/i.test(t) ? 'TRACKING' : /name|duplicate|videos in one/i.test(t) ? 'NAMING' : /country|text|content|caption/i.test(t) ? 'CONTENT' : 'ISSUE';
  const person = part => { let lab = '', w = part; const c = part.indexOf(': '); if (c > 0 && c < 40) { lab = part.slice(0, c); w = part.slice(c + 2); }
    const mm = /([^\s@(]+)@([a-z0-9.-]+)/i.exec(w), k = mm ? (mm[1] + '@' + mm[2]).toLowerCase() : '', n = k && map && map[k] && map[k].name;
    return { name: n || (mm ? mm[1] : /claude/i.test(w) ? 'Claude' : /older/i.test(w) ? 'Older' : w), sub: [mm ? (n ? k : '@' + mm[2]) + (/api/i.test(w) ? ' · via API' : '') : /older/i.test(w) ? 'before the change log' : /api/i.test(w) ? 'via API' : '', lab].filter(Boolean).join(' · ') }; };
  const G = new Map(); chk.forEach(c => [...new Set(String(c.problems).split(';').map(p => prob(p.trim())[0]))].forEach(k => { if (!G.has(k)) G.set(k, { col: prob(k)[1], L: [] }); G.get(k).L.push(c); }));
  const others = by => String(by || '').split(/\s+·\s+/).length - 1;
  const list = iss.map((x, i) => `<button type="button" class="ir" onclick="go('i${i}')"><div class="it"><b>${E(x.type || 'Issue')}</b><span class="ch">›</span></div><p>${E(x.what || '')}</p><div class="im"><span class="gold">${others(x.by) > 0 ? '+' + others(x.by) + ' more made these ads' : ''}</span><span class="dt">${E(mon(x.found))}</span></div></button>`).join('');
  const pages = iss.map((x, i) => `<section class="pg" id="i${i}" hidden><button type="button" class="bk" onclick="go('')">‹&nbsp; Issues Log</button>
    <div class="hh"><small>${kindOf(x.type)} · FOUND ${E(mon(x.found).toUpperCase())}</small><h2>${E(x.type || 'Issue')}</h2></div>
    <div class="c"><div class="l">What's wrong</div><p class="w">${E(x.what || '—')}</p></div>
    ${x.ads ? `<div class="c"><div class="l">Ads affected</div>${String(x.ads).split(/\n+|,\s+(?=[A-Za-z])/).filter(Boolean).map(a => `<div class="r"><b>${E(a)}</b></div>`).join('')}</div>` : ''}
    ${x.by ? `<div class="c"><div class="l">Made by</div>${String(x.by).split(/\s+·\s+/).map(person).map(p => `<div class="p"><i>${E(String(p.name).charAt(0).toUpperCase())}</i><div><b>${E(p.name)}</b><small>${E(p.sub)}</small></div></div>`).join('')}</div>` : ''}
    ${x.made ? `<div class="c"><div class="l">Ads created · New York time</div>${String(x.made).split(/\n+/).filter(Boolean).map(l => { const q = /^\s*(\d+)\s*:\s*(.+)$/.exec(l); return q ? `<div class="r"><b>${E(q[1])}</b><span>${E(q[2])}</span></div>` : `<div class="r"><b>${E(l)}</b></div>`; }).join('')}</div>` : ''}</section>`).join('');
  let ai = 0;
  const checks = [...G.entries()].sort((a, b) => b[1].L.length - a[1].L.length).map(([k, g]) => `<details class="cg"><summary style="--c:${g.col}"><i></i><b>${E(k)}</b><em>${g.L.length}</em><span class="ar">⌄</span></summary>
    ${g.L.map(c => { const id = 'a' + (ai++); return `<div class="ca" onclick="tg('${id}')"><b>${E(c.ad)}</b>${(c.pics || []).length ? `<div class="pics">${c.pics.slice(0, 5).map(u => u === 'spark' ? '<span class="sp">Spark</span>' : `<span class="pc"><img src="${E(PIC(u))}" alt="" loading="lazy"></span>`).join('')}${c.pics.length > 5 ? `<em>+${c.pics.length - 5}</em>` : ''}</div>` : ''}
      <span class="dt">${E(String(c.campaign).replace(/^HAUS_/, '').replace(/_TikTok.*$/, ''))} · ${E(mon(c.created).replace(/ · .*/, ''))}</span>
      <div class="dd" id="${id}" hidden><small>Problems</small><p>${String(c.problems).split(';').map(p => E(p.trim())).join('<br>')}</p>${c.by ? `<small>Created by</small><p>${E(c.by)}</p>` : ''}<small>Campaign</small><p>${E(c.campaign)}</p>${c.adgroup ? `<small>Ad group</small><p>${E(c.adgroup)}</p>` : ''}${c.id ? `<small>Ad ID</small><p>${E(c.id)} <button type="button" class="cp" onclick="event.stopPropagation();cp('${E(c.id)}',this)">Copy</button></p>` : ''}</div></div>`; }).join('')}</details>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#203C8E"><title>${E(nm)} · TikTok · HEMERA</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&family=DM+Serif+Display&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0}body{background:#F1F3F8;font-family:Inter,system-ui,sans-serif;color:#141B33;padding-bottom:30px}button{font:inherit;color:inherit}
.hd{position:sticky;top:0;z-index:5;padding:14px 16px;background:linear-gradient(120deg,#132457,#203C8E 60%,#3B5BC8)}.hd img{height:30px;display:block}
.w{max-width:560px;margin:0 auto;padding:14px 16px}.acc{display:inline-flex;align-items:center;gap:8px;background:#fff;border-radius:99px;padding:5px 14px 5px 7px;box-shadow:0 6px 16px rgba(20,40,110,.07);font-weight:800;font-size:13px}.acc img{width:22px;height:22px}.acc small{font-size:11px;color:#8A93A8;font-weight:700;margin-left:2px}
.t{font-family:"DM Serif Display",Georgia,serif;font-size:32px;margin:18px 2px 4px}.t span{background:linear-gradient(transparent 58%,#F2D38F 0)}.sub{font-size:11px;font-weight:900;letter-spacing:.1em;color:#8A93A8;margin:0 2px 12px;text-transform:uppercase}
.card{background:#fff;border-radius:18px;box-shadow:0 10px 26px rgba(20,40,110,.08);overflow:hidden;margin-bottom:14px}
.nb{position:relative;overflow:hidden;display:flex;align-items:center;gap:14px;padding:18px;background:linear-gradient(135deg,#132457,#203C8E 55%,#2C4FB8);color:#fff}.nb .glow{position:absolute;right:-34px;top:-40px;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle,rgba(226,184,116,.42),transparent 70%)}
.av{width:56px;height:56px;border-radius:50%;background:#fff;color:#203C8E;display:grid;place-items:center;font-weight:900;font-size:24px;flex:none;box-shadow:0 6px 16px rgba(0,0,0,.25)}.nb div.n{flex:1;min-width:0}.nb b{font-size:20px}.nb small{display:block;color:#C9D3F5;font-size:12px;font-weight:700}.big{position:relative;text-align:right}.big em{display:block;font-style:normal;font-size:34px;font-weight:900;color:#E2B874;line-height:1}.big span{font-size:11px;color:#C9D3F5;font-weight:800}
.ir{display:block;width:100%;text-align:left;border:0;background:#fff;border-top:1px solid #EEF1F6;padding:14px 18px;cursor:pointer}.ir:first-of-type{border-top:0}.it{display:flex;justify-content:space-between;gap:10px}.it b{font-size:16px}.ch{color:#B0812E;font-size:22px;font-weight:900;line-height:1}
.ir p{font-size:13.5px;color:#6B7385;font-weight:600;margin-top:4px;line-height:1.45}.im{display:flex;justify-content:space-between;margin-top:10px;font-size:12.5px;font-weight:800}.gold{color:#B0812E}.dt{color:#8A93A8;font-size:12px;font-weight:700}
details summary{list-style:none;cursor:pointer}details summary::-webkit-details-marker{display:none}
.cg{border-top:1px solid #EEF1F6}.cg:first-of-type{border-top:0}.cg summary{display:flex;align-items:center;gap:10px;padding:15px 18px}.cg summary i{width:10px;height:10px;border-radius:3px;background:var(--c)}.cg summary b{flex:1;font-size:14px}.cg summary em{font-style:normal;font-weight:900;color:var(--c);font-size:16px}.ar{color:#8A93A8;font-weight:900;font-size:15px;transition:transform .2s}.cg[open] .ar{transform:rotate(180deg)}
.ca{padding:12px 18px;border-top:1px solid #E6EAF3;background:#F4F6FB;cursor:pointer}.ca b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pics{display:flex;gap:4px;align-items:center;margin:7px 0 5px}.pc{width:30px;height:40px;border-radius:7px;overflow:hidden;background:#E3E8F5;display:block}.pc img{width:100%;height:100%;object-fit:cover;display:block}.sp{display:grid;place-items:center;width:30px;height:40px;border-radius:7px;background:#E3E8F5;color:#203C8E;font-size:8px;font-weight:900}.pics em{font-style:normal;font-size:11px;font-weight:900;color:#8A93A8}
.dd{margin-top:8px}.dd small{display:block;font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#8A93A8;margin-top:8px}.dd p{font-size:13px;font-weight:700;margin-top:2px;word-break:break-word}.cp{border:0;background:#E3E8F5;color:#203C8E;font-size:11px;font-weight:800;border-radius:7px;padding:3px 9px;margin-left:6px;cursor:pointer}
.empty{padding:20px;text-align:center;font-weight:700;color:#13804F}
.bk{border:0;background:none;color:#203C8E;font-weight:800;font-size:15px;padding:6px 2px 12px;cursor:pointer}
.hh{background:linear-gradient(140deg,#203C8E,#2C4FB8);color:#fff;border-radius:18px;padding:13px 16px 14px;margin-bottom:10px;box-shadow:0 10px 26px rgba(20,40,110,.12)}.hh small{font-size:10.5px;font-weight:900;letter-spacing:.1em;color:#E2B874}.hh h2{font-size:21px;font-weight:900;margin-top:5px}
.c{background:#fff;border-radius:16px;padding:14px 16px;margin-bottom:10px;box-shadow:0 8px 22px rgba(20,40,110,.07)}.l{font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#8A93A8;margin-bottom:8px}.w2,.w{font-size:15px;font-weight:700;line-height:1.5}
.r{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid #F1F3F8;font-size:13px}.l+.r{border-top:0}.r b{word-break:break-word}.r span{color:#8A93A8;font-weight:700;font-size:12px;flex:none}
.p{display:flex;align-items:center;gap:10px;padding:7px 0}.p>div{flex:1;min-width:0}.p i{width:34px;height:34px;border-radius:50%;background:linear-gradient(140deg,#2C4FB8,#203C8E);color:#fff;font-style:normal;font-weight:900;display:grid;place-items:center;flex:none}.p b{font-size:14px}.p small{display:block;font-size:11.5px;color:#8A93A8;font-weight:700}
.gl{height:3px;margin:26px auto 14px;max-width:220px;background:linear-gradient(90deg,transparent,#E2B874,transparent);border-radius:99px}.ft{text-align:center;font-size:11.5px;color:#8A93A8;font-weight:700}.ft a{color:#B0812E;text-decoration:none;font-weight:800}
.pg .w{padding:0}</style></head>
<body><div class="hd"><img src="https://sekna-app.web.app/get/logo-white.webp" alt="HEMERA"></div>
<div class="w"><div id="home"><span class="acc"><img src="https://sekna-app.web.app/icons/ha-brand.png" alt="">Human Appeal US<small>· TikTok Ads</small></span>
<div class="t">Issues <span>Log</span></div><div class="sub">${iss.length} open · active ads only · tap one</div>
<div class="card"><div class="nb"><span class="glow"></span><span class="av">${E(String(nm).charAt(0).toUpperCase())}</span><div class="n"><b>${E(nm)}</b><small>${E(W)}</small></div><div class="big"><em>${iss.length}</em><span>open issue${iss.length === 1 ? '' : 's'}</span></div></div>${list || '<div class="empty">No open issue. Thank you!</div>'}</div>
<div class="t">Ad <span>Checks</span></div><div class="sub">${chk.length} of your live ads need a fix · tap a problem</div>
<div class="card">${checks || '<div class="empty">Every live ad you made passes.</div>'}</div></div>
${pages}
<div class="gl"></div><p class="ft">TikTok · Human Appeal US · Account Health<br><a href="https://sekna-app.web.app/get/">Get the HEMERA app</a>${signedIn ? ' · <a href="#" onclick="out();return false">Sign out</a>' : ''}</p></div>
<script>function go(id){document.getElementById('home').hidden=!!id;document.querySelectorAll('.pg').forEach(function(p){p.hidden=p.id!==id});if(id)history.pushState({p:id},'','#'+id);else if(location.hash)history.pushState({},'',location.pathname);scrollTo(0,0)}
addEventListener('popstate',function(){var id=location.hash.slice(1);document.getElementById('home').hidden=!!id;document.querySelectorAll('.pg').forEach(function(p){p.hidden=p.id!==id})});
function tg(id){var d=document.getElementById(id);if(d)d.hidden=!d.hidden}
function out(){var s='';try{s=localStorage.getItem('tt_me')||'';localStorage.removeItem('tt_me')}catch(e){}fetch('/tiktok/me/out',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({sess:s})}).finally(function(){location.href='/tiktok/me'})}
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
  if (/^(?:\/tiktok)?\/me\/(code|verify|page|out)$/.test(route) && req.method === 'POST') {
    let b = req.body; if (!(b && typeof b === 'object' && !Buffer.isBuffer(b))) { try { b = JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : (typeof b === 'string' ? b : (req.rawBody ? req.rawBody.toString('utf8') : '{}'))); } catch (e) { b = {}; } }
    try { res.json(await meRoute(route.split('/').pop(), b || {})); } catch (e) { res.json({ ok: false, error: String((e && e.message) || e).slice(0, 200) }); }
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
      res.status(200).send(personPage(L.who || '', acct, doc.map || {}));
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
  if ((route !== '/data' && route !== '/months' && route !== '/snap' && route !== '/acct' && route !== '/feed' && route !== '/people' && route !== '/peopleSet' && route !== '/issueMail' && route !== '/issueMailTest') || req.method !== 'POST') { res.status(404).json({ ok: false, error: 'Not found' }); return; }
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
      const doc = await fsUpdate(TT_PEOPLE, d => { d = d || {}; d.map = d.map || {}; if (!name && !email) delete d.map[key]; else d.map[key] = { name, email, at: Date.now() }; return d; });
      res.json({ ok: true, result: (doc && doc.map) || {} }); return;
    }
    await assertAccess(body.token);
    if (route === '/people') { const d = (await fsGet(TT_PEOPLE).catch(() => null)) || {}; res.json({ ok: true, result: Object.assign({}, d.map || {}, { _mails: d.mails || {} }) }); return; }
    // v680 email the person who made the ads of an issue (admins; only people linked to a HEMERA profile)
    // v682 a test: the email for one of this person's open issues, sent to the admin who taps it (not to the person)
    if (route === '/issueMailTest') {
      const me = await assertAdmin(body.token);
      if (!me || !me.email) throw new Error('No email for you.');
      const who = String(body.who || '').toLowerCase(), acct = await ttAcct();
      const issue = (acct.issues || []).find(x => !/^yes/i.test(x.fixed) && String(x.by || '').toLowerCase().indexOf(who) >= 0) || (acct.issues || [])[0];
      if (!issue) throw new Error('No open issue to send.');
      if (!notify.mailReady()) throw new Error('Email is not set up on the server yet.');
      const doc = (await fsGet(TT_PEOPLE).catch(() => null)) || {}, m = (doc.map || {})[who] || {}, name = m.name || who.split('@')[0];
      const tok = require('crypto').randomBytes(18).toString('base64url');
      await fsUpdate(TT_LINKS, d => { d = d || {}; const now = Date.now(); Object.keys(d).forEach(k => { if (!d[k] || d[k].exp < now) delete d[k]; }); d[tok] = { key: issueKey(issue), who, exp: now + 14 * 864e5, test: true }; return d; });
      await notify.sendMail({ to: me.email, subject: '[Test] TikTok issue to fix: ' + String(issue.type || 'Issue').slice(0, 80), rawHtml: issueMailHtml(issue, name, 'https://sekna-app.web.app/tiktok/me') });
      res.json({ ok: true, result: { to: me.email, issue: issue.type } }); return;
    }
    if (route === '/issueMail') {
      const me = await assertAdmin(body.token);
      const key = String(body.key || ''), who = String(body.who || '').toLowerCase();
      const acct = await ttAcct(), issue = (acct.issues || []).find(x => issueKey(x) === key);
      if (!issue) throw new Error('This issue is not in the sheet any more.');
      const doc = (await fsGet(TT_PEOPLE).catch(() => null)) || {}, m = (doc.map || {})[who];
      if (!m || !m.email) throw new Error('Link this person to a HEMERA profile first (Account & Policy → Team accounts).');
      if (!notify.mailReady()) throw new Error('Email is not set up on the server yet.');
      const name = m.name || String(m.email).split('@')[0];
      const tok = require('crypto').randomBytes(18).toString('base64url');
      await fsUpdate(TT_LINKS, d => { d = d || {}; const now = Date.now(); Object.keys(d).forEach(k => { if (!d[k] || d[k].exp < now) delete d[k]; }); d[tok] = { key, who, exp: now + 14 * 864e5 }; return d; });
      await notify.sendMail({ to: m.email, replyTo: me && me.email ? me.email : undefined, subject: 'TikTok issue to fix: ' + String(issue.type || 'Issue').slice(0, 80), rawHtml: issueMailHtml(issue, name, 'https://sekna-app.web.app/tiktok/me') });
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

module.exports = { buildTikTokData, buildTikTokMonths, buildTikTokSnap, buildTikTokAcct, buildTikTokFeed, TT_CH, TT_SHEET_ID, fn };
