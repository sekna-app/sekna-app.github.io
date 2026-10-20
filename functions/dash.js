// The dashboard data, read from the same Google Sheets with the same rules as Code.gs
// (getDashboardData and getMonthCompareData). Keep the two in step when one changes.
const { sheetMeta, batchGet, a1 } = require('./google');

const DEFAULT_ACCOUNT_KEY = 'usa';
const ACCOUNTS = {
  usa: {
    key: 'usa', label: 'Human Appeal USA', shortLabel: 'USA', dashboardTitle: 'Media Plan USA',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit',
    sheets: {
      mediaPlan: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit#gid=1930420074',
      month: 'AUTO',
      currentMonth: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit#gid=223665405',
      lastYear: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit#gid=1216781425',
      archive: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit#gid=1216781425',
      history: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit#gid=1713034492',
      bestWorst: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit#gid=3300649'
    }
  },
  ar: {
    key: 'ar', label: 'Human Appeal AR', shortLabel: 'AR', dashboardTitle: 'Media Plan AR',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1uW5nGWhHaBbPpCct1bG0HxQWDFsi_jITdQxG2h-WrBk/edit',
    sheets: {
      mediaPlan: 'https://docs.google.com/spreadsheets/d/1uW5nGWhHaBbPpCct1bG0HxQWDFsi_jITdQxG2h-WrBk/edit#gid=1947816574',
      month: 'https://docs.google.com/spreadsheets/d/1uW5nGWhHaBbPpCct1bG0HxQWDFsi_jITdQxG2h-WrBk/edit#gid=1989614597',
      currentMonth: 'https://docs.google.com/spreadsheets/d/1uW5nGWhHaBbPpCct1bG0HxQWDFsi_jITdQxG2h-WrBk/edit#gid=2089588650',
      lastYear: 'https://docs.google.com/spreadsheets/d/1uW5nGWhHaBbPpCct1bG0HxQWDFsi_jITdQxG2h-WrBk/edit#gid=2020716325'
    }
  }
};

const DASHBOARD_SETTINGS = { START_ROW: 14, END_ROW: 44, REFRESH_SECONDS: 60 };
const MEDIA_PLAN_COLS = {
  WIDTH: 57,
  PLAN_DATE: 0, PLAN_DAY: 1, PLAN_HIJRI: 2, PLAN_CHANNELS: 3,
  PLAN_CLICKS: 8, PLAN_CONV: 9, PLAN_VALUE: 10, PLAN_CPA: 11, PLAN_CVR: 12, PLAN_AOV: 13,
  DATE: 15, DAY: 16, HIJRI: 17, TARGET: 18, SPEND: 19, CLICKS: 20, CONV: 21, VALUE: 22, CPA: 23, CVR: 24, CTR: 25,
  ACH_SPEND: 32, ACH_CLICKS: 33, ACH_CONV: 34, ACH_VALUE: 35,
  LY_DATE: 47, LY_SPEND: 48, LY_VALUE: 49, LY_CONV: 50, LY_CLICKS: 51, LY_IMPR: 52, LY_HAS_DATA: 56
};
const PLAN_CHANNEL_LABELS = ['Search Brand', 'Search Non-Brand', 'Performance Max', 'Demand Gen', 'Video'];
const ARCHIVE_CHANNELS = ['Search Brand', 'Search Non-Brand', 'Performance Max', 'Demand Gen', 'Video (YouTube)'];

/* ---------- Dates ----------
 * A "wall" date keeps the sheet's local date and time in its UTC fields, so it is
 * formatted with UTC getters. That matches Utilities.formatDate(date, sheetTz, …).
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function wallFromInstant(ms, tz) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}

function makeAsDate(tz) {
  return function asDate_(value) {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(Math.round((value - 25569) * 86400 * 1000));
    const s = String(value);
    const d = new Date(s);
    if (!isFinite(d.getTime())) return d;
    // Text with its own zone (or an ISO date) is a fixed moment; other text is local time.
    if (/^\d{4}-\d{2}-\d{2}$/.test(s.trim()) || /(Z|[+-]\d{2}:?\d{2}|GMT|UTC)/i.test(s)) return wallFromInstant(d.getTime(), tz);
    return d;
  };
}

function pad(n, w) { return String(n).padStart(w || 2, '0'); }

function fmt(d, pattern) {
  return pattern.replace(/yyyy|MMMM|MMM|MM|EEEE|EEE|dd|d|HH|mm|ss/g, t => {
    switch (t) {
      case 'yyyy': return String(d.getUTCFullYear());
      case 'MMMM': return MONTHS[d.getUTCMonth()];
      case 'MMM': return MONTHS[d.getUTCMonth()].slice(0, 3);
      case 'MM': return pad(d.getUTCMonth() + 1);
      case 'EEEE': return DAYS[d.getUTCDay()];
      case 'EEE': return DAYS[d.getUTCDay()].slice(0, 3);
      case 'dd': return pad(d.getUTCDate());
      case 'd': return String(d.getUTCDate());
      case 'HH': return pad(d.getUTCHours());
      case 'mm': return pad(d.getUTCMinutes());
      case 'ss': return pad(d.getUTCSeconds());
    }
    return t;
  });
}

function toNumber_(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function safeDiv_(a, b) { return b ? a / b : null; }

/** Rows padded with '' to a fixed width, like getValues() on a range. */
function grid(values, height, width) {
  const out = [];
  for (let i = 0; i < height; i++) {
    const r = (values[i] || []).slice(0, width);
    while (r.length < width) r.push('');
    out.push(r);
  }
  return out;
}

/* ---------- Spreadsheet and tabs ---------- */

function ssIdOf(url) {
  const m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}
function parseGidFromRef_(ref) {
  const text = String(ref || '').trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const m = text.match(/[?#&]gid=(\d+)/i);
  return m ? Number(m[1]) : null;
}

function normalizeAccountKey_(accountKey) {
  const key = String(accountKey || DEFAULT_ACCOUNT_KEY).trim().toLowerCase();
  return ACCOUNTS[key] ? key : DEFAULT_ACCOUNT_KEY;
}

async function openBook(account) {
  const id = ssIdOf(account.spreadsheetUrl);
  let meta;
  try { meta = await sheetMeta(id); }
  catch (e) { throw new Error('Could not open ' + account.label + ' spreadsheet (' + String((e && e.message) || e).slice(0, 120) + '). Check that it is shared with the SEKNA server.'); }
  const book = { id, account, tz: meta.timeZone, meta, resolved: {} };
  book.asDate = makeAsDate(book.tz);
  return book;
}

// The monthly tab found by its layout, remembered for 10 minutes (one read less per request).
const autoMonthCache = {};

/** Same order as getOptionalSheet_: tab link (gid), AUTO layout search, then tab name. */
async function optionalSheet(book, logicalKey) {
  if (Object.prototype.hasOwnProperty.call(book.resolved, logicalKey)) return book.resolved[logicalKey];
  const ref = book.account.sheets && book.account.sheets[logicalKey];
  let found = null;
  const gid = parseGidFromRef_(ref);
  if (gid !== null) found = book.meta.sheets.find(s => s.sheetId === gid) || null;
  if (!found && String(ref || '').toUpperCase() === 'AUTO' && logicalKey === 'month') {
    const hit = autoMonthCache[book.id];
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) found = book.meta.sheets.find(s => s.sheetId === hit.sheetId) || null;
    if (!found) {
      const candidates = book.meta.sheets.filter(s => s.rows >= 22);
      const cells = await batchGet(book.id, candidates.map(s => a1(s.title, 'A22')));
      const i = cells.findIndex(v => String((v[0] || [])[0] || '').trim().toLowerCase() === 'week starting');
      found = i >= 0 ? candidates[i] : null;
      if (found) autoMonthCache[book.id] = { at: Date.now(), sheetId: found.sheetId };
    }
  }
  if (!found && ref && gid === null && String(ref).toUpperCase() !== 'AUTO') found = book.meta.sheets.find(s => s.title === String(ref)) || null;
  book.resolved[logicalKey] = found;
  return found;
}

async function requiredSheet(book, logicalKey) {
  const sh = await optionalSheet(book, logicalKey);
  if (!sh) {
    const ref = book.account.sheets && book.account.sheets[logicalKey];
    throw new Error('Sheet not found for ' + book.account.label + ': ' + logicalKey + ' (' + String(ref || 'not configured') + ')');
  }
  return sh;
}

async function sourceLabel(book, logicalKey) {
  const sh = await optionalSheet(book, logicalKey);
  return sh ? sh.title + ' • gid=' + sh.sheetId : String((book.account.sheets || {})[logicalKey] || '');
}

/** Campaign rows (A2:J, to the last row) of a tab. Read once per request. */
async function campaignRows(book, sh) {
  book.rowsCache = book.rowsCache || {};
  if (!book.rowsCache[sh.sheetId]) {
    book.rowsCache[sh.sheetId] = batchGet(book.id, [a1(sh.title, 'A2:J')]).then(v => grid(v[0], v[0].length, 10));
  }
  return book.rowsCache[sh.sheetId];
}

/** Values with real dates turned into wall Date objects (where Apps Script gives a Date). */
async function valuesWithDates(book, range, height, width) {
  const [serial, text] = await Promise.all([batchGet(book.id, [range]), batchGet(book.id, [range], true)]);
  const s = grid(serial[0], height === undefined ? serial[0].length : height, width);
  const t = grid(text[0], s.length, width);
  return s.map((r, i) => r.map((v, j) => (typeof v === 'number' && typeof t[i][j] === 'string' && t[i][j] !== '' && t[i][j] !== String(v))
    ? new Date(Math.round((v - 25569) * 86400 * 1000)) : v));
}

/* ---------- Dashboard (getDashboardData) ---------- */

async function buildDashboardData(accountKey) {
  const account = ACCOUNTS[normalizeAccountKey_(accountKey)];
  const book = await openBook(account);
  const tz = book.tz, asDate_ = book.asDate;

  const media = await requiredSheet(book, 'mediaPlan');
  const month = await requiredSheet(book, 'month');

  // Every other tab is read at the same time as the Media Plan, not one after another.
  const nowWall = wallFromInstant(Date.now(), tz);
  const early = p => { p.catch(() => {}); return p; };
  const historyP = early(readHistory_(book, fmt(nowWall, 'yyyy-MM')));
  const bestWorstP = early(readBestWorst_(book));
  early(optionalSheet(book, 'currentMonth').then(sh => sh ? campaignRows(book, sh) : null));

  const rowCount = DASHBOARD_SETTINGS.END_ROW - DASHBOARD_SETTINGS.START_ROW + 1;
  const width = Math.min(MEDIA_PLAN_COLS.WIDTH, media.cols);
  const lastCol = colName(width);
  const [mediaVals, b16, b17, e40, e41, e42, weeklyVals, chanVals] = await batchGet(book.id, [
    a1(media.title, `A${DASHBOARD_SETTINGS.START_ROW}:${lastCol}${DASHBOARD_SETTINGS.END_ROW}`),
    a1(month.title, 'B16'), a1(month.title, 'B17'), a1(month.title, 'E40'), a1(month.title, 'E41'), a1(month.title, 'E42'),
    a1(month.title, 'A23:K26'), a1(month.title, 'A46:G50')
  ]);
  const rows = grid(mediaVals, rowCount, width);
  const one = v => (v[0] || [])[0] === undefined ? '' : v[0][0];

  let lastIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][15] && toNumber_(rows[i][19]) > 0) lastIdx = i;
  }
  if (lastIdx < 0) throw new Error(account.shortLabel + ': no actual day with Spend > 0 was found in Media Plan.');

  const r = rows[lastIdx];
  const actualDate = asDate_(r[15]);
  const dateText = fmt(actualDate, 'yyyy-MM-dd');
  const dayNumber = Number(fmt(actualDate, 'd'));
  const monthName = fmt(actualDate, 'MMMM');

  const planClicks = toNumber_(r[8]), planConv = toNumber_(r[9]), planValue = toNumber_(r[10]);
  const targetSpend = toNumber_(r[18]), spend = toNumber_(r[19]), clicks = toNumber_(r[20]);
  const conversions = toNumber_(r[21]), value = toNumber_(r[22]), cpa = toNumber_(r[23]), cvr = toNumber_(r[24]), ctr = toNumber_(r[25]);

  const convAchievement = safeDiv_(conversions, planConv);
  const valueAchievement = safeDiv_(value, planValue);
  const spendAchievement = safeDiv_(spend, targetSpend);

  const ly = hijriLastYearFromRow_(r, asDate_) || await getLastYearDay_(book, actualDate);

  const monthSummary = {
    planSpend: toNumber_(one(b16)),
    planValue: toNumber_(one(b17)),
    actualSpend: toNumber_(one(e40)),
    actualValue: toNumber_(one(e41)),
    actualRoas: toNumber_(one(e42))
  };
  monthSummary.spendAchievement = safeDiv_(monthSummary.actualSpend, monthSummary.planSpend);
  monthSummary.valueAchievement = safeDiv_(monthSummary.actualValue, monthSummary.planValue);

  const fullPlanSpend = monthSummary.planSpend;
  const fullPlanValue = monthSummary.planValue;
  const actualToDateSpend = monthSummary.actualSpend;
  const actualToDateValue = monthSummary.actualValue;
  const actualToDateRoas = monthSummary.actualRoas || safeDiv_(actualToDateValue, actualToDateSpend);
  const fullMonthTargetRoas = safeDiv_(fullPlanValue, fullPlanSpend);
  const budgetRemaining = fullPlanSpend - actualToDateSpend;
  const revenueRemaining = fullPlanValue - actualToDateValue;

  const mtdSummary = {
    planSpend: fullPlanSpend,
    actualSpend: actualToDateSpend,
    spendAchievement: safeDiv_(actualToDateSpend, fullPlanSpend),
    planValue: fullPlanValue,
    actualValue: actualToDateValue,
    valueAchievement: safeDiv_(actualToDateValue, fullPlanValue),
    actualRoas: actualToDateRoas,
    targetRoas: fullMonthTargetRoas,
    roasAchievement: safeDiv_(actualToDateRoas, fullMonthTargetRoas),
    budgetRemaining: budgetRemaining,
    budgetVariancePct: safeDiv_(budgetRemaining, fullPlanSpend),
    revenueRemaining: revenueRemaining
  };

  const weekly = grid(weeklyVals, 4, 11).map((w, i) => {
    const planSpend = toNumber_(w[4]);
    const planValueW = toNumber_(w[5]);
    const actualSpend = toNumber_(w[8]);
    const actualValue = toNumber_(w[9]);
    const actualConversions = toNumber_(w[7]);
    const actualClicks = toNumber_(w[6]);
    const spendAccuracy = toNumber_(w[10]);
    const hasActual = actualSpend > 0 || actualValue > 0 || actualConversions > 0 || actualClicks > 0;
    return {
      week: 'Week ' + (i + 1),
      sourceLabel: String(w[0] || ''),
      days: toNumber_(w[1]),
      planSpend: planSpend,
      planConversions: toNumber_(w[3]),
      planValue: planValueW,
      actualSpend: actualSpend,
      actualValue: actualValue,
      actualConversions: actualConversions,
      actualClicks: actualClicks,
      spendAccuracy: spendAccuracy,
      spendAchievement: safeDiv_(actualSpend, planSpend),
      roas: safeDiv_(actualValue, actualSpend),
      hasActual: hasActual
    };
  });

  const dayActualByChannel = {};
  const actualByChannel = await getChannelActualsForMonth_(book, fmt(actualDate, 'yyyy-MM'), dateText, dayActualByChannel);

  const channels = grid(chanVals, 5, 7)
    .filter(x => x[0])
    .map(x => {
      const channel = String(x[0]);
      const live = actualByChannel[channel] || {};
      const planSpend = toNumber_(x[1]);
      const fallbackSpend = toNumber_(x[2]);
      const planValueC = toNumber_(x[4]);
      const fallbackValue = toNumber_(x[5]);
      const actualSpend = Object.prototype.hasOwnProperty.call(live, 'spend') ? live.spend : fallbackSpend;
      const actualValue = Object.prototype.hasOwnProperty.call(live, 'value') ? live.value : fallbackValue;
      const clicksC = live.clicks || 0;
      const conversionsC = live.conversions || 0;
      const impressions = live.impressions || 0;
      return {
        channel: channel,
        planSpend: planSpend,
        actualSpend: actualSpend,
        spendAchievement: safeDiv_(actualSpend, planSpend),
        clicks: clicksC,
        impressions: impressions,
        conversions: conversionsC,
        planValue: planValueC,
        actualValue: actualValue,
        valueAchievement: safeDiv_(actualValue, planValueC),
        roas: safeDiv_(actualValue, actualSpend),
        cpa: safeDiv_(actualSpend, conversionsC),
        cvr: safeDiv_(conversionsC, clicksC),
        ctr: safeDiv_(clicksC, impressions)
      };
    });

  const daily = rows
    .filter(x => x[15] && toNumber_(x[19]) > 0)
    .map(x => {
      const d = asDate_(x[15]);
      return {
        date: fmt(d, 'MMM d'),
        fullDate: fmt(d, 'yyyy-MM-dd'),
        targetSpend: toNumber_(x[18]),
        planConversions: toNumber_(x[9]),
        planValue: toNumber_(x[10]),
        spend: toNumber_(x[19]),
        clicks: toNumber_(x[20]),
        conversions: toNumber_(x[21]),
        value: toNumber_(x[22]),
        convAchievement: safeDiv_(toNumber_(x[21]), toNumber_(x[9])),
        valueAchievement: safeDiv_(toNumber_(x[22]), toNumber_(x[10])),
        spendAchievement: safeDiv_(toNumber_(x[19]), toNumber_(x[18])),
        roas: safeDiv_(toNumber_(x[22]), toNumber_(x[19])),
        targetRoas: safeDiv_(toNumber_(x[10]), toNumber_(x[18])),
        ctr: toNumber_(x[25])
      };
    })
    .slice(-14);

  const dayPlan = buildDayPlan_(rows, asDate_);
  const dayChannels = buildDayChannels_(dayActualByChannel, dayPlan.filter(d => d.date === dateText)[0]);
  const history = await historyP;
  const bestWorst = await bestWorstP;
  try { await rerankCampaigns_(book, bestWorst); } catch (err) { console.error('Campaign ranking from raw rows failed: ' + err); }
  const bestProjects = bestWorst && bestWorst.best ? bestWorst.best.filter(b => b.key === 'projects')[0] : null;

  return {
    refreshSeconds: DASHBOARD_SETTINGS.REFRESH_SECONDS,
    account: { key: account.key, label: account.label, shortLabel: account.shortLabel, dashboardTitle: account.dashboardTitle },
    userEmail: '',
    source: {
      spreadsheetUrl: account.spreadsheetUrl,
      mediaPlan: await sourceLabel(book, 'mediaPlan'),
      month: await sourceLabel(book, 'month'),
      currentMonth: await sourceLabel(book, 'currentMonth'),
      lastYear: await sourceLabel(book, 'lastYear')
    },
    latest: {
      date: dateText,
      dayNumber: dayNumber,
      monthName: monthName,
      dayName: String(r[16] || ''),
      hijriDate: String(r[17] || ''),
      targetSpend, planClicks, planConversions: planConv, planValue, spend, clicks, conversions, value, cpa, cvr, ctr,
      convAchievement, valueAchievement, spendAchievement
    },
    yoy: {
      mode: ly.mode || 'calendar',
      lyDate: ly.lyDate || '',
      lyLabel: ly.lyLabel || '',
      hasData: ly.hasData !== false,
      spend: ly.spend,
      clicks: ly.clicks,
      impressions: ly.impressions,
      conversions: ly.conversions,
      value: ly.value,
      ctr: ly.ctr,
      convVsLy: safeDiv_(conversions, ly.conversions),
      valueVsLy: safeDiv_(value, ly.value),
      spendDelta: ly.spend ? (spend / ly.spend) - 1 : null,
      ctrDelta: ly.ctr ? (ctr / ly.ctr) - 1 : null
    },
    month: monthSummary,
    mtd: mtdSummary,
    weekly: weekly,
    channels: channels,
    daily: daily,
    dayPlan: dayPlan,
    dayChannels: dayChannels,
    history: history,
    bestWorst: bestWorst,
    topProjects: bestProjects ? bestProjects.rows.slice(0, 3) : [],
    topProjectsDay: bestWorst ? bestWorst.day : '',
    generatedAt: fmt(nowWall, 'yyyy-MM-dd HH:mm:ss')
  };
}

function colName(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function hijriLastYearFromRow_(r, asDate_) {
  const c = MEDIA_PLAN_COLS;
  if (!r || r.length <= c.LY_HAS_DATA || !r[c.LY_DATE]) return null;
  const d = asDate_(r[c.LY_DATE]);
  if (!isFinite(d.getTime())) return null;
  const clicks = toNumber_(r[c.LY_CLICKS]);
  const impressions = toNumber_(r[c.LY_IMPR]);
  return {
    mode: 'hijri',
    lyDate: fmt(d, 'yyyy-MM-dd'),
    lyLabel: fmt(d, 'EEE d MMM yyyy'),
    hasData: toNumber_(r[c.LY_HAS_DATA]) > 0,
    spend: toNumber_(r[c.LY_SPEND]),
    impressions: impressions,
    clicks: clicks,
    conversions: toNumber_(r[c.LY_CONV]),
    value: toNumber_(r[c.LY_VALUE]),
    ctr: safeDiv_(clicks, impressions)
  };
}

function buildDayPlan_(rows, asDate_) {
  const c = MEDIA_PLAN_COLS;
  const days = [];
  rows.forEach(x => {
    const raw = x[c.DATE] || x[c.PLAN_DATE];
    if (!raw) return;
    const d = asDate_(raw);
    if (!isFinite(d.getTime())) return;
    const channels = PLAN_CHANNEL_LABELS.map((label, i) => ({ channel: label, spend: toNumber_(x[c.PLAN_CHANNELS + i]) }));
    const planSpend = channels.reduce((a, b) => a + b.spend, 0);
    const planValue = toNumber_(x[c.PLAN_VALUE]);
    const spend = toNumber_(x[c.SPEND]);
    const clicks = toNumber_(x[c.CLICKS]);
    const conv = toNumber_(x[c.CONV]);
    const value = toNumber_(x[c.VALUE]);
    const live = spend !== 0 || clicks !== 0 || conv !== 0 || value !== 0;
    const target = toNumber_(x[c.TARGET]);
    days.push({
      date: fmt(d, 'yyyy-MM-dd'),
      label: fmt(d, 'MMM d'),
      dayNumber: Number(fmt(d, 'd')),
      dayName: String(x[c.DAY] || x[c.PLAN_DAY] || fmt(d, 'EEEE')),
      hijri: String(x[c.HIJRI] || x[c.PLAN_HIJRI] || ''),
      plan: {
        spend: planSpend,
        channels: channels,
        clicks: toNumber_(x[c.PLAN_CLICKS]),
        conversions: toNumber_(x[c.PLAN_CONV]),
        value: planValue,
        cpa: toNumber_(x[c.PLAN_CPA]),
        cvr: toNumber_(x[c.PLAN_CVR]),
        aov: toNumber_(x[c.PLAN_AOV]),
        roas: safeDiv_(planValue, planSpend)
      },
      actual: live ? {
        target: target,
        spend: spend,
        clicks: clicks,
        conversions: conv,
        value: value,
        cpa: toNumber_(x[c.CPA]),
        cvr: toNumber_(x[c.CVR]),
        ctr: toNumber_(x[c.CTR]),
        roas: safeDiv_(value, spend),
        spendAchievement: toNumber_(x[c.ACH_SPEND]) || safeDiv_(spend, target),
        clicksAchievement: toNumber_(x[c.ACH_CLICKS]) || safeDiv_(clicks, toNumber_(x[c.PLAN_CLICKS])),
        convAchievement: toNumber_(x[c.ACH_CONV]) || safeDiv_(conv, toNumber_(x[c.PLAN_CONV])),
        valueAchievement: toNumber_(x[c.ACH_VALUE]) || safeDiv_(value, planValue)
      } : null
    });
  });
  return days;
}

function channelFromCampaign_(type, campaign) {
  type = String(type || '').trim();
  if (type === 'Search') return /(^|_)Brand(_|$)/i.test(String(campaign || '')) ? 'Search Brand' : 'Search Non-Brand';
  if (type === 'Video') return 'Video (YouTube)';
  return type;
}

async function getChannelActualsForMonth_(book, monthKey, dayKey, dayOut) {
  const add = (out, channel, r) => {
    if (!out[channel]) out[channel] = { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0 };
    out[channel].spend += toNumber_(r[5]);
    out[channel].impressions += toNumber_(r[6]);
    out[channel].clicks += toNumber_(r[7]);
    out[channel].conversions += toNumber_(r[8]);
    out[channel].value += toNumber_(r[9]);
  };
  const sources = ['currentMonth', 'thisYear'].filter(k => book.account.sheets[k]);
  for (let s = 0; s < sources.length; s++) {
    const sh = await optionalSheet(book, sources[s]);
    if (!sh) continue;
    const rows = await campaignRows(book, sh);
    if (!rows.length) continue;
    const out = {};
    let found = false;
    rows.forEach(r => {
      if (!r[0] || !r[1]) return;
      const d = book.asDate(r[0]);
      if (!isFinite(d.getTime()) || fmt(d, 'yyyy-MM') !== monthKey) return;
      found = true;
      const channel = channelFromCampaign_(r[1], r[2]);
      add(out, channel, r);
      if (dayOut && dayKey && fmt(d, 'yyyy-MM-dd') === dayKey) add(dayOut, channel, r);
    });
    if (found) return out;
  }
  try {
    const archive = await getArchiveSummary_(book);
    const day = dayOut && dayKey ? archive.days[dayKey] : null;
    if (day) {
      archive.channels.forEach((ch, i) => {
        if (!day[i * 5] && !day[i * 5 + 4]) return;
        dayOut[ch] = { spend: day[i * 5], impressions: day[i * 5 + 1], clicks: day[i * 5 + 2], conversions: day[i * 5 + 3], value: day[i * 5 + 4] };
      });
    }
    const m = archive.months[monthKey];
    if (m && m.channels) {
      const out = {};
      Object.keys(m.channels).forEach(ch => { out[ch] = Object.assign({ impressions: 0 }, m.channels[ch]); });
      return out;
    }
  } catch (err) {
    console.error('Archive channels unavailable: ' + err);
  }
  return {};
}

function buildDayChannels_(dayActuals, planDay) {
  const order = ARCHIVE_CHANNELS;
  const names = order.concat(Object.keys(dayActuals).filter(n => order.indexOf(n) < 0));
  const planOf = name => {
    const i = order.indexOf(name);
    const c = planDay && i >= 0 ? planDay.plan.channels[i] : null;
    return c ? c.spend : 0;
  };
  return names
    .map(name => {
      const a = dayActuals[name] || {};
      return {
        channel: name,
        spend: a.spend || 0,
        clicks: a.clicks || 0,
        conversions: a.conversions || 0,
        value: a.value || 0,
        planSpend: planOf(name),
        roas: safeDiv_(a.value || 0, a.spend || 0)
      };
    })
    .filter(c => c.spend || c.value)
    .sort((a, b) => (b.roas || 0) - (a.roas || 0));
}

async function readHistory_(book, currentMonthKey) {
  const sh = await optionalSheet(book, 'history');
  if (!sh) return [];
  const rows = await valuesWithDates(book, a1(sh.title, 'A5:F'), undefined, 6);
  const out = [];
  rows.forEach(r => {
    if (!r[0] || r[2] === '' || r[2] === null) return;
    const month = r[0] instanceof Date ? fmt(r[0], 'yyyy-MM') : String(r[0]).trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const cost = toNumber_(r[2]);
    const value = toNumber_(r[3]);
    const conv = toNumber_(r[4]);
    if (!cost && !value && !conv) return;
    out.push({ month, hijri: String(r[1] || ''), cost, value, conversions: conv, roas: toNumber_(r[5]) || safeDiv_(value, cost), partial: month === currentMonthKey });
  });
  return out;
}

async function readBestWorst_(book) {
  const sh = await optionalSheet(book, 'bestWorst');
  if (!sh) return null;
  const raw = await valuesWithDates(book, a1(sh.title, 'A1:T'), undefined, 20);
  if (raw.length < 8) return null;
  // Padded to A:T; the empty cells past the last used column change nothing below.
  const values = raw;
  const cell = v => v instanceof Date ? fmt(v, 'yyyy-MM-dd') : String(v === null ? '' : v).trim();

  const out = {
    account: cell(values[1][2]),
    day: cell(values[2][2]),
    rankBy: cell(values[3][2]) || 'ROAS',
    updated: values[4][2] instanceof Date ? fmt(values[4][2], 'yyyy-MM-dd HH:mm') : cell(values[4][2]),
    best: [],
    worst: []
  };

  let section = null, block = null;
  for (let i = 5; i < values.length; i++) {
    const r = values[i];
    const a = cell(r[0]);
    const isBlockTitle = /^(🏆|🚨)/.test(a) || /^(Top|Worst) 5 /.test(a.replace(/^[^A-Za-z]+/, ''));
    if (!isBlockTitle && /\bBEST 5\b/.test(a)) { section = 'best'; block = null; continue; }
    if (!isBlockTitle && /\bWORST 5\b/.test(a)) { section = 'worst'; block = null; continue; }
    if (!section) continue;
    if (isBlockTitle) {
      const title = a.replace(/^[^A-Za-z]+/, '').replace(/\s*\(Min spend[^)]*\)/i, '').trim();
      const min = a.match(/Min spend\s*£?\s*([\d,.]+)/i);
      block = { key: bestWorstKey_(title), title, minSpend: min ? toNumber_(min[1].replace(/,/g, '')) : null, headers: [], rows: [], total: null, message: '' };
      out[section].push(block);
      continue;
    }
    if (!block) continue;
    if (a === '#') { block.headers = r.map(cell).filter(h => h !== ''); continue; }
    if (!block.headers.length) continue;
    const b = cell(r[1]);
    if (b.toLowerCase() === 'total') block.total = bestWorstRow_(block.headers, r, cell);
    else if (a !== '' && isFinite(Number(a))) block.rows.push(bestWorstRow_(block.headers, r, cell));
    else if (a === '' && b && !block.rows.length) block.message = b;
  }
  return out;
}

function bestWorstKey_(title) {
  const t = title.toLowerCase();
  if (/project|landing/.test(t)) return 'projects';
  if (/asset group/.test(t)) return 'assetGroups';
  if (/ad group/.test(t)) return 'adGroups';
  if (/search term/.test(t)) return 'searchTerms';
  if (/keyword/.test(t)) return 'keywords';
  if (/campaign/.test(t)) return 'campaigns';
  if (/\bads?\b/.test(t)) return 'ads';
  return t.replace(/[^a-z]+/g, '');
}

function bestWorstRow_(headers, r, cell) {
  const row = { rank: toNumber_(r[0]) || null, name: '', details: [], split: [] };
  headers.forEach((h, i) => {
    if (i === 0) return;
    const v = r[i];
    const key = h.toLowerCase();
    if (i === 1) { row.name = cell(v); return; }
    if (key === 'spend' || key === 'total spend') row.spend = toNumber_(v);
    else if (key === 'conv.' || key === 'conversions') row.conversions = toNumber_(v);
    else if (key === 'value') row.value = toNumber_(v);
    else if (key === 'roas') row.roas = toNumber_(v);
    else if (/ spend$/.test(key)) row.split.push({ label: h.replace(/ Spend$/i, ''), spend: toNumber_(v) });
    else if (cell(v) !== '') row.details.push({ label: h, value: cell(v) });
  });
  return row;
}

async function rerankCampaigns_(book, bw) {
  if (!bw || !bw.day) return;
  const sh = await optionalSheet(book, 'currentMonth');
  if (!sh) return;
  const rows = await campaignRows(book, sh);
  if (!rows.length) return;
  const byName = {};
  let daySpend = 0;
  rows.forEach(r => {
    if (!r[0] || !r[2]) return;
    const d = book.asDate(r[0]);
    if (!isFinite(d.getTime()) || fmt(d, 'yyyy-MM-dd') !== bw.day) return;
    const name = String(r[2]).trim();
    const o = byName[name] || (byName[name] = { name, spend: 0, conversions: 0, value: 0 });
    o.spend += toNumber_(r[5]);
    o.conversions += toNumber_(r[8]);
    o.value += toNumber_(r[9]);
    daySpend += toNumber_(r[5]);
  });
  const items = Object.keys(byName).map(k => byName[k]).filter(o => o.spend > 0);
  if (!items.length) return;
  items.forEach(o => { o.roas = safeDiv_(o.value, o.spend); });
  const minSpend = Math.ceil(Math.max(50, daySpend * 0.02));
  const best = items.filter(o => o.spend >= minSpend && o.conversions >= 2).sort((a, b) => b.roas - a.roas).slice(0, 5);
  const worst = items.filter(o => o.spend >= minSpend && o.value < o.spend)
    .sort((a, b) => (b.spend - b.value) - (a.spend - a.value)).slice(0, 5);
  const block = (list, title, note) => {
    const total = list.reduce((t, o) => ({ spend: t.spend + o.spend, conversions: t.conversions + o.conversions, value: t.value + o.value }), { spend: 0, conversions: 0, value: 0 });
    return {
      key: 'campaigns', title, minSpend, rankNote: note,
      headers: ['#', 'Campaign', 'Spend', 'Conv.', 'Value', 'ROAS'],
      rows: list.map((o, i) => ({ rank: i + 1, name: o.name, details: [], split: [], spend: o.spend, conversions: o.conversions, value: o.value, roas: o.roas })),
      total: list.length ? { rank: null, name: 'Total', details: [], split: [], spend: total.spend, conversions: total.conversions, value: total.value, roas: safeDiv_(total.value, total.spend) } : null,
      message: ''
    };
  };
  const swap = (list, b) => {
    const i = list.findIndex(x => x.key === 'campaigns');
    if (i >= 0) list[i] = Object.assign(b, { title: list[i].title || b.title });
    else list.unshift(b);
  };
  swap(bw.best, block(best, 'Top 5 Campaigns', 'Best ROAS · 2+ conv.'));
  swap(bw.worst, block(worst, 'Worst 5 Campaigns', 'Most money lost'));
}

async function getLastYearDay_(book, currentDate) {
  const sh = await requiredSheet(book, 'lastYear');
  const rows = await campaignRows(book, sh);
  if (!rows.length) return emptyLy_();
  const lyDate = new Date(currentDate.getTime());
  lyDate.setUTCFullYear(lyDate.getUTCFullYear() - 1);
  const target = fmt(lyDate, 'yyyy-MM-dd');
  let spend = 0, impressions = 0, clicks = 0, conversions = 0, value = 0, found = false;
  rows.forEach(r => {
    if (!r[0]) return;
    const d = book.asDate(r[0]);
    if (!isFinite(d.getTime()) || fmt(d, 'yyyy-MM-dd') !== target) return;
    found = true;
    spend += toNumber_(r[5]); impressions += toNumber_(r[6]); clicks += toNumber_(r[7]);
    conversions += toNumber_(r[8]); value += toNumber_(r[9]);
  });
  if (!found) return emptyLy_();
  return { spend, impressions, clicks, conversions, value, ctr: safeDiv_(clicks, impressions) };
}

function emptyLy_() {
  return { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0, ctr: 0 };
}

/* ---------- Month history (getMonthCompareData) ---------- */

function aggregateCampaignRows_(rows, asDate_, channels) {
  const months = {}, days = {};
  rows.forEach(r => {
    if (!r[0] || !r[1]) return;
    const d = asDate_(r[0]);
    if (!isFinite(d.getTime())) return;
    const mk = fmt(d, 'yyyy-MM');
    const dk = fmt(d, 'yyyy-MM-dd');
    const m = months[mk] || (months[mk] = { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0, days: {}, channels: {} });
    const ch = channelFromCampaign_(r[1], r[2]);
    const c = m.channels[ch] || (m.channels[ch] = { spend: 0, clicks: 0, conversions: 0, value: 0 });
    const spend = toNumber_(r[5]), impr = toNumber_(r[6]), clicks = toNumber_(r[7]), conv = toNumber_(r[8]), value = toNumber_(r[9]);
    m.spend += spend; m.impressions += impr; m.clicks += clicks; m.conversions += conv; m.value += value;
    c.spend += spend; c.clicks += clicks; c.conversions += conv; c.value += value;
    m.days[dk] = 1;
    let ci = channels.indexOf(ch);
    if (ci < 0) { channels.push(ch); ci = channels.length - 1; }
    const day = days[dk] || (days[dk] = []);
    while (day.length < (ci + 1) * 5) day.push(0);
    day[ci * 5] += spend; day[ci * 5 + 1] += impr; day[ci * 5 + 2] += clicks; day[ci * 5 + 3] += conv; day[ci * 5 + 4] += value;
  });
  Object.keys(months).forEach(mk => { months[mk].days = Object.keys(months[mk].days).length; });
  Object.keys(days).forEach(dk => { days[dk] = days[dk].map(v => Math.round(v * 100) / 100); });
  return { months, days };
}

// The archive is large and changes once a month, so its summary is kept for 30 minutes.
const archiveCache = {};
const ARCHIVE_TTL = 30 * 60 * 1000;

async function getArchiveSummary_(book) {
  const empty = { channels: ARCHIVE_CHANNELS.slice(), months: {}, days: {}, sheetId: 0 };
  const sh = await optionalSheet(book, book.account.sheets.archive ? 'archive' : 'lastYear');
  if (!sh) return empty;
  const key = book.id + ':' + sh.sheetId;
  const hit = archiveCache[key];
  if (hit && Date.now() - hit.at < ARCHIVE_TTL) return hit.summary;
  const rows = await campaignRows(book, sh);
  if (!rows.length) return empty;
  const channels = ARCHIVE_CHANNELS.slice();
  const part = aggregateCampaignRows_(rows, book.asDate, channels);
  const summary = { channels, months: part.months, days: part.days, sheetId: sh.sheetId };
  archiveCache[key] = { at: Date.now(), summary };
  return summary;
}

async function getMonthCompareData(accountKey) {
  const account = ACCOUNTS[normalizeAccountKey_(accountKey)];
  const book = await openBook(account);
  const archive = await getArchiveSummary_(book);
  const channels = archive.channels.slice();
  const months = Object.assign({}, archive.months);
  const days = Object.assign({}, archive.days);

  for (const logical of ['thisYear', 'currentMonth']) {
    const sh = await optionalSheet(book, logical);
    if (!sh) continue;
    if (archive.sheetId && sh.sheetId === archive.sheetId) continue;
    const rows = await campaignRows(book, sh);
    if (!rows.length) continue;
    const part = aggregateCampaignRows_(rows, book.asDate, channels);
    Object.keys(part.months).forEach(mk => {
      months[mk] = part.months[mk];
      Object.keys(days).forEach(dk => { if (dk.slice(0, 7) === mk) delete days[dk]; });
    });
    Object.keys(part.days).forEach(dk => { days[dk] = part.days[dk]; });
  }
  return { months, channels, days, generatedAt: fmt(wallFromInstant(Date.now(), book.tz), 'yyyy-MM-dd HH:mm') };
}

function forgetArchive() { Object.keys(archiveCache).forEach(k => delete archiveCache[k]); }

module.exports = { ACCOUNTS, buildDashboardData, getMonthCompareData, normalizeAccountKey_, fmt, wallFromInstant, makeAsDate, grid, toNumber_,
  ssIdOf, openBook, optionalSheet, forgetArchive };
