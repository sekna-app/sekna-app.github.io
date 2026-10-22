/**
 * Media Plan — Multi-account Live Dashboard
 *
 * Account sources are configured by spreadsheet URL.
 * Sheet tabs are resolved once and their stable GIDs are cached in Script Properties,
 * so renaming a tab later will not break the dashboard.
 */

const DEFAULT_ACCOUNT_KEY = 'usa';

const ACCOUNTS = {
  usa: {
    key: 'usa',
    label: 'Human Appeal USA',
    shortLabel: 'USA',
    dashboardTitle: 'Media Plan USA',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit',
    // Direct tab URLs / GIDs are used instead of tab names, so renaming tabs will not break the dashboard.
    // month: the monthly forecast tab (today "Oct-2026"). It is found automatically by its
    // "Week Starting" header in A22; paste its tab link here to pin it instead.
    sheets: {
      mediaPlan: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit#gid=1930420074',
      month: 'AUTO',
      currentMonth: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit#gid=223665405',
      lastYear: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit#gid=1216781425',
      // Every closed month (the "2025-Campaign type" tab). At the end of a month, Media Plan Lab
      // moves the complete month here from the current month tab.
      archive: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit#gid=1216781425',
      history: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit#gid=1713034492',
      bestWorst: 'https://docs.google.com/spreadsheets/d/1r44q__HyItuJWYHO8DacforL1Pd-f9CpmC5NRA_xGxc/edit#gid=3300649'
    }
  },
  ar: {
    key: 'ar',
    label: 'Human Appeal AR',
    shortLabel: 'AR',
    dashboardTitle: 'Media Plan AR',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1HC4oy1km_W7un_C9N2q-YVamiGTRzhiVTHlbFhIiT_c/edit',
    // Same layout as USA. Tabs by link (GID), so renaming them later is safe.
    sheets: {
      mediaPlan: 'https://docs.google.com/spreadsheets/d/1HC4oy1km_W7un_C9N2q-YVamiGTRzhiVTHlbFhIiT_c/edit#gid=412916944',
      month: 'AUTO',
      currentMonth: 'https://docs.google.com/spreadsheets/d/1HC4oy1km_W7un_C9N2q-YVamiGTRzhiVTHlbFhIiT_c/edit#gid=931555565',
      lastYear: 'https://docs.google.com/spreadsheets/d/1HC4oy1km_W7un_C9N2q-YVamiGTRzhiVTHlbFhIiT_c/edit#gid=554156069',
      archive: 'https://docs.google.com/spreadsheets/d/1HC4oy1km_W7un_C9N2q-YVamiGTRzhiVTHlbFhIiT_c/edit#gid=554156069',
      history: 'https://docs.google.com/spreadsheets/d/1HC4oy1km_W7un_C9N2q-YVamiGTRzhiVTHlbFhIiT_c/edit#gid=1926854839',
      bestWorst: 'https://docs.google.com/spreadsheets/d/1HC4oy1km_W7un_C9N2q-YVamiGTRzhiVTHlbFhIiT_c/edit#gid=1295411279'
    }
  }
};

const DASHBOARD_SETTINGS = {
  START_ROW: 14,
  END_ROW: 44,
  REFRESH_SECONDS: 60
};

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.access === 'review') return renderAccessReviewPage_(params);

  const accountKey = normalizeAccountKey_(params.account || DEFAULT_ACCOUNT_KEY);

  // Lightweight JSON endpoint. It now requires an approved access token.
  if (String(params.api || '').toLowerCase() === 'latest') {
    if (!checkAccessToken_(params.token).ok) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const d = getDashboardData(accountKey, false, params.token);
    const x = d.latest || {};
    return ContentService.createTextOutput(JSON.stringify({
      ok: true,
      account: d.account || {},
      latest: {
        date: x.date || '',
        dayNumber: Number(x.dayNumber) || 0,
        monthName: x.monthName || '',
        spend: Number(x.spend) || 0,
        conversions: Number(x.conversions) || 0,
        value: Number(x.value) || 0
      },
      generatedAt: d.generatedAt || '',
      generatedAtMs: d.generatedAtMs || 0
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('SEKNA')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Small JSON endpoint for the Android app. While a device waits for approval the app
 * asks here (in the background) and shows a SEKNA notification once access is granted.
 * The token travels in the POST body, never in the URL.
 */
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  let result = { ok: false };
  if (body.action === 'status') {
    const a = checkAccessToken_(body.token);
    result = { ok: true, status: a.status || 'Unknown', name: a.name || '' };
  } else if (body.action === 'call') {
    result = callWebApi_(String(body.fn || ''), Array.isArray(body.args) ? body.args : []);
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * The SEKNA web page (sekna-app.github.io) calls the same functions the dashboard
 * already uses through google.script.run. Only this list can be called, and each
 * function keeps its own access-token / admin checks.
 */
function callWebApi_(name, args) {
  const allowed = {
    getDashboardData: getDashboardData,
    getMonthCompareData: getMonthCompareData,
    adminArchiveStatus: adminArchiveStatus,
    adminArchiveMove: adminArchiveMove,
    accessRequestCode: accessRequestCode,
    accessVerifyCode: accessVerifyCode,
    accessStatus: accessStatus,
    accessSignOut: accessSignOut,
    adminOverview: adminOverview,
    adminSetStatus: adminSetStatus,
    adminInvite: adminInvite,
    adminDelete: adminDelete,
    adminGetAppState: adminGetAppState,
    adminSetMaintenance: adminSetMaintenance,
    adminPublishAnnouncement: adminPublishAnnouncement,
    adminClearAnnouncement: adminClearAnnouncement,
    webPushSubscribe: webPushSubscribe,
    adminReportRecipients: adminReportRecipients,
    adminSendMonthlyReport: adminSendMonthlyReport,
    logShare: logShare,
    adminShareStats: adminShareStats,
    adminResetShares: adminResetShares,
    logUsage: logUsage,
    adminActivity: adminActivity,
    adminResetActivity: adminResetActivity,
    submitIdea: submitIdea,
    myIdeas: myIdeas,
    adminIdeas: adminIdeas,
    adminIdeaUpdate: adminIdeaUpdate,
    adminSavePlanHistory: adminSavePlanHistory,
    getPlanHistory: getPlanHistory,
    reportServerEvent: reportServerEvent,
    adminServerEvents: adminServerEvents,
    notifyServerSwitch: notifyServerSwitch,
    adminClearServerEvents: adminClearServerEvents,
    adminClearRecent: adminClearRecent,
    adminSetMember: adminSetMember,
    tasksLoad: tasksLoad,
    taskSave: taskSave,
    taskDelete: taskDelete,
    taskDone: taskDone,
    tasksCopyMonth: tasksCopyMonth,
    tasksSendWeek: tasksSendWeek,
    leaveFreezeSet: leaveFreezeSet,
    teamStatus: teamStatus,
    tasksExportProps: tasksExportProps,
    accessExportProps: accessExportProps,
    restExportProps: restExportProps,
    relaySend: relaySend
  };
  if (!Object.prototype.hasOwnProperty.call(allowed, name)) return { ok: false, error: 'Unknown request.' };
  try {
    return { ok: true, result: allowed[name].apply(null, args.slice(0, 6)) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

const DASHBOARD_CACHE_SECONDS = 25;

function getDashboardData(accountKey, forceFresh, accessToken) {
  const who = assertAccess_(accessToken);
  if (getAppState_().maintenance.on && !isAdminEmail_(who.email)) throw new Error('SEKNA_MAINTENANCE');
  const key = normalizeAccountKey_(accountKey);
  const cache = CacheService.getScriptCache();
  const cacheKey = 'MEDIA_PLAN_DASH_V83_' + key.toUpperCase();

  if (!forceFresh) {
    try {
      const cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (e) {}
  }

  const data = buildDashboardData_(key);
  try {
    cache.put(cacheKey, JSON.stringify(data), DASHBOARD_CACHE_SECONDS);
  } catch (e) {}
  return data;
}

function buildDashboardData_(accountKey) {
  const account = getAccountConfig_(accountKey);
  const ss = getSpreadsheet_(account);
  const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Muscat';

  const media = getRequiredSheet_(ss, account, 'mediaPlan');
  const month = getRequiredSheet_(ss, account, 'month');

  const rowCount = DASHBOARD_SETTINGS.END_ROW - DASHBOARD_SETTINGS.START_ROW + 1;
  const rows = media.getRange(DASHBOARD_SETTINGS.START_ROW, 1, rowCount, Math.min(MEDIA_PLAN_COLS.WIDTH, media.getMaxColumns())).getValues();

  let lastIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const date = rows[i][15];      // P
    const spend = toNumber_(rows[i][19]); // T
    if (date && spend > 0) lastIdx = i;
  }
  if (lastIdx < 0) throw new Error('No actual day with Spend > 0 was found in Media Plan.');

  const r = rows[lastIdx];
  const actualDate = asDate_(r[15]);
  const dateText = Utilities.formatDate(actualDate, tz, 'yyyy-MM-dd');
  const dayNumber = Number(Utilities.formatDate(actualDate, tz, 'd'));
  const monthName = Utilities.formatDate(actualDate, tz, 'MMMM');

  // Daily plan
  const planClicks = toNumber_(r[8]);       // I
  const planConv = toNumber_(r[9]);         // J
  const planValue = toNumber_(r[10]);       // K

  // Daily actuals
  const targetSpend = toNumber_(r[18]);     // S
  const spend = toNumber_(r[19]);           // T
  const clicks = toNumber_(r[20]);          // U
  const conversions = toNumber_(r[21]);     // V
  const value = toNumber_(r[22]);           // W
  const cpa = toNumber_(r[23]);             // X
  const cvr = toNumber_(r[24]);             // Y
  const ctr = toNumber_(r[25]);             // Z

  const convAchievement = safeDiv_(conversions, planConv);
  const valueAchievement = safeDiv_(value, planValue);
  const spendAchievement = safeDiv_(spend, targetSpend);

  // Same Hijri day last year comes from the Media Plan helper columns (AV:BE).
  // Sheets without those columns fall back to the same calendar date.
  const ly = hijriLastYearFromRow_(r, tz) || getLastYearDay_(ss, actualDate, tz, account);

  const monthSummary = {
    planSpend: toNumber_(month.getRange('B16').getValue()),
    planValue: toNumber_(month.getRange('B17').getValue()),
    actualSpend: toNumber_(month.getRange('E40').getValue()),
    actualValue: toNumber_(month.getRange('E41').getValue()),
    actualRoas: toNumber_(month.getRange('E42').getValue())
  };
  monthSummary.spendAchievement = safeDiv_(monthSummary.actualSpend, monthSummary.planSpend);
  monthSummary.valueAchievement = safeDiv_(monthSummary.actualValue, monthSummary.planValue);


  // Month performance: compare cumulative actuals through the latest updated day
  // against the FULL-MONTH plan. The plan stays fixed for the whole month.
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

  // Weekly Forecast & Tracker (rows 23:26 in the monthly plan sheet).
  // A: Week label, B: Days, C:F plan metrics, G:J actual metrics, K: Spend Accuracy.
  const weeklyRows = month.getRange('A23:K26').getValues();
  const weekly = weeklyRows.map((w, i) => {
    const planSpend = toNumber_(w[4]);
    const planValue = toNumber_(w[5]);
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
      planValue: planValue,
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

  // Month-to-date channel plan + actuals.
  const channelPlanRows = month.getRange('A46:G50').getValues();
  const dayActualByChannel = {};
  const actualByChannel = getChannelActualsForMonth_(ss, account, Utilities.formatDate(actualDate, tz, 'yyyy-MM'), tz, dateText, dayActualByChannel);

  const channels = channelPlanRows
    .filter(x => x[0])
    .map(x => {
      const channel = String(x[0]);
      const live = actualByChannel[channel] || {};
      const planSpend = toNumber_(x[1]);
      const fallbackSpend = toNumber_(x[2]);
      const planValue = toNumber_(x[4]);
      const fallbackValue = toNumber_(x[5]);

      const actualSpend = live.hasOwnProperty('spend') ? live.spend : fallbackSpend;
      const actualValue = live.hasOwnProperty('value') ? live.value : fallbackValue;
      const clicks = live.clicks || 0;
      const conversions = live.conversions || 0;
      const impressions = live.impressions || 0;

      return {
        channel: channel,
        planSpend: planSpend,
        actualSpend: actualSpend,
        spendAchievement: safeDiv_(actualSpend, planSpend),
        clicks: clicks,
        impressions: impressions,
        conversions: conversions,
        planValue: planValue,
        actualValue: actualValue,
        valueAchievement: safeDiv_(actualValue, planValue),
        roas: safeDiv_(actualValue, actualSpend),
        cpa: safeDiv_(actualSpend, conversions),
        cvr: safeDiv_(conversions, clicks),
        ctr: safeDiv_(clicks, impressions)
      };
    });

  // Keep recent actual days for top-card mini trend if needed.
  const daily = rows
    .filter(x => x[15] && toNumber_(x[19]) > 0)
    .map(x => {
      const d = asDate_(x[15]);
      return {
        date: Utilities.formatDate(d, tz, 'MMM d'),
        fullDate: Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
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

  const dayPlan = buildDayPlan_(rows, tz);
  const dayChannels = buildDayChannels_(dayActualByChannel, dayPlan.filter(d => d.date === dateText)[0]);
  const history = readHistory_(ss, account, tz, Utilities.formatDate(new Date(), tz, 'yyyy-MM'));
  const bestWorst = readBestWorst_(ss, account, tz);
  try { rerankCampaigns_(ss, account, tz, bestWorst); } catch (err) { console.error('Campaign ranking from raw rows failed: ' + err); }
  const bestProjects = bestWorst && bestWorst.best ? bestWorst.best.filter(b => b.key === 'projects')[0] : null;

  const email = Session.getActiveUser().getEmail() || '';

  return {
    refreshSeconds: DASHBOARD_SETTINGS.REFRESH_SECONDS,
    account: {
      key: account.key,
      label: account.label,
      shortLabel: account.shortLabel,
      dashboardTitle: account.dashboardTitle
    },
    userEmail: email,
    source: {
      spreadsheetUrl: account.spreadsheetUrl,
      mediaPlan: getSheetSourceLabel_(ss, account, 'mediaPlan'),
      month: getSheetSourceLabel_(ss, account, 'month'),
      currentMonth: getSheetSourceLabel_(ss, account, 'currentMonth'),
      lastYear: getSheetSourceLabel_(ss, account, 'lastYear')
    },
    latest: {
      date: dateText,
      dayNumber: dayNumber,
      monthName: monthName,
      dayName: String(r[16] || ''),
      hijriDate: String(r[17] || ''),
      targetSpend: targetSpend,
      planClicks: planClicks,
      planConversions: planConv,
      planValue: planValue,
      spend: spend,
      clicks: clicks,
      conversions: conversions,
      value: value,
      cpa: cpa,
      cvr: cvr,
      ctr: ctr,
      convAchievement: convAchievement,
      valueAchievement: valueAchievement,
      spendAchievement: spendAchievement
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
    generatedAt: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss'),
    generatedAtMs: Date.now()
  };
}

/**
 * Media Plan columns (rows 14:44). Plan block A:N, results block P:Z,
 * achievement AG:AJ and the "same Hijri day last year" helpers AV:BE.
 */
const MEDIA_PLAN_COLS = {
  WIDTH: 57,
  PLAN_DATE: 0, PLAN_DAY: 1, PLAN_HIJRI: 2, PLAN_CHANNELS: 3, // D:H
  PLAN_CLICKS: 8, PLAN_CONV: 9, PLAN_VALUE: 10, PLAN_CPA: 11, PLAN_CVR: 12, PLAN_AOV: 13,
  DATE: 15, DAY: 16, HIJRI: 17, TARGET: 18, SPEND: 19, CLICKS: 20, CONV: 21, VALUE: 22, CPA: 23, CVR: 24, CTR: 25,
  ACH_SPEND: 32, ACH_CLICKS: 33, ACH_CONV: 34, ACH_VALUE: 35,
  LY_DATE: 47, LY_SPEND: 48, LY_VALUE: 49, LY_CONV: 50, LY_CLICKS: 51, LY_IMPR: 52, LY_HAS_DATA: 56
};
const PLAN_CHANNEL_LABELS = ['Search Brand', 'Search Non-Brand', 'Performance Max', 'Demand Gen', 'Video'];

function hijriLastYearFromRow_(r, tz) {
  const c = MEDIA_PLAN_COLS;
  if (!r || r.length <= c.LY_HAS_DATA || !r[c.LY_DATE]) return null;
  const d = asDate_(r[c.LY_DATE]);
  if (!isFinite(d.getTime())) return null;
  const clicks = toNumber_(r[c.LY_CLICKS]);
  const impressions = toNumber_(r[c.LY_IMPR]);
  return {
    mode: 'hijri',
    lyDate: Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
    lyLabel: Utilities.formatDate(d, tz, 'EEE d MMM yyyy'),
    hasData: toNumber_(r[c.LY_HAS_DATA]) > 0,
    spend: toNumber_(r[c.LY_SPEND]),
    impressions: impressions,
    clicks: clicks,
    conversions: toNumber_(r[c.LY_CONV]),
    value: toNumber_(r[c.LY_VALUE]),
    ctr: safeDiv_(clicks, impressions)
  };
}

/** Every day of the selected month: the plan block and the results block side by side. */
function buildDayPlan_(rows, tz) {
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
      date: Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
      label: Utilities.formatDate(d, tz, 'MMM d'),
      dayNumber: Number(Utilities.formatDate(d, tz, 'd')),
      dayName: String(x[c.DAY] || x[c.PLAN_DAY] || Utilities.formatDate(d, tz, 'EEEE')),
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

/**
 * Channel actuals for one month ("yyyy-MM"). The current month tab is used when it
 * holds that month; otherwise the 2026 campaign tab is read (for a past month
 * picked in the forecast tab's month selector).
 */
function getChannelActualsForMonth_(ss, account, monthKey, tz, dayKey, dayOut) {
  const add = (out, channel, r) => {
    if (!out[channel]) out[channel] = { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0 };
    out[channel].spend += toNumber_(r[5]);
    out[channel].impressions += toNumber_(r[6]);
    out[channel].clicks += toNumber_(r[7]);
    out[channel].conversions += toNumber_(r[8]);
    out[channel].value += toNumber_(r[9]);
  };
  const sources = ['currentMonth', 'thisYear'].filter(k => account.sheets[k]);
  for (let s = 0; s < sources.length; s++) {
    const sh = getOptionalSheet_(ss, account, sources[s]);
    if (!sh || sh.getLastRow() < 2) continue;
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues();
    const out = {};
    let found = false;
    rows.forEach(r => {
      if (!r[0] || !r[1]) return;
      const d = asDate_(r[0]);
      if (!isFinite(d.getTime()) || Utilities.formatDate(d, tz, 'yyyy-MM') !== monthKey) return;
      found = true;
      const channel = channelFromCampaign_(r[1], r[2]);
      add(out, channel, r);
      // The same pass also collects one day (the dashboard's latest day) when asked.
      if (dayOut && dayKey && Utilities.formatDate(d, tz, 'yyyy-MM-dd') === dayKey) add(dayOut, channel, r);
    });
    if (found) return out;
  }
  // A closed month: take it from the archive summary (no impressions there).
  try {
    const archive = getArchiveSummary_(ss, account, tz);
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

/**
 * The latest day by campaign type: actuals from the campaign rows, plan spend from
 * that day's Media Plan row. Ranked by ROAS, best first.
 */
function buildDayChannels_(dayActuals, planDay) {
  const order = ['Search Brand', 'Search Non-Brand', 'Performance Max', 'Demand Gen', 'Video (YouTube)'];
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

/** History tab: one row per month (A Month, B Hijri, C Cost, D Value, E Conv, F ROAS) from row 5. */
function readHistory_(ss, account, tz, currentMonthKey) {
  const sh = getOptionalSheet_(ss, account, 'history');
  if (!sh || sh.getLastRow() < 5) return [];
  const rows = sh.getRange(5, 1, sh.getLastRow() - 4, 6).getValues();
  const out = [];
  rows.forEach(r => {
    if (!r[0] || r[2] === '' || r[2] === null) return;
    const month = r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM') : String(r[0]).trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const cost = toNumber_(r[2]);
    const value = toNumber_(r[3]);
    const conv = toNumber_(r[4]);
    if (!cost && !value && !conv) return;
    out.push({
      month: month,
      hijri: String(r[1] || ''),
      cost: cost,
      value: value,
      conversions: conv,
      roas: toNumber_(r[5]) || safeDiv_(value, cost),
      partial: month === currentMonthKey
    });
  });
  return out;
}

/**
 * Best & Worst 5 tab. Each block is a title in column A (🏆 / 🚨), a header row
 * starting with "#", up to five ranked rows, then a "Total" row in column B —
 * or a single message row when nothing qualified.
 */
function readBestWorst_(ss, account, tz) {
  const sh = getOptionalSheet_(ss, account, 'bestWorst');
  if (!sh || sh.getLastRow() < 8) return null;
  const values = sh.getRange(1, 1, sh.getLastRow(), Math.min(Math.max(sh.getLastColumn(), 10), 20)).getValues();
  const cell = v => v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v === null ? '' : v).trim();

  const out = {
    account: cell(values[1][2]),
    day: cell(values[2][2]),
    rankBy: cell(values[3][2]) || 'ROAS',
    updated: values[4][2] instanceof Date ? Utilities.formatDate(values[4][2], tz, 'yyyy-MM-dd HH:mm') : cell(values[4][2]),
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
      block = { key: bestWorstKey_(title), title: title, minSpend: min ? toNumber_(min[1].replace(/,/g, '')) : null, headers: [], rows: [], total: null, message: '' };
      out[section].push(block);
      continue;
    }
    if (!block) continue;

    if (a === '#') {
      block.headers = r.map(cell).filter(h => h !== '');
      continue;
    }
    if (!block.headers.length) continue;

    const b = cell(r[1]);
    if (b.toLowerCase() === 'total') {
      block.total = bestWorstRow_(block.headers, r, cell);
    } else if (a !== '' && isFinite(Number(a))) {
      block.rows.push(bestWorstRow_(block.headers, r, cell));
    } else if (a === '' && b && !block.rows.length) {
      block.message = b;
    }
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

/**
 * Month and day history built from the daily campaign tabs: the archive (every closed
 * month since 2022), the 2026 tab and the current month tab. Clicks, impressions and
 * the channel split per month, plus every single day so the Month Report can show any
 * months or days the user picks. Loaded only when that tab opens, cached 30 min.
 *
 * days["yyyy-MM-dd"] holds 5 numbers per channel, in the order of `channels`:
 * spend, impressions, clicks, conversions, value.
 *
 * The archive is large, so its summary is saved once in a small Drive file and only
 * rebuilt when the archive changes (new rows moved in). The other tabs are read live.
 */
function getMonthCompareData(accountKey, accessToken) {
  const who = assertAccess_(accessToken);
  if (getAppState_().maintenance.on && !isAdminEmail_(who.email)) throw new Error('SEKNA_MAINTENANCE');
  const key = normalizeAccountKey_(accountKey);
  const cacheKey = 'MEDIA_PLAN_MONTHS_V86_' + key.toUpperCase();
  const cached = getBigCache_(cacheKey);
  if (cached) return cached;

  const account = getAccountConfig_(key);
  const ss = getSpreadsheet_(account);
  const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Muscat';

  const archive = getArchiveSummary_(ss, account, tz);
  const channels = archive.channels.slice();
  const months = Object.assign({}, archive.months);
  const days = Object.assign({}, archive.days);

  // Later tabs win for any month they contain, so a month is never counted twice.
  ['thisYear', 'currentMonth'].forEach(logical => {
    const sh = getOptionalSheet_(ss, account, logical);
    if (!sh || sh.getLastRow() < 2) return;
    if (archive.sheetId && sh.getSheetId() === archive.sheetId) return;
    const part = aggregateCampaignRows_(sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues(), tz, channels);
    Object.keys(part.months).forEach(mk => {
      months[mk] = part.months[mk];
      Object.keys(days).forEach(dk => { if (dk.slice(0, 7) === mk) delete days[dk]; });
    });
    Object.keys(part.days).forEach(dk => { days[dk] = part.days[dk]; });
  });

  const result = { months: months, channels: channels, days: days, generatedAt: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') };
  putBigCache_(cacheKey, result, 1800);
  return result;
}

/** Sums campaign rows (Day, Campaign type, Campaign, …, Cost, Impr., Clicks, Conversions, Conv. value) per month and per day. */
function aggregateCampaignRows_(rows, tz, channels) {
  const months = {}, days = {};
  rows.forEach(r => {
    if (!r[0] || !r[1]) return;
    const d = asDate_(r[0]);
    if (!isFinite(d.getTime())) return;
    const mk = Utilities.formatDate(d, tz, 'yyyy-MM');
    const dk = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
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
  return { months: months, days: days };
}

/**
 * The archive summary, kept in a Drive file named "SEKNA archive summary (USA).json".
 * Its fingerprint is the archive's row count plus its last row, so moving a month into
 * the archive (or editing its last row) rebuilds it on the next request.
 */
function getArchiveSummary_(ss, account, tz) {
  const empty = { channels: ['Search Brand', 'Search Non-Brand', 'Performance Max', 'Demand Gen', 'Video (YouTube)'], months: {}, days: {}, sheetId: 0 };
  const sh = getOptionalSheet_(ss, account, account.sheets.archive ? 'archive' : 'lastYear');
  if (!sh || sh.getLastRow() < 2) return empty;
  const lastRow = sh.getLastRow();
  const sig = [sh.getSheetId(), lastRow, sh.getRange(lastRow, 1, 1, 10).getValues()[0].map(v => v instanceof Date ? v.getTime() : v).join('~')].join('|');

  const props = PropertiesService.getScriptProperties();
  const fileKey = 'SEKNA_ARCHIVE_SUMMARY_FILE_' + String(account.key).toUpperCase();
  const fileId = props.getProperty(fileKey);
  if (fileId) {
    try {
      const saved = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
      if (saved && saved.sig === sig) return saved;
    } catch (err) {
      console.error('Archive summary file could not be read: ' + err);
    }
  }

  const summary = buildArchiveSummary_(sh, tz, lastRow);
  summary.sig = sig;
  summary.sheetId = sh.getSheetId();
  try {
    const text = JSON.stringify(summary);
    let file = null;
    if (fileId) { try { file = DriveApp.getFileById(fileId); } catch (e) {} }
    if (file) file.setContent(text);
    else props.setProperty(fileKey, DriveApp.createFile('SEKNA archive summary (' + account.shortLabel + ').json', text, 'application/json').getId());
  } catch (err) {
    console.error('Archive summary file could not be saved: ' + err);
  }
  return summary;
}

function buildArchiveSummary_(sh, tz, lastRow) {
  const channels = ['Search Brand', 'Search Non-Brand', 'Performance Max', 'Demand Gen', 'Video (YouTube)'];
  const part = aggregateCampaignRows_(sh.getRange(2, 1, lastRow - 1, 10).getValues(), tz, channels);
  return { channels: channels, months: part.months, days: part.days, builtAt: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm') };
}

/** Run from the editor to rebuild the archive summary now (it also rebuilds by itself). */
function rebuildArchiveSummary() {
  assertOwnerRun_();
  const out = [];
  Object.keys(ACCOUNTS).forEach(key => {
    const account = getAccountConfig_(key);
    const ss = getSpreadsheet_(account);
    CacheService.getScriptCache().remove('MEDIA_PLAN_MONTHS_V86_' + key.toUpperCase() + '_n');
    const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Muscat';
    const s = getArchiveSummary_(ss, account, tz);
    out.push(account.shortLabel + ': ' + Object.keys(s.months).length + ' months, ' + Object.keys(s.days).length + ' days');
  });
  return out.join(' · ');
}

// CacheService keeps at most 100 KB per key, so large results are split over several keys.
function putBigCache_(key, obj, seconds) {
  try {
    const text = JSON.stringify(obj);
    const size = 90000, parts = {};
    const n = Math.ceil(text.length / size);
    for (let i = 0; i < n; i++) parts[key + '_' + i] = text.slice(i * size, (i + 1) * size);
    parts[key + '_n'] = String(n);
    CacheService.getScriptCache().putAll(parts, seconds);
  } catch (e) {}
}

function getBigCache_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get(key + '_n'));
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    const got = cache.getAll(keys);
    let text = '';
    for (let i = 0; i < n; i++) {
      if (got[keys[i]] == null) return null;
      text += got[keys[i]];
    }
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/**
 * One-off clean-up after the 2026 campaign tab was merged into the archive and deleted.
 * Every formula that added "+SUMIFS('2026-Campaign type'!…)" (or the #REF! left after the
 * delete) drops that part, and MAX('2026-Campaign type'!A:A) now reads the archive.
 * Run it once from the editor. Cells without such a formula are not touched.
 */
function fixSheetAfter2026Merge() {
  assertOwnerRun_();
  const account = getAccountConfig_('usa');
  const ss = getSpreadsheet_(account);
  const archive = getOptionalSheet_(ss, account, 'archive');
  if (!archive) throw new Error('Archive tab not found.');
  const deleted = '2026-Campaign type';
  const report = [];
  ss.getSheets().forEach(sh => {
    const range = sh.getDataRange();
    const formulas = range.getFormulas();
    let count = 0;
    formulas.forEach((row, r) => {
      let c = 0;
      while (c < row.length) {
        const next = row[c] ? rewrite2026Formula_(row[c], deleted, archive.getName()) : null;
        if (!next) { c++; continue; }
        // Write runs of neighbouring changed cells in one call.
        const run = [next];
        let e = c + 1;
        while (e < row.length && row[e]) {
          const n2 = rewrite2026Formula_(row[e], deleted, archive.getName());
          if (!n2) break;
          run.push(n2); e++;
        }
        sh.getRange(r + 1, c + 1, 1, run.length).setFormulas([run]);
        count += run.length;
        c = e;
      }
    });
    if (count) report.push(sh.getName() + ': ' + count);
  });
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove('MEDIA_PLAN_DASH_V83_USA');
  return report.length ? 'Fixed formulas — ' + report.join(' · ') : 'Nothing to fix.';
}

function rewrite2026Formula_(f, deleted, archiveName) {
  const del = "'" + deleted + "'!";
  const isDeletedRef = t => t.indexOf(del) === 0 || t.indexOf('#REF!') === 0;
  let out = '', i = 0, changed = false;
  while (i < f.length) {
    const m = f.slice(i).match(/^\+\s*SUMIFS\(/i);
    if (m && isDeletedRef(f.slice(i + m[0].length).trim())) {
      let j = i + m[0].length, depth = 1, inStr = false;
      for (; j < f.length && depth; j++) {
        const ch = f[j];
        if (ch === '"') inStr = !inStr;
        else if (!inStr && ch === '(') depth++;
        else if (!inStr && ch === ')') depth--;
      }
      i = j; changed = true; continue;
    }
    out += f[i]; i++;
  }
  const max = new RegExp("MAX\\((?:'" + deleted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'!|#REF!)", 'g');
  if (max.test(out)) { out = out.replace(max, "MAX('" + archiveName.replace(/'/g, "''") + "'!"); changed = true; }
  return changed ? out : null;
}

/**
 * Rebuilds the History tab from the data: every month row reads its Cost, Value and Conv
 * from the archive plus the current month tab with live formulas, and the rows for months
 * before the first day in the archive (no data on the platform) are removed.
 * Run it once from the editor. Column A (month) and B (Hijri) stay as they are.
 */
function fixHistoryTab() {
  assertOwnerRun_();
  const account = getAccountConfig_('usa');
  const ss = getSpreadsheet_(account);
  const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Muscat';
  const hist = getRequiredSheet_(ss, account, 'history');
  const archive = getRequiredSheet_(ss, account, 'archive');
  const current = getRequiredSheet_(ss, account, 'currentMonth');
  const monthTab = getRequiredSheet_(ss, account, 'month');

  // First month that has rows in the archive.
  const aLast = lastValueRow_(archive);
  let first = '';
  archive.getRange(2, 1, Math.max(1, aLast - 1), 1).getValues().forEach(r => {
    const k = archiveDayKey_(r[0], tz).slice(0, 7);
    if (k && (!first || k < first)) first = k;
  });
  if (!first) throw new Error('The archive tab has no dates.');

  const last = lastValueRow_(hist);
  if (last < 5) throw new Error('The History tab has no months.');
  const keyOf = v => v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM') : String(v || '').trim();
  const months = hist.getRange(5, 1, last - 4, 1).getValues().map(r => keyOf(r[0]));

  // 1) Remove the months before the data starts (they sit at the top, oldest first).
  let drop = 0;
  while (drop < months.length && /^\d{4}-\d{2}$/.test(months[drop]) && months[drop] < first) drop++;
  if (drop) hist.deleteRows(5, drop);
  const kept = months.slice(drop);

  // 2) Live formulas for every remaining month.
  const q = name => "'" + String(name).replace(/'/g, "''") + "'!";
  const A = q(archive.getName()), C = q(current.getName()), M = q(monthTab.getName());
  const sum = (col, r) => {
    const from = '">="&DATEVALUE($A' + r + '&"-01")', to = '"<="&EOMONTH(DATEVALUE($A' + r + '&"-01"),0)';
    return 'SUMIFS(' + A + '$' + col + ':$' + col + ',' + A + '$A:$A,' + from + ',' + A + '$A:$A,' + to + ')' +
      '+SUMIFS(' + C + '$' + col + ':$' + col + ',' + C + '$A:$A,' + from + ',' + C + '$A:$A,' + to + ',' + C + '$A:$A,">"&' + M + '$B$58)';
  };
  const rows = kept.map((k, i) => {
    const r = i + 5;
    if (!/^\d{4}-\d{2}$/.test(k)) return null;
    return [
      '=IF((' + sum('F', r) + ')=0,"",(' + sum('F', r) + '))',
      '=IF(C' + r + '="","",(' + sum('J', r) + '))',
      '=IF(C' + r + '="","",(' + sum('I', r) + '))',
      '=IF(C' + r + '="","",D' + r + '/C' + r + ')'
    ];
  });
  let written = 0;
  rows.forEach((f, i) => {
    if (!f) return;
    hist.getRange(i + 5, 3, 1, 4).setFormulas([f]);
    written++;
  });
  try { hist.getRange('A3').setValue('Every row is a LIVE formula from the data tabs (archive + current month).'); } catch (e) {}
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove('MEDIA_PLAN_DASH_V83_USA');
  CacheService.getScriptCache().remove('MEDIA_PLAN_MONTHS_V86_USA_n');
  return 'History: removed ' + drop + ' month(s) before ' + first + ', ' + written + ' months now read the data tabs.';
}

/* ---------- Media Plan Lab (admins only): move complete months to the archive ---------- */

/**
 * Looks at the current month tab (or a 2026 tab, when one is linked) month by month. A month is ready to move only when it is over and
 * every one of its days is there (28/29/30/31). Months already in the archive are skipped.
 */
function archivePlan_(account) {
  const ss = getSpreadsheet_(account);
  const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Muscat';
  const src = getOptionalSheet_(ss, account, account.sheets.thisYear ? 'thisYear' : 'currentMonth');
  const dst = getOptionalSheet_(ss, account, account.sheets.archive ? 'archive' : 'lastYear');
  if (!src || !dst) throw new Error('The current month tab or the archive tab is not linked for ' + account.label + '.');
  if (src.getSheetId() === dst.getSheetId()) throw new Error('The current month tab and the archive point to the same tab.');

  const srcLast = lastValueRow_(src);
  const srcRows = srcLast >= 2 ? src.getRange(2, 1, srcLast - 1, 10).getValues() : [];
  const dstLast = lastValueRow_(dst);
  const archived = {};
  if (dstLast >= 2) dst.getRange(2, 1, dstLast - 1, 1).getValues().forEach(r => {
    const k = archiveDayKey_(r[0], tz).slice(0, 7);
    if (k) archived[k] = true;
  });

  const groups = {};
  srcRows.forEach((r, i) => {
    const dk = archiveDayKey_(r[0], tz);
    if (!dk) return;
    const k = dk.slice(0, 7);
    const g = groups[k] || (groups[k] = { idx: [], days: {} });
    g.idx.push(i);
    g.days[dk] = true;
  });

  const thisMonth = Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const months = Object.keys(groups).sort().map(k => {
    const p = k.split('-').map(Number);
    const need = new Date(p[0], p[1], 0).getDate();
    const have = Object.keys(groups[k].days).length;
    const missing = [];
    for (let d = 1; d <= need; d++) if (!groups[k].days[k + '-' + String(d).padStart(2, '0')]) missing.push(d);
    const status = archived[k] ? 'archived' : k >= thisMonth ? 'running' : missing.length ? 'missing' : 'ready';
    return { key: k, have: have, need: need, rows: groups[k].idx.length, missing: missing, status: status };
  });
  return { tz: tz, src: src, dst: dst, srcRows: srcRows, dstLast: dstLast, groups: groups, months: months,
    sourceName: src.getName(), archiveName: dst.getName(), archiveRows: Math.max(0, dstLast - 1) };
}

function adminArchiveStatus(token, accountKey) {
  assertAdmin_(token);
  const plan = archivePlan_(getAccountConfig_(normalizeAccountKey_(accountKey)));
  return { months: plan.months, sourceName: plan.sourceName, archiveName: plan.archiveName, archiveRows: plan.archiveRows };
}

/** Moves every ready month: adds the rows under the archive, checks them, then removes them from the source tab. */
function adminArchiveMove(token, accountKey) {
  const who = assertAdmin_(token);
  const key = normalizeAccountKey_(accountKey);
  const account = getAccountConfig_(key);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Another move is running. Please try again in a minute.');
  try {
    const plan = archivePlan_(account);
    const ready = plan.months.filter(m => m.status === 'ready');
    if (!ready.length) return { moved: [], rows: 0, months: plan.months, archiveRows: plan.archiveRows };

    const rows = [], moved = {};
    ready.forEach(m => plan.groups[m.key].idx.forEach(i => { rows.push(plan.srcRows[i]); moved[i] = true; }));

    const dst = plan.dst, src = plan.src;
    const start = Math.max(plan.dstLast, 1) + 1;
    const needRows = start + rows.length - 1;
    if (dst.getMaxRows() < needRows) dst.insertRowsAfter(dst.getMaxRows(), needRows - dst.getMaxRows());
    const target = dst.getRange(start, 1, rows.length, 10);
    target.setValues(rows);
    if (plan.dstLast >= 2) dst.getRange(plan.dstLast, 1, 1, 10).copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    SpreadsheetApp.flush();

    const written = dst.getRange(start, 1, rows.length, 10).getValues();
    const same = written.every((r, i) => r.every((v, j) => String(v) === String(rows[i][j])));
    if (!same) throw new Error('The archive did not save every row, so nothing was removed from ' + src.getName() + '.');

    const keep = plan.srcRows.filter((r, i) => !moved[i] && r.some(v => v !== '' && v !== null));
    src.getRange(2, 1, plan.srcRows.length, 10).clearContent();
    if (keep.length) src.getRange(2, 1, keep.length, 10).setValues(keep);
    SpreadsheetApp.flush();

    CacheService.getScriptCache().remove('MEDIA_PLAN_MONTHS_V86_' + key.toUpperCase() + '_n');
    console.log(who.email + ' moved ' + rows.length + ' rows (' + ready.map(m => m.key).join(', ') + ') to the archive.');
    const after = archivePlan_(account);
    return { moved: ready.map(m => m.key), rows: rows.length, startRow: start, months: after.months, archiveRows: after.archiveRows };
  } finally {
    lock.releaseLock();
  }
}

// Last row with a value in column A (other columns can hold notes or report dates).
function lastValueRow_(sh) {
  const last = sh.getLastRow();
  if (last < 1) return 0;
  const col = sh.getRange(1, 1, last, 1).getValues();
  for (let i = col.length - 1; i >= 0; i--) if (col[i][0] !== '' && col[i][0] !== null) return i + 1;
  return 0;
}

function archiveDayKey_(v, tz) {
  if (v instanceof Date) return isFinite(v.getTime()) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : '';
  const m = String(v || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

function normalizeAccountKey_(accountKey) {
  const key = String(accountKey || DEFAULT_ACCOUNT_KEY).trim().toLowerCase();
  return ACCOUNTS[key] ? key : DEFAULT_ACCOUNT_KEY;
}

function getAccountConfig_(accountKey) {
  const key = normalizeAccountKey_(accountKey);
  const account = ACCOUNTS[key];
  if (!account) throw new Error('Unknown account: ' + accountKey);

  if (!account.spreadsheetUrl || /^PASTE_/i.test(account.spreadsheetUrl)) {
    throw new Error(account.label + ' spreadsheet URL is not configured yet. Paste the Google Sheet URL in ACCOUNTS.' + key + '.spreadsheetUrl.');
  }
  return account;
}

function getSpreadsheet_(account) {
  try {
    return SpreadsheetApp.openByUrl(account.spreadsheetUrl);
  } catch (e) {
    throw new Error('Could not open ' + account.label + ' spreadsheet URL. Check sharing/access and the URL in ACCOUNTS.');
  }
}

// The spreadsheet ID is part of the key, so pointing an account at a new
// spreadsheet never reuses a tab GID remembered from the old one.
function sheetGidPropertyKey_(account, logicalKey) {
  const match = String(account.spreadsheetUrl || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
  const ssId = match ? match[1].slice(0, 12) : '';
  return 'MEDIA_PLAN_SHEET_GID_' + String(account.key).toUpperCase() + '_' + String(logicalKey).toUpperCase() + (ssId ? '_' + ssId : '');
}

// Finds the monthly forecast tab by its weekly tracker header (A22 = "Week Starting").
function findMonthSheetByLayout_(ss) {
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i];
    if (sh.getLastRow() < 22) continue;
    if (String(sh.getRange('A22').getValue()).trim().toLowerCase() === 'week starting') return sh;
  }
  return null;
}

function parseGidFromRef_(ref) {
  const text = String(ref || '').trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const match = text.match(/[?#&]gid=(\d+)/i);
  return match ? Number(match[1]) : null;
}

function getOptionalSheet_(ss, account, logicalKey) {
  const ref = account.sheets && account.sheets[logicalKey];
  const props = PropertiesService.getScriptProperties();
  const propKey = sheetGidPropertyKey_(account, logicalKey);

  // 1) Stable cached GID: survives tab renames.
  const cached = Number(props.getProperty(propKey));
  if (cached) {
    const byCachedId = ss.getSheetById(cached);
    if (byCachedId) return byCachedId;
  }

  // 2) Direct tab link / numeric GID.
  const gid = parseGidFromRef_(ref);
  if (gid !== null) {
    const byId = ss.getSheetById(gid);
    if (byId) {
      props.setProperty(propKey, String(byId.getSheetId()));
      return byId;
    }
  }

  // 3) Monthly forecast tab marked AUTO: find it by its layout once.
  if (String(ref || '').toUpperCase() === 'AUTO') {
    const found = logicalKey === 'month' ? findMonthSheetByLayout_(ss) : null;
    if (found) props.setProperty(propKey, String(found.getSheetId()));
    return found;
  }

  // 4) First-time fallback by current tab name, then remember its GID forever.
  const byName = ref ? ss.getSheetByName(String(ref)) : null;
  if (byName) {
    props.setProperty(propKey, String(byName.getSheetId()));
    return byName;
  }

  return null;
}

function getRequiredSheet_(ss, account, logicalKey) {
  const sh = getOptionalSheet_(ss, account, logicalKey);
  if (!sh) {
    const ref = account.sheets && account.sheets[logicalKey];
    throw new Error('Sheet not found for ' + account.label + ': ' + logicalKey + ' (' + String(ref || 'not configured') + ')');
  }
  return sh;
}

function getSheetSourceLabel_(ss, account, logicalKey) {
  const sh = getOptionalSheet_(ss, account, logicalKey);
  return sh ? sh.getName() + ' • gid=' + sh.getSheetId() : String((account.sheets || {})[logicalKey] || '');
}

function getLastYearDay_(ss, currentDate, tz, account) {
  const sh = getRequiredSheet_(ss, account, 'lastYear');
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return emptyLy_();

  const rows = sh.getRange(2, 1, lastRow - 1, 10).getValues();
  const lyDate = new Date(currentDate);
  lyDate.setFullYear(lyDate.getFullYear() - 1);
  const target = Utilities.formatDate(lyDate, tz, 'yyyy-MM-dd');

  let spend = 0, impressions = 0, clicks = 0, conversions = 0, value = 0;
  let found = false;

  rows.forEach(r => {
    if (!r[0]) return;
    const d = asDate_(r[0]);
    const key = Utilities.formatDate(d, tz, 'yyyy-MM-dd');

    if (key === target) {
      found = true;
      spend += toNumber_(r[5]);
      impressions += toNumber_(r[6]);
      clicks += toNumber_(r[7]);
      conversions += toNumber_(r[8]);
      value += toNumber_(r[9]);
    }
  });

  if (!found) return emptyLy_();

  return {
    spend: spend,
    impressions: impressions,
    clicks: clicks,
    conversions: conversions,
    value: value,
    ctr: safeDiv_(clicks, impressions)
  };
}

function emptyLy_() {
  return { spend: 0, impressions: 0, clicks: 0, conversions: 0, value: 0, ctr: 0 };
}

function asDate_(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    return new Date(Math.round((value - 25569) * 86400 * 1000));
  }
  return new Date(value);
}

function toNumber_(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function safeDiv_(a, b) {
  return b ? a / b : null;
}


/**
 * Firebase Cloud Messaging push notifications — USA + AR
 * -----------------------------------------------------
 * Firebase credentials stay in Script Properties. The one-time private-key
 * setup file must NOT remain in the Apps Script project or GitHub.
 *
 * Notifications are generated only by the server-side data monitor. Changing
 * the visible account in the dashboard does not send any notification.
 */
const FIREBASE_PUSH = {
  TOPIC: 'media-plan-updates',
  SNAPSHOT_PREFIX: 'MEDIA_PLAN_FCM_LAST_DATE_',
  TRIGGER_FUNCTION: 'checkMediaPlanAndPush',
  EDIT_TRIGGER_FUNCTION: 'handleMediaPlanDateEdit',
  CHANGE_TRIGGER_FUNCTION: 'handleMediaPlanSheetChange',
  ACCOUNTS: ['usa', 'ar']
};

/**
 * Keeps the 1-minute backup monitor inside the daily trigger quota of a
 * regular Google account. Around the time new data usually arrives (learned
 * automatically from the last notification) the sheets are checked every
 * minute; the rest of the day they are checked every 10 minutes.
 * Manual sheet edits are still detected immediately by the edit trigger.
 */
const PUSH_SCHEDULE = {
  FAST_WINDOW_MINUTES: 90,
  SLOW_INTERVAL_MINUTES: 10,
  USUAL_MINUTE_KEY: 'MEDIA_PLAN_FCM_USUAL_MINUTE',
  LAST_FULL_CHECK_KEY: 'MEDIA_PLAN_FCM_LAST_FULL_CHECK'
};

/**
 * Run once after installing this version.
 *
 * It does three things:
 * 1) Records the current latest ACTUAL date for USA + AR as the baseline.
 * 2) Installs an immediate onEdit trigger for both spreadsheets.
 * 3) Keeps a 1-minute time trigger as a backup for formula/API/import updates
 *    that do not fire Google Sheets onEdit events.
 *
 * Notifications are DATE-ONLY: changing Spend / Conversions / Value inside the
 * same date does NOT send a push. A push is sent only when a NEW latest actual
 * date appears.
 */
function installFirebasePushTrigger() {
  assertOwnerRun_();
  const props = PropertiesService.getScriptProperties();
  assertFirebaseCredentials_(props);

  resetFirebasePushBaselines();

  const handlers = [
    FIREBASE_PUSH.TRIGGER_FUNCTION,
    FIREBASE_PUSH.EDIT_TRIGGER_FUNCTION,
    FIREBASE_PUSH.CHANGE_TRIGGER_FUNCTION
  ];

  ScriptApp.getProjectTriggers().forEach(t => {
    if (handlers.indexOf(t.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Backup monitor. Apps Script time triggers can occasionally run a little
  // late, so the spreadsheet edit triggers below are the fast path.
  ScriptApp.newTrigger(FIREBASE_PUSH.TRIGGER_FUNCTION)
    .timeBased()
    .everyMinutes(1)
    .create();

  FIREBASE_PUSH.ACCOUNTS.forEach(accountKey => {
    const account = getAccountConfig_(accountKey);
    const ss = getSpreadsheet_(account);

    ScriptApp.newTrigger(FIREBASE_PUSH.EDIT_TRIGGER_FUNCTION)
      .forSpreadsheet(ss)
      .onEdit()
      .create();

    // Useful when rows are inserted / pasted structurally. It is only an
    // extra fast-path; the 1-minute trigger remains the fallback.
    ScriptApp.newTrigger(FIREBASE_PUSH.CHANGE_TRIGGER_FUNCTION)
      .forSpreadsheet(ss)
      .onChange()
      .create();
  });

  return 'Firebase date-only notifications installed for USA + AR. Manual sheet edits are checked immediately; a 1-minute backup monitor is also active.';
}

/**
 * Baseline = latest actual date only. No notification is sent while resetting.
 */
function resetFirebasePushBaselines() {
  assertOwnerRun_();
  const props = PropertiesService.getScriptProperties();
  assertFirebaseCredentials_(props);

  FIREBASE_PUSH.ACCOUNTS.forEach(accountKey => {
    const current = getLatestPushDateSnapshot_(accountKey);
    if (current.date) {
      props.setProperty(pushSnapshotProperty_(accountKey), JSON.stringify(current));
    }
  });

  // Clean properties used by previous versions.
  props.deleteProperty('MEDIA_PLAN_FCM_LAST_SNAPSHOT');
  props.deleteProperty('MEDIA_PLAN_FCM_LAST_SNAPSHOT_USA');
  props.deleteProperty('MEDIA_PLAN_FCM_LAST_SNAPSHOT_AR');
  return 'USA + AR notification date baselines reset.';
}

/**
 * Fast path for a normal user edit in either Media Plan spreadsheet.
 * We only react to edits touching the Media Plan actual-data block P:W,
 * rows 14:44. The notification is still sent only if the latest actual DATE
 * changed compared with the stored baseline.
 */
function handleMediaPlanDateEdit(e) {
  try {
    if (restMoved_()) return;
    if (!e || !e.source || !e.range) return;

    const accountKey = accountKeyFromSpreadsheetId_(e.source.getId());
    if (!accountKey) return;

    const account = getAccountConfig_(accountKey);
    const editedGid = e.range.getSheet().getSheetId();
    // The current month tab is the daily source: any edit there is checked.
    if (editedGid === parseGidFromRef_(account.sheets.currentMonth)) {
      checkAccountDateAndPushFast_(accountKey);
      return;
    }
    const mediaPlanGid = parseGidFromRef_(account.sheets.mediaPlan);
    if (mediaPlanGid !== null && editedGid !== mediaPlanGid) return;

    const firstRow = e.range.getRow();
    const lastRow = firstRow + e.range.getNumRows() - 1;
    const firstCol = e.range.getColumn();
    const lastCol = firstCol + e.range.getNumColumns() - 1;

    const touchesRows = lastRow >= DASHBOARD_SETTINGS.START_ROW && firstRow <= DASHBOARD_SETTINGS.END_ROW;
    const touchesActualBlock = lastCol >= 16 && firstCol <= 23; // P:W
    if (!touchesRows || !touchesActualBlock) return;

    checkAccountDateAndPushFast_(accountKey);
  } catch (err) {
    console.error('Fast notification edit trigger failed: ' + err);
  }
}

/**
 * Extra fast path for structural sheet changes (for example inserted rows).
 */
function handleMediaPlanSheetChange(e) {
  try {
    if (restMoved_()) return;
    if (!e || !e.source) return;
    const accountKey = accountKeyFromSpreadsheetId_(e.source.getId());
    if (!accountKey) return;
    checkAccountDateAndPushFast_(accountKey);
  } catch (err) {
    console.error('Fast notification change trigger failed: ' + err);
  }
}

/**
 * 1-minute backup trigger. This catches updates that do NOT fire onEdit, such
 * as formula recalculation, imports, APIs, or another script writing values.
 */
function checkMediaPlanAndPush() {
  if (restMoved_()) return; // the SEKNA server checks every 2 minutes now
  try { sendDueAnnouncementPush_(); } catch (err) { console.error('Announcement push failed: ' + err); }
  try { checkAppReleaseAndPush_(); } catch (err) { console.error('App release check failed: ' + err); }
  if (!shouldRunScheduledCheck_()) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return;

  try {
    const props = PropertiesService.getScriptProperties();
    assertFirebaseCredentials_(props);
    props.setProperty(PUSH_SCHEDULE.LAST_FULL_CHECK_KEY, String(Date.now()));

    FIREBASE_PUSH.ACCOUNTS.forEach(accountKey => {
      try {
        checkOneAccountDateOnly_(props, accountKey);
      } catch (err) {
        console.error('Firebase date monitor failed for ' + accountKey + ': ' + err);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

function minuteOfDay_(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function shouldRunScheduledCheck_() {
  const props = PropertiesService.getScriptProperties();
  const now = new Date();

  const usualText = props.getProperty(PUSH_SCHEDULE.USUAL_MINUTE_KEY);
  if (usualText === null) return true; // Nothing learned yet: check every minute.

  let diff = Math.abs(minuteOfDay_(now) - Number(usualText));
  diff = Math.min(diff, 1440 - diff);
  if (diff <= PUSH_SCHEDULE.FAST_WINDOW_MINUTES) return true;

  const last = Number(props.getProperty(PUSH_SCHEDULE.LAST_FULL_CHECK_KEY)) || 0;
  return Date.now() - last >= (PUSH_SCHEDULE.SLOW_INTERVAL_MINUTES * 60 - 15) * 1000;
}

function checkAccountDateAndPushFast_(accountKey) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    assertFirebaseCredentials_(props);
    checkOneAccountDateOnly_(props, accountKey);
  } finally {
    lock.releaseLock();
  }
}

function checkOneAccountDateOnly_(props, accountKey) {
  const current = getLatestPushDateSnapshot_(accountKey);
  if (!current.date) return;

  const propertyKey = pushSnapshotProperty_(accountKey);
  const previousText = props.getProperty(propertyKey);

  // First observation only establishes a baseline.
  if (!previousText) {
    props.setProperty(propertyKey, JSON.stringify(current));
    return;
  }

  let previous;
  try {
    previous = JSON.parse(previousText);
  } catch (e) {
    previous = {};
  }

  const previousDate = String(previous.date || '');
  if (current.date === previousDate) return;

  if (getAppState_().maintenance.on) {
    props.setProperty(propertyKey, JSON.stringify(current));
    return;
  }

  const accountLabel = accountKey === 'ar' ? 'Media Plan AR' : 'Media Plan USA';
  const dateLabel = pushDateLabel_(current);
  const body = 'New data for ' + dateLabel + ' is now available.';

  sendFcmTopicMessage_(accountLabel, body, current, accountKey, 'new_day');

  // Save only after a successful FCM send so failed attempts can retry.
  props.setProperty(propertyKey, JSON.stringify(current));
  props.setProperty(PUSH_SCHEDULE.USUAL_MINUTE_KEY, String(minuteOfDay_(new Date())));
}

/**
 * Lightweight notification reader.
 *
 * IMPORTANT: we do NOT build the full dashboard here. That used to read the
 * large Current Month / Channel data tables for both accounts on every check,
 * which made notifications slower. This function reads only Media Plan P:W
 * (31 rows) and is therefore much faster.
 *
 * A date counts as "actual" only when that row has real activity in T:W
 * (Spend / Clicks / Conversions / Value). This prevents future plan dates that
 * already exist in the sheet from generating notifications early.
 */
function getLatestPushDateSnapshot_(accountKey) {
  const account = getAccountConfig_(accountKey);
  const ss = getSpreadsheet_(account);
  const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Muscat';

  const fromCurrent = latestDateFromCurrentMonth_(ss, account, tz, accountKey);
  if (fromCurrent) return fromCurrent;

  const media = getRequiredSheet_(ss, account, 'mediaPlan');

  const rowCount = DASHBOARD_SETTINGS.END_ROW - DASHBOARD_SETTINGS.START_ROW + 1;
  const rows = media.getRange(DASHBOARD_SETTINGS.START_ROW, 16, rowCount, 8).getValues(); // P:W

  let best = null;
  let bestTime = -Infinity;

  rows.forEach(r => {
    if (!r[0]) return; // P = date

    const spend = toNumber_(r[4]);       // T
    const clicks = toNumber_(r[5]);      // U
    const conversions = toNumber_(r[6]); // V
    const value = toNumber_(r[7]);       // W

    // Future plan rows commonly already contain dates + zeroes. Only consider
    // a row "live" once at least one actual metric becomes non-zero.
    if (!(spend !== 0 || clicks !== 0 || conversions !== 0 || value !== 0)) return;

    const d = asDate_(r[0]);
    const time = d.getTime();
    if (!isFinite(time) || time < bestTime) return;

    bestTime = time;
    best = {
      accountKey: String(accountKey || 'usa'),
      date: Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
      dayNumber: Number(Utilities.formatDate(d, tz, 'd')) || 0,
      monthName: Utilities.formatDate(d, tz, 'MMMM'),
      spend: roundPush_(spend, 2),
      conversions: roundPush_(conversions, 2),
      value: roundPush_(value, 2)
    };
  });

  return best || {
    accountKey: String(accountKey || 'usa'),
    date: '',
    dayNumber: 0,
    monthName: '',
    spend: 0,
    conversions: 0,
    value: 0
  };
}

/**
 * The current month tab (Day / Campaign type / … / Cost / Impr. / Clicks / Conversions /
 * Conv. value) is where each new day lands first. The latest date with any activity
 * there is the date the notification announces.
 */
function latestDateFromCurrentMonth_(ss, account, tz, accountKey) {
  const sh = getOptionalSheet_(ss, account, 'currentMonth');
  if (!sh || sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues();
  const byDate = {};
  rows.forEach(r => {
    if (!r[0]) return;
    const d = asDate_(r[0]);
    if (!isFinite(d.getTime())) return;
    const key = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    const x = byDate[key] || (byDate[key] = { d: d, spend: 0, clicks: 0, conversions: 0, value: 0 });
    x.spend += toNumber_(r[5]);
    x.clicks += toNumber_(r[7]);
    x.conversions += toNumber_(r[8]);
    x.value += toNumber_(r[9]);
  });
  const live = Object.keys(byDate).filter(k => {
    const x = byDate[k];
    return x.spend !== 0 || x.clicks !== 0 || x.conversions !== 0 || x.value !== 0;
  }).sort();
  if (!live.length) return null;
  const x = byDate[live[live.length - 1]];
  return {
    accountKey: String(accountKey || 'usa'),
    date: live[live.length - 1],
    dayNumber: Number(Utilities.formatDate(x.d, tz, 'd')) || 0,
    monthName: Utilities.formatDate(x.d, tz, 'MMMM'),
    spend: roundPush_(x.spend, 2),
    conversions: roundPush_(x.conversions, 2),
    value: roundPush_(x.value, 2)
  };
}

function accountKeyFromSpreadsheetId_(spreadsheetId) {
  const id = String(spreadsheetId || '');
  for (let i = 0; i < FIREBASE_PUSH.ACCOUNTS.length; i++) {
    const key = FIREBASE_PUSH.ACCOUNTS[i];
    const account = getAccountConfig_(key);
    // Read the ID from the configured URL instead of opening the spreadsheet,
    // so every edit in the sheet does not cost two spreadsheet opens.
    const match = String(account.spreadsheetUrl || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1] === id) return key;
  }
  return '';
}

/** Manual test helpers — all text is English. */
function testFirebasePush() {
  return testFirebasePushUSA();
}

function testFirebasePushUSA() {
  return testFirebasePushForAccount_('usa');
}

function testFirebasePushAR() {
  return testFirebasePushForAccount_('ar');
}

function testFirebasePushForAccount_(accountKey) {
  assertOwnerRun_();
  const current = getLatestPushDateSnapshot_(accountKey);
  const title = accountKey === 'ar' ? 'Media Plan AR' : 'Media Plan USA';
  return sendFcmTopicMessage_(
    title,
    'Push notifications are working while the app is closed.',
    current,
    accountKey,
    'test'
  );
}

function pushSnapshotProperty_(accountKey) {
  return FIREBASE_PUSH.SNAPSHOT_PREFIX + String(accountKey || 'usa').toUpperCase();
}

function pushDateLabel_(snapshot) {
  const month = String((snapshot && snapshot.monthName) || '').trim();
  const day = Number(snapshot && snapshot.dayNumber) || 0;
  if (month && day) return month + ' ' + day;
  if (day) return 'day ' + day;
  return String((snapshot && snapshot.date) || 'the latest day');
}

function differentPushNumber_(a, b) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) >= 0.01;
}

function roundPush_(value, decimals) {
  const p = Math.pow(10, decimals || 0);
  return Math.round((Number(value) || 0) * p) / p;
}

function formatPushNumber_(value) {
  return Number(value || 0).toLocaleString('en-US', {
    maximumFractionDigits: 2
  });
}

function assertFirebaseCredentials_(props) {
  const missing = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY',
    'FIREBASE_TOKEN_URI'
  ].filter(k => !props.getProperty(k));

  if (missing.length) {
    throw new Error(
      'Firebase credentials are not configured. Missing: ' + missing.join(', ') +
      '. Run setupFirebaseCredentials() once first.'
    );
  }
}

/**
 * Sends a HIGH-priority DATA-ONLY message.
 * Data-only delivery lets the Android service apply the user's in-app
 * notification on/off setting and selected sound even while the app is closed.
 */
function sendFcmTopicMessage_(title, body, snapshot, accountKey, eventType) {
  const props = PropertiesService.getScriptProperties();
  assertFirebaseCredentials_(props);

  const projectId = props.getProperty('FIREBASE_PROJECT_ID');
  const token = getFirebaseAccessToken_(props);

  const payload = {
    message: {
      topic: FIREBASE_PUSH.TOPIC,
      data: {
        title: String(title || 'Media Plan'),
        body: String(body || 'Media Plan data was updated.'),
        accountKey: String(accountKey || (snapshot && snapshot.accountKey) || 'usa'),
        eventType: String(eventType || 'updated'),
        date: String((snapshot && snapshot.date) || ''),
        dayNumber: String((snapshot && snapshot.dayNumber) || 0),
        monthName: String((snapshot && snapshot.monthName) || ''),
        spend: String((snapshot && snapshot.spend) || 0),
        conversions: String((snapshot && snapshot.conversions) || 0),
        value: String((snapshot && snapshot.value) || 0)
      },
      android: {
        priority: 'HIGH',
        ttl: '86400s'
      },
      webpush: {
        headers: { Urgency: 'high', TTL: '86400' }
      }
    }
  };

  const url = 'https://fcm.googleapis.com/v1/projects/' +
    encodeURIComponent(projectId) + '/messages:send';

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('FCM send failed (' + code + '): ' + text);
  }

  return text;
}

function getFirebaseAccessToken_(props) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('FIREBASE_ACCESS_TOKEN');
  if (cached) return cached;

  const clientEmail = props.getProperty('FIREBASE_CLIENT_EMAIL');
  const privateKey = props.getProperty('FIREBASE_PRIVATE_KEY');
  const tokenUri = props.getProperty('FIREBASE_TOKEN_URI') || 'https://oauth2.googleapis.com/token';

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };
  const claim = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  };

  const unsignedToken =
    base64UrlJson_(header) + '.' +
    base64UrlJson_(claim);

  const signature = Utilities.computeRsaSha256Signature(unsignedToken, privateKey);
  const assertion = unsignedToken + '.' + base64UrlBytes_(signature);

  const response = UrlFetchApp.fetch(tokenUri, {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion
    },
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Firebase OAuth failed (' + code + '): ' + text);
  }

  const json = JSON.parse(text);
  const accessToken = json.access_token;
  if (!accessToken) throw new Error('Firebase OAuth returned no access token.');

  cache.put('FIREBASE_ACCESS_TOKEN', accessToken, 3300);
  return accessToken;
}

function base64UrlJson_(obj) {
  return Utilities.base64EncodeWebSafe(
    JSON.stringify(obj),
    Utilities.Charset.UTF_8
  ).replace(/=+$/g, '');
}

function base64UrlBytes_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}


/**
 * SEKNA access control
 * --------------------
 * Nobody receives dashboard data until their device is approved:
 * 1) they enter their email and confirm it with a 6-digit code sent by email;
 * 2) the admin receives the request and approves or denies it;
 * 3) the device keeps a random access token. Only its SHA-256 hash is stored
 *    in the "SEKNA Access" sheet, and every data request checks it.
 *
 * To remove someone, set their Status to "Revoked" in the sheet. It takes
 * effect within about a minute.
 *
 * Run setupAccessControl() once from the editor after installing this version.
 */
const ACCESS = {
  SPREADSHEET_ID: '1PWV9exRy9dwW3H66bt7W4E1SQb63EJbgVz96yS6fQkI',
  SHEET_NAME: 'SEKNA Access',
  // Access requests, ideas and server notices go to the SEKNA inbox.
  ADMIN_EMAIL: 'seknaapp@gmail.com',
  // These accounts open the Admin tab and are approved as soon as they confirm their email code.
  ADMIN_EMAILS: ['ibrahim.amin6700@gmail.com', 'ibrahim@sekna.co.uk'],
  SENDER_NAME: 'SEKNA',
  // Emails go out from this address. It is a "Send mail as" alias of the account that runs the script.
  SENDER_EMAIL: 'seknaapp@gmail.com',
  // The SEKNA web app people open in the browser (links in invite / approval emails).
  WEB_PAGE_URL: 'https://sekna-app.web.app',
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbzjgZ1nXxLTcFdeFCIEznOj2H0XCo9YGUeu1YF2pJdsQiOo_aM-Mn6HxKKNk8peEuM1Ig/exec',
  CODE_TTL_SECONDS: 600,
  CODE_MAX_ATTEMPTS: 5,
  CODE_COOLDOWN_SECONDS: 55,
  CODES_PER_HOUR: 5,
  STATUS_CACHE_SECONDS: 60,
  LAST_SEEN_EVERY_MINUTES: 2,
  PROFILES_SHEET_NAME: 'SEKNA Profiles',
  SECRET_PROPERTY: 'SEKNA_ACCESS_SECRET',
  STATUSES: ['Pending', 'Approved', 'Denied', 'Revoked', 'Signed out', 'Invited'],
  SCHEMA_VERSION: '3',
  COLUMNS: ['Request ID', 'Name', 'Email', 'Status', 'Device', 'Requested at', 'Decided at', 'Last seen', 'Token hash', 'Device ID']
};
const AC = { ID: 1, NAME: 2, EMAIL: 3, STATUS: 4, DEVICE: 5, REQUESTED: 6, DECIDED: 7, LAST_SEEN: 8, TOKEN: 9, DEVICE_ID: 10 };

/** Run once from the Apps Script editor: prepares the sheet and sends a test email. */
function setupAccessControl() {
  assertOwnerRun_();
  const sheet = getAccessSheet_();
  getAccessSecret_();
  sendSeknaEmail_({
    to: ACCESS.ADMIN_EMAIL,
    name: ACCESS.SENDER_NAME,
    subject: 'SEKNA access control is ready',
    htmlBody: accessEmailHtml_('Access control is ready',
      '<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#4c5464">New access requests for the SEKNA dashboard will arrive at this address.</p>' +
      '<p style="margin:0;font-size:14px;line-height:1.6;color:#4c5464">You can review or revoke access at any time in the ' +
      '<a href="' + escapeHtml_(sheet.getParent().getUrl()) + '" style="color:#203C8E;font-weight:700">SEKNA Access sheet</a>.</p>')
  });
  return 'SEKNA access control is ready: ' + sheet.getParent().getUrl();
}

/** Called by the dashboard: emails a 6-digit verification code. */
function accessRequestCode(email, device) {
  assertAccessHere_();
  email = normalizeEmail_(email);
  if (!isValidEmail_(email)) throw new Error('Please enter a valid email address.');

  const cache = CacheService.getScriptCache();
  const key = sha256Hex_(email);
  if (cache.get('acc_cd_' + key)) throw new Error('A code was just sent. Please wait a minute before requesting another one.');
  const sent = Number(cache.get('acc_rl_' + key)) || 0;
  if (sent >= ACCESS.CODES_PER_HOUR) throw new Error('Too many codes requested. Please try again in an hour.');
  if (MailApp.getRemainingDailyQuota() < 3) throw new Error('We cannot send more emails today. Please try again tomorrow.');

  const code = String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 900000 + 100000);
  cache.put('acc_otp_' + key, JSON.stringify({ hash: sha256Hex_(email + ':' + code), attempts: 0 }), ACCESS.CODE_TTL_SECONDS);
  cache.put('acc_cd_' + key, '1', ACCESS.CODE_COOLDOWN_SECONDS);
  cache.put('acc_rl_' + key, String(sent + 1), 3600);

  const name = nameFromEmail_(email);
  sendSeknaEmail_({
    to: email,
    name: ACCESS.SENDER_NAME,
    replyTo: ACCESS.SENDER_EMAIL,
    subject: 'Your SEKNA verification code: ' + code,
    htmlBody: accessEmailHtml_('Hi ' + escapeHtml_(name) + ',',
      '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4c5464">Use this code to verify your email and request access to the SEKNA dashboard:</p>' +
      '<div style="margin:0 0 16px;padding:16px;border-radius:12px;background:#eef2fd;text-align:center;font-size:30px;font-weight:800;letter-spacing:8px;color:#203C8E">' + code + '</div>' +
      '<p style="margin:0;font-size:12px;line-height:1.6;color:#8a92a0">The code expires in 10 minutes. If you did not request it, you can ignore this email.</p>')
  });
  return { ok: true, name: name };
}

/** Called by the dashboard: checks the code and files the access request. */
function accessVerifyCode(email, code, device, deviceId) {
  assertAccessHere_();
  email = normalizeEmail_(email);
  code = String(code || '').replace(/\D/g, '');
  const cache = CacheService.getScriptCache();
  const key = sha256Hex_(email);
  const raw = cache.get('acc_otp_' + key);
  if (!raw) throw new Error('This code has expired. Please request a new one.');

  const otp = JSON.parse(raw);
  if (otp.attempts >= ACCESS.CODE_MAX_ATTEMPTS) {
    cache.remove('acc_otp_' + key);
    throw new Error('Too many attempts. Please request a new code.');
  }
  if (otp.hash !== sha256Hex_(email + ':' + code)) {
    otp.attempts++;
    cache.put('acc_otp_' + key, JSON.stringify(otp), ACCESS.CODE_TTL_SECONDS);
    throw new Error('That code is not correct. Please try again.');
  }
  cache.remove('acc_otp_' + key);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getAccessSheet_();
    const mine = readAccessRows_(sheet).filter(r => r.email === email);
    const blocked = mine.some(r => r.status === 'Denied' || r.status === 'Revoked');
    // Approved automatically once the email code is confirmed: the admins, people the
    // admin invited, and new devices of people already approved (never denied or revoked).
    const known = mine.some(r => r.status === 'Approved' || r.status === 'Signed out' || r.status === 'Invited');
    const status = isAdminEmail_(email) || (known && !blocked) ? 'Approved' : 'Pending';
    const invite = mine.filter(r => r.status === 'Invited' && !r.tokenHash)[0];
    deviceId = String(deviceId || '').replace(/[^\w-]/g, '').slice(0, 64);
    // Signing in again on the same device updates its row instead of adding a new one.
    const sameDevice = deviceId ? mine.filter(r => r.deviceId === deviceId)[0] : null;

    const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    const now = new Date();
    const req = {
      id: 'REQ-' + Utilities.formatDate(now, 'UTC', 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 6).toUpperCase(),
      name: nameFromEmail_(email),
      email: email,
      device: cleanDevice_(device),
      requestedAt: now
    };
    const values = [req.id, req.name, req.email, status, req.device, now, status === 'Approved' ? now : '', now, sha256Hex_(token), deviceId];
    const reuse = sameDevice || invite;
    if (reuse) {
      values[0] = reuse.id;
      req.id = reuse.id;
      if (reuse.tokenHash) CacheService.getScriptCache().remove('acc_tok_' + reuse.tokenHash);
      sheet.getRange(reuse.row, 1, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }
    if (!isAdminEmail_(email)) sendAdminAccessEmail_(req, status === 'Approved');
    return { ok: true, token: token, status: status, name: req.name };
  } finally {
    lock.releaseLock();
  }
}

/** Called by the dashboard while a request is waiting. */
function accessStatus(token) {
  const a = checkAccessToken_(token);
  return {
    status: a.status, name: a.name || '', email: a.email || '',
    isAdmin: !!(a.ok && isAdminEmail_(a.email)),
    photo: a.ok ? profilePhotoFor_(a.email) : '',
    member: a.ok ? (getMembers_()[normalizeEmail_(a.email)] || {}) : {},
    taskNotice: a.ok && !tasksMoved_() ? taskNoticeFor_(a.email) : null,
    backupToday: a.ok && !tasksMoved_() ? backupTodayFor_(a.email) : [],
    pushTopic: a.ok ? userPushTopic_(a.email) : '',
    dashboard: DASHBOARD_RELEASE,
    app: a.ok ? publicAppState_() : null
  };
}

/** Called from the review page that the admin opens from the request email. */
function accessDecide(id, decision, sig) {
  assertAccessHere_();
  id = String(id || '');
  decision = String(decision || '');
  if (['approve', 'deny', 'revoke'].indexOf(decision) < 0 || String(sig || '') !== signAccess_(id + '|' + decision)) {
    throw new Error('This link is not valid.');
  }
  return applyAccessDecision_(id, decision === 'approve' ? 'Approved' : decision === 'deny' ? 'Denied' : 'Revoked');
}

function checkAccessToken_(token) {
  token = String(token || '');
  if (token.length < 40) return { ok: false, status: 'Missing' };
  const hash = sha256Hex_(token);
  const cache = CacheService.getScriptCache();
  const cached = cache.get('acc_tok_' + hash);
  if (cached) return JSON.parse(cached);

  const sheet = getAccessSheet_();
  const row = readAccessRows_(sheet).filter(r => r.tokenHash === hash)[0];
  let result;
  if (!row) {
    result = { ok: false, status: 'Unknown' };
  } else {
    const status = ACCESS.STATUSES.indexOf(row.status) >= 0 ? row.status : 'Pending';
    result = { ok: status === 'Approved', status: status, name: row.name, email: row.email };
    if (result.ok && !accessMoved_()) {
      const last = row.lastSeen instanceof Date ? row.lastSeen.getTime() : 0;
      if (Date.now() - last > ACCESS.LAST_SEEN_EVERY_MINUTES * 60 * 1000) {
        sheet.getRange(row.row, AC.LAST_SEEN).setValue(new Date());
      }
    }
  }
  cache.put('acc_tok_' + hash, JSON.stringify(result), ACCESS.STATUS_CACHE_SECONDS);
  return result;
}

function assertAccess_(token) {
  const a = checkAccessToken_(token);
  if (!a.ok) throw new Error('SEKNA_ACCESS_' + String(a.status || 'Unknown').toUpperCase());
  return a;
}

/** Functions meant for the editor only must not run from the public web app. */
function assertOwnerRun_() {
  const active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('Run this function from the Apps Script editor.');
  }
}

function getAccessSheet_() {
  const ss = SpreadsheetApp.openById(ACCESS.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(ACCESS.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(ACCESS.SHEET_NAME);
  const props = PropertiesService.getScriptProperties();
  if (sheet.getLastRow() > 0 && props.getProperty('SEKNA_ACCESS_SCHEMA') !== ACCESS.SCHEMA_VERSION) {
    if (sheet.getMaxColumns() < ACCESS.COLUMNS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), ACCESS.COLUMNS.length - sheet.getMaxColumns());
    sheet.getRange(1, 1, 1, ACCESS.COLUMNS.length).setValues([ACCESS.COLUMNS])
      .setFontWeight('bold').setBackground('#203C8E').setFontColor('#ffffff');
    sheet.hideColumns(AC.TOKEN, 2);
    sheet.getRange(2, AC.STATUS, sheet.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(ACCESS.STATUSES, true).setAllowInvalid(false).build());
    props.setProperty('SEKNA_ACCESS_SCHEMA', ACCESS.SCHEMA_VERSION);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ACCESS.COLUMNS.length).setValues([ACCESS.COLUMNS])
      .setFontWeight('bold').setBackground('#203C8E').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.getRange(2, AC.STATUS, sheet.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(ACCESS.STATUSES, true).setAllowInvalid(false).build());
    props.setProperty('SEKNA_ACCESS_SCHEMA', ACCESS.SCHEMA_VERSION);
    sheet.setColumnWidths(1, ACCESS.COLUMNS.length, 150);
    sheet.setColumnWidth(AC.EMAIL, 240);
    sheet.setColumnWidth(AC.DEVICE, 220);
    sheet.hideColumns(AC.TOKEN, 2);
  }
  return sheet;
}

function readAccessRows_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, ACCESS.COLUMNS.length).getValues().map((v, i) => ({
    row: i + 2,
    id: String(v[AC.ID - 1]),
    name: String(v[AC.NAME - 1]),
    email: normalizeEmail_(v[AC.EMAIL - 1]),
    status: String(v[AC.STATUS - 1]).trim(),
    device: String(v[AC.DEVICE - 1]),
    requestedAt: v[AC.REQUESTED - 1],
    lastSeen: v[AC.LAST_SEEN - 1],
    tokenHash: String(v[AC.TOKEN - 1]),
    deviceId: String(v[AC.DEVICE_ID - 1] || '')
  }));
}

function sendAdminAccessEmail_(req, autoApproved) {
  const sheetUrl = 'https://docs.google.com/spreadsheets/d/' + ACCESS.SPREADSHEET_ID + '/edit';
  const details = accessDetailsHtml_(req);
  const body = autoApproved
    ? '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4c5464">' + escapeHtml_(req.name) +
      ' is already approved and confirmed their email on a new device, so it was approved automatically.</p>' + details +
      emailButton_(accessReviewUrl_(req.id, 'revoke'), 'Revoke this device', false)
    : '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4c5464">' + escapeHtml_(req.name) +
      ' confirmed their email and is asking for access to the SEKNA dashboard.</p>' + details +
      emailButton_(accessReviewUrl_(req.id, 'approve'), 'Approve', true) +
      emailButton_(accessReviewUrl_(req.id, 'deny'), 'Deny', false);
  sendSeknaEmail_({
    to: ACCESS.ADMIN_EMAIL,
    name: ACCESS.SENDER_NAME,
    replyTo: req.email,
    subject: (autoApproved ? 'New device: ' : 'Access request: ') + req.name + ' (' + req.email + ')',
    htmlBody: accessEmailHtml_(autoApproved ? 'New device signed in' : 'New access request', body +
      '<p style="margin:18px 0 0;font-size:12px;color:#8a92a0">Manage everyone in the <a href="' + sheetUrl + '" style="color:#203C8E">SEKNA Access sheet</a>.</p>')
  });
}

function accessDetailsHtml_(req) {
  const when = Utilities.formatDate(req.requestedAt, Session.getScriptTimeZone(), 'd MMM yyyy, HH:mm');
  const line = (k, v) => '<tr><td style="padding:6px 12px 6px 0;color:#8a92a0;font-size:12px;white-space:nowrap">' + k +
    '</td><td style="padding:6px 0;color:#1d2433;font-size:13px;font-weight:700">' + escapeHtml_(v) + '</td></tr>';
  return '<table style="border-collapse:collapse;margin:0 0 16px">' + line('Name', req.name) + line('Email', req.email) +
    line('Device', req.device) + line('Requested', when) + '</table>';
}

function accessReviewUrl_(id, decision) {
  return ACCESS.WEB_APP_URL + '?access=review&id=' + encodeURIComponent(id) + '&decision=' + decision +
    '&sig=' + encodeURIComponent(signAccess_(id + '|' + decision));
}

/** Review page opened from the admin email. A button confirms the decision, so link scanners cannot approve anything. */
function renderAccessReviewPage_(p) {
  if (accessMoved_()) {
    // Sign-in lives on the SEKNA server now: the same link opens its review page.
    const url = 'https://europe-west2-human-appeal-media-plan.cloudfunctions.net/api/review?id=' + encodeURIComponent(String(p.id || '')) +
      '&decision=' + encodeURIComponent(String(p.decision || '')) + '&sig=' + encodeURIComponent(String(p.sig || ''));
    return HtmlService.createHtmlOutput('<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_top"></head><body style="font-family:Arial,sans-serif;padding:30px;text-align:center">' +
      '<p>The SEKNA review page moved.</p><p><a href="' + escapeHtml_(url) + '" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#203C8E;color:#fff;font-weight:700;text-decoration:none">Open the request</a></p>' +
      '<script>try{window.top.location.href=' + JSON.stringify(url) + '}catch(e){}</script></body></html>').setTitle('SEKNA • Access request');
  }
  const id = String(p.id || '');
  const decision = String(p.decision || '');
  const sig = String(p.sig || '');
  const valid = ['approve', 'deny', 'revoke'].indexOf(decision) >= 0 && sig === signAccess_(id + '|' + decision);
  const row = valid ? readAccessRows_(getAccessSheet_()).filter(r => r.id === id)[0] : null;
  const verb = decision === 'approve' ? 'Approve' : decision === 'deny' ? 'Deny' : 'Revoke';

  let body;
  if (!row) {
    body = '<h1>Link not valid</h1><p class="muted">This link is invalid or the request no longer exists.</p>';
  } else {
    body = '<p class="kicker">Access request</p><h1>' + verb + ' ' + escapeHtml_(row.name) + '?</h1>' +
      accessDetailsHtml_({ name: row.name, email: row.email, device: row.device, requestedAt: row.requestedAt instanceof Date ? row.requestedAt : new Date() }) +
      '<p class="muted">Current status: <b>' + escapeHtml_(row.status) + '</b></p>' +
      '<button id="go" class="' + (decision === 'approve' ? 'primary' : 'danger') + '" onclick="decide()">' + verb + ' access</button>' +
      '<p id="msg" class="muted"></p>' +
      '<script>function decide(){var b=document.getElementById("go"),m=document.getElementById("msg");b.disabled=true;b.textContent="Saving…";' +
      'google.script.run.withSuccessHandler(function(r){b.textContent="Done ✓";m.textContent=r.name+" is now "+r.status+".";})' +
      '.withFailureHandler(function(e){b.disabled=false;b.textContent="Try again";m.textContent=e.message;})' +
      '.accessDecide(' + JSON.stringify(id) + ',' + JSON.stringify(decision) + ',' + JSON.stringify(sig) + ');}</script>';
  }
  const html = '<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8"><style>' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;' +
    'background:linear-gradient(160deg,#2a4eb3,#203c8e 45%,#0f1f52);font-family:Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1d2433}' +
    '.card{width:min(420px,100%);background:#fff;border-radius:22px;padding:26px 24px;box-shadow:0 30px 80px rgba(6,14,40,.45)}' +
    '.brand{font-size:20px;font-weight:900;letter-spacing:1px;color:#203C8E}.brand:after{content:"";display:block;width:34px;height:3px;margin-top:6px;border-radius:2px;background:#C28D3E}' +
    '.kicker{margin:20px 0 0;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#8a92a0}' +
    'h1{margin:6px 0 14px;font-size:22px;letter-spacing:-.02em}.muted{font-size:13px;color:#636b7a}' +
    'button{width:100%;margin-top:8px;padding:14px;border:0;border-radius:13px;font-size:14px;font-weight:800;color:#fff;cursor:pointer}' +
    'button.primary{background:linear-gradient(180deg,#2b4db0,#203c8e)}button.danger{background:#c0392b}button:disabled{opacity:.75;cursor:default}' +
    '</style></head><body><div class="card"><div class="brand">SEKNA</div>' + body + '</div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('SEKNA • Access request')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Sends every SEKNA email from ACCESS.SENDER_EMAIL when that address is set up as a
 * Gmail "Send mail as" alias of this account. Until then (or if Gmail refuses), the
 * email still goes out the old way so sign-in codes never stop.
 */
function sendSeknaEmail_(msg) {
  const from = String(ACCESS.SENDER_EMAIL || '').trim().toLowerCase();
  if (from && seknaAliasReady_(from)) {
    try {
      const opts = { name: msg.name || ACCESS.SENDER_NAME, from: from, htmlBody: msg.htmlBody };
      if (msg.replyTo) opts.replyTo = msg.replyTo;
      if (msg.attachments) opts.attachments = msg.attachments;
      GmailApp.sendEmail(msg.to, msg.subject, String(msg.body || 'Open this email in an app that shows HTML.'), opts);
      return;
    } catch (err) {
      console.error('Sending from ' + from + ' failed, using the default sender: ' + err);
    }
  }
  MailApp.sendEmail(msg);
}

function seknaAliasReady_(from) {
  const cache = CacheService.getScriptCache();
  const key = 'SEKNA_ALIAS_OK_' + from;
  const hit = cache.get(key);
  if (hit !== null) return hit === '1';
  let ok = false;
  try {
    ok = GmailApp.getAliases().map(a => String(a).toLowerCase()).indexOf(from) >= 0;
  } catch (err) {
    console.error('Could not read Gmail aliases: ' + err);
  }
  cache.put(key, ok ? '1' : '0', ok ? 21600 : 600);
  return ok;
}

/** Run once from the editor after adding the alias: sends a test email to the admin. */
function testSeknaEmail() {
  assertOwnerRun_();
  CacheService.getScriptCache().remove('SEKNA_ALIAS_OK_' + String(ACCESS.SENDER_EMAIL).toLowerCase());
  const ready = seknaAliasReady_(String(ACCESS.SENDER_EMAIL).toLowerCase());
  sendSeknaEmail_({
    to: ACCESS.ADMIN_EMAIL,
    name: ACCESS.SENDER_NAME,
    replyTo: ACCESS.SENDER_EMAIL,
    subject: 'SEKNA email test',
    htmlBody: accessEmailHtml_('Email test', '<p style="margin:0;font-size:14px;line-height:1.6;color:#4c5464">' +
      (ready ? 'This email was sent from ' + escapeHtml_(ACCESS.SENDER_EMAIL) + '.' : 'The alias ' + escapeHtml_(ACCESS.SENDER_EMAIL) + ' is not ready yet, so this came from the default sender.') + '</p>')
  });
  return ready ? 'Sent from ' + ACCESS.SENDER_EMAIL : 'Alias not found in Gmail "Send mail as" yet — sent from the default sender.';
}

function accessEmailHtml_(title, bodyHtml) {
  return '<div style="background:#f4f6fb;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#1d2433">' +
    '<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6eaf4">' +
    '<div style="background:#203C8E;padding:20px 24px;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:1px">SEKNA' +
    '<div style="height:3px;width:38px;background:#C28D3E;margin-top:8px;border-radius:2px"></div></div>' +
    '<div style="padding:24px"><h2 style="margin:0 0 12px;font-size:19px;color:#1d2433">' + title + '</h2>' + bodyHtml + '</div>' +
    '<div style="padding:14px 24px;background:#f8f9fc;color:#8a92a0;font-size:11px">SEKNA • The calm in the campaign.</div></div></div>';
}

function emailButton_(href, label, primary) {
  return '<a href="' + escapeHtml_(href) + '" style="display:inline-block;padding:12px 22px;margin:4px 8px 0 0;border-radius:10px;' +
    'text-decoration:none;font-weight:700;font-size:14px;' + (primary ? 'background:#203C8E;color:#ffffff' : 'background:#eef1f7;color:#1d2433') +
    '">' + label + '</a>';
}

function getAccessSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty(ACCESS.SECRET_PROPERTY);
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(ACCESS.SECRET_PROPERTY, secret);
  }
  return secret;
}

function signAccess_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(text), getAccessSecret_())).replace(/=+$/, '');
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail_(email) {
  return email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function nameFromEmail_(email) {
  const local = String(email || '').split('@')[0];
  const part = local.split(/[._\-+0-9]+/).filter(Boolean)[0] || local;
  return part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : 'there';
}

function cleanDevice_(device) {
  return String(device || 'Unknown device').replace(/[<>]/g, '').slice(0, 120);
}

function escapeHtml_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}


/* ---------- Sign out and admin tools (v71) ---------- */

function isAdminEmail_(email) {
  return ACCESS.ADMIN_EMAILS.indexOf(normalizeEmail_(email)) >= 0;
}

/** Signs this device out. The person can sign back in with an email code, without a new approval. */
function accessSignOut(token) {
  assertAccessHere_();
  const hash = sha256Hex_(String(token || ''));
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getAccessSheet_();
    const row = readAccessRows_(sheet).filter(r => r.tokenHash === hash)[0];
    if (row && row.status === 'Approved') {
      sheet.getRange(row.row, AC.STATUS).setValue('Signed out');
      sheet.getRange(row.row, AC.DECIDED).setValue(new Date());
    }
    CacheService.getScriptCache().remove('acc_tok_' + hash);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function assertAdmin_(token) {
  const a = checkAccessToken_(token);
  if (!a.ok || !isAdminEmail_(a.email)) throw new Error('SEKNA_ADMIN_ONLY');
  return a;
}

/** Admin panel data: everyone who requested access, their devices and last activity. */
function adminOverview(token) {
  const me = assertAdmin_(token);
  const tz = Session.getScriptTimeZone();
  const fmt = d => d instanceof Date ? Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ss") : '';
  const rows = readAccessRows_(getAccessSheet_()).map(r => ({
    id: r.id,
    name: r.name,
    email: r.email,
    status: r.status || 'Pending',
    device: r.device,
    requestedAt: fmt(r.requestedAt),
    lastSeen: fmt(r.lastSeen),
    lastSeenMs: r.lastSeen instanceof Date ? r.lastSeen.getTime() : 0
  }));
  try { refreshProfilePhotos_(rows.map(r => r.email)); } catch (e) {}
  return { me: me.email, now: Date.now(), rows: rows, photos: readProfilePhotos_(), members: getMembers_() };
}

/** Admin action from the app: approve, deny, revoke or restore a device. */
function adminSetStatus(token, id, action) {
  assertAccessHere_();
  assertAdmin_(token);
  const map = { approve: 'Approved', restore: 'Approved', deny: 'Denied', revoke: 'Revoked' };
  if (!map[action]) throw new Error('Unknown action.');
  return applyAccessDecision_(String(id || ''), map[action]);
}

/** Admin invite: the invited email is approved automatically once it confirms its email code. */
function adminInvite(token, email) {
  assertAccessHere_();
  const me = assertAdmin_(token);
  email = normalizeEmail_(email);
  if (!isValidEmail_(email)) throw new Error('Please enter a valid email address.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getAccessSheet_();
    const mine = readAccessRows_(sheet).filter(r => r.email === email);
    if (mine.some(r => r.status === 'Approved')) return { ok: true, already: true, name: nameFromEmail_(email) };
    const now = new Date();
    const name = nameFromEmail_(email);
    if (!mine.some(r => r.status === 'Invited')) {
      sheet.appendRow(['INV-' + Utilities.formatDate(now, 'UTC', 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 6).toUpperCase(),
        name, email, 'Invited', 'Invited by ' + me.email, now, now, '', '', '']);
    }
    sendSeknaEmail_({
      to: email,
      name: ACCESS.SENDER_NAME,
      replyTo: ACCESS.SENDER_EMAIL,
      subject: name + ', you have access to the SEKNA dashboard',
      htmlBody: accessEmailHtml_('Hi ' + escapeHtml_(name) + ',',
        '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4c5464">You have been given access to the SEKNA dashboard. ' +
        'Open the SEKNA app, or the link below, and confirm your email with the code we send you.</p>' +
        emailButton_(ACCESS.WEB_PAGE_URL, 'Open SEKNA', true))
    });
    return { ok: true, already: false, name: name };
  } finally {
    lock.releaseLock();
  }
}

function applyAccessDecision_(id, status) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getAccessSheet_();
    const row = readAccessRows_(sheet).filter(r => r.id === id)[0];
    if (!row) throw new Error('This request no longer exists.');
    sheet.getRange(row.row, AC.STATUS).setValue(status);
    sheet.getRange(row.row, AC.DECIDED).setValue(new Date());
    if (row.tokenHash) CacheService.getScriptCache().remove('acc_tok_' + row.tokenHash);

    if (status === 'Approved' && row.status !== 'Approved' && row.tokenHash) {
      sendSeknaEmail_({
        to: row.email,
        name: ACCESS.SENDER_NAME,
        replyTo: ACCESS.SENDER_EMAIL,
        subject: "You're verified, " + row.name + ' — SEKNA dashboard access is active',
        htmlBody: accessEmailHtml_("You're verified, " + escapeHtml_(row.name) + '!',
          '<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#4c5464">Your identity has been confirmed and your access to the SEKNA dashboard is now active.</p>' +
          '<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#4c5464">Open the SEKNA app — or SEKNA on the web — to continue.</p>' +
          emailButton_(ACCESS.WEB_PAGE_URL, 'Open SEKNA', true))
      });
    }
    return { status: status, name: row.name, email: row.email };
  } finally {
    lock.releaseLock();
  }
}

/** Admin: removes an old record (signed out, revoked, denied or an unused invite). Approved devices must be revoked first. */
function adminDelete(token, id) {
  assertAccessHere_();
  assertAdmin_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getAccessSheet_();
    const row = readAccessRows_(sheet).filter(r => r.id === String(id || ''))[0];
    if (!row) throw new Error('This record no longer exists.');
    if (row.status === 'Approved' || row.status === 'Pending') throw new Error('Revoke or deny this device before deleting it.');
    if (row.tokenHash) CacheService.getScriptCache().remove('acc_tok_' + row.tokenHash);
    sheet.deleteRow(row.row);
    return { ok: true, name: row.name };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Profile photos and dashboard release info (v72) ---------- */

/** Shown on the Updates screen. Change it whenever a new dashboard version is deployed. */
const DASHBOARD_RELEASE = { version: 'v157', date: '2026-11-05' };

function getProfilesSheet_() {
  const ss = SpreadsheetApp.openById(ACCESS.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(ACCESS.PROFILES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ACCESS.PROFILES_SHEET_NAME);
    sheet.getRange(1, 1, 1, 3).setValues([['Email', 'Google photo', 'Checked at']])
      .setFontWeight('bold').setBackground('#203C8E').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 240);
  }
  return sheet;
}

function readProfileRows_() {
  const sheet = getProfilesSheet_();
  const out = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues().forEach((r, i) => {
      if (r[0]) out[normalizeEmail_(r[0])] = { url: String(r[1] || ''), checked: r[2] instanceof Date ? r[2].getTime() : 0, row: i + 2 };
    });
  }
  return out;
}

/** email -> Google profile photo URL, for everyone whose photo was found. */
function readProfilePhotos_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sekna_profile_photos');
  if (cached) return JSON.parse(cached);
  const rows = readProfileRows_();
  const out = {};
  Object.keys(rows).forEach(e => { if (rows[e].url) out[e] = rows[e].url; });
  try { cache.put('sekna_profile_photos', JSON.stringify(out), 600); } catch (e) {}
  return out;
}

/**
 * Looks up the Google account photo of each email (at most a few per call) and
 * remembers it for a week. Needs the "People API" service enabled in the editor;
 * without it everyone simply keeps their initial.
 */
function refreshProfilePhotos_(emails) {
  if (typeof People === 'undefined') return;
  const rows = readProfileRows_();
  const weekMs = 7 * 24 * 3600 * 1000;
  const due = emails.map(normalizeEmail_).filter((e, i, a) => e && a.indexOf(e) === i)
    .filter(e => !rows[e] || Date.now() - rows[e].checked > weekMs).slice(0, 6);
  if (!due.length) return;
  const sheet = getProfilesSheet_();
  due.forEach(email => {
    const url = lookupGooglePhoto_(email);
    if (rows[email]) sheet.getRange(rows[email].row, 2, 1, 2).setValues([[url, new Date()]]);
    else sheet.appendRow([email, url, new Date()]);
  });
  CacheService.getScriptCache().remove('sekna_profile_photos');
}

function lookupGooglePhoto_(email) {
  const pick = results => {
    for (const r of results || []) {
      const person = r.person || r;
      const matches = (person.emailAddresses || []).some(x => normalizeEmail_(x.value) === email);
      const photo = (person.photos || []).filter(x => x.url && !x.default)[0];
      if (matches && photo) return photo.url;
    }
    return '';
  };
  try {
    const url = pick(People.People.searchContacts({ query: email, readMask: 'photos,emailAddresses' }).results);
    if (url) return url;
  } catch (e) {}
  try {
    People.OtherContacts.search({ query: '', readMask: 'photos,emailAddresses' }); // warm-up call the API asks for
    return pick(People.OtherContacts.search({ query: email, readMask: 'photos,emailAddresses' }).results);
  } catch (e) {
    return '';
  }
}

function profilePhotoFor_(email) {
  try { refreshProfilePhotos_([email]); } catch (e) {}
  return readProfilePhotos_()[normalizeEmail_(email)] || '';
}


/* ---------- v76: maintenance mode, team messages, app release notifications ---------- */
const APP_STATE_PROPERTY = 'SEKNA_APP_STATE';
const APP_RELEASE = {
  API: 'https://api.github.com/repos/ibrahimamin6700-ui/human-appeal-media-plan/releases/latest',
  LAST_TAG_KEY: 'SEKNA_APP_RELEASE_TAG',
  LAST_CHECK_KEY: 'SEKNA_APP_RELEASE_CHECK',
  CHECK_EVERY_MINUTES: 30
};

function getAppState_() {
  let s = {};
  try { s = JSON.parse(PropertiesService.getScriptProperties().getProperty(APP_STATE_PROPERTY) || '{}'); } catch (e) {}
  s.maintenance = s.maintenance || { on: false, reason: '' };
  s.announcement = s.announcement || null;
  return s;
}

function setAppState_(s) {
  PropertiesService.getScriptProperties().setProperty(APP_STATE_PROPERTY, JSON.stringify(s));
}

function todayText_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function announcementIsLive_(a) {
  return !!(a && a.message && (!a.showFrom || a.showFrom <= todayText_()));
}

/** What every approved device may see. */
function publicAppState_() {
  const s = getAppState_();
  const a = s.announcement;
  return {
    maintenance: { on: !!s.maintenance.on, reason: s.maintenance.reason || '' },
    announcement: announcementIsLive_(a) ? { id: a.id, title: a.title || '', message: a.message } : null
  };
}

function adminGetAppState(token) {
  assertAdmin_(token);
  return getAppState_();
}

// Admin > Overview > Recent starts again from this moment (kept for every admin device).
// Titles and avatars the admin gives each email. Stored in script properties; nobody is notified.
const SEKNA_ROLES = ['Media Buyer', 'Senior Media Buyer', 'Team Leader', 'Media Manager', 'Head of Media'];
function getMembers_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('SEKNA_MEMBERS') || '{}') || {}; } catch (e) { return {}; }
}
function adminSetMember(token, email, field, value) {
  assertAdmin_(token);
  email = normalizeEmail_(email);
  if (!email) throw new Error('Missing email');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const all = getMembers_();
    const m = all[email] || {};
    if (field === 'role') {
      const r = String(value || '');
      if (r && SEKNA_ROLES.indexOf(r) < 0) throw new Error('Unknown position');
      if (r) m.role = r; else delete m.role;
    } else if (field === 'avatar') {
      const n = Math.round(Number(value) || 0);
      // 11–24: the Alexandria avatars (the old 1–10 emblems were retired).
      if (n !== 0 && (n < 11 || n > 24)) throw new Error('Unknown avatar');
      if (n) m.avatar = n; else delete m.avatar;
    } else throw new Error('Unknown field');
    if (m.role || m.avatar) all[email] = m; else delete all[email];
    PropertiesService.getScriptProperties().setProperty('SEKNA_MEMBERS', JSON.stringify(all));
    return { email: email, member: all[email] || {} };
  } finally { lock.releaseLock(); }
}

function adminClearRecent(token) {
  assertAccessHere_();
  assertAdmin_(token);
  const s = getAppState_();
  s.recentClearedAt = Date.now();
  setAppState_(s);
  return s;
}

function adminSetMaintenance(token, on, reason) {
  assertAccessHere_();
  const me = assertAdmin_(token);
  const s = getAppState_();
  s.maintenance = on
    ? { on: true, reason: String(reason || '').trim().slice(0, 300), since: Date.now(), by: me.email }
    : { on: false, reason: '' };
  setAppState_(s);
  return s;
}

function adminPublishAnnouncement(token, title, message, showFrom, sendPush) {
  assertAccessHere_();
  const me = assertAdmin_(token);
  message = String(message || '').trim().slice(0, 1000);
  if (!message) throw new Error('Please write the message first.');
  showFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(showFrom || '')) ? String(showFrom) : '';
  const s = getAppState_();
  s.announcement = {
    id: 'MSG-' + Date.now(),
    title: String(title || '').trim().slice(0, 80),
    message: message,
    showFrom: showFrom,
    push: !!sendPush,
    pushed: false,
    createdAt: Date.now(),
    by: me.email
  };
  setAppState_(s);
  let pushed = false;
  if (sendPush && announcementIsLive_(s.announcement)) pushed = sendAnnouncementPush_(s);
  return { state: getAppState_(), pushed: pushed };
}

function adminClearAnnouncement(token) {
  assertAccessHere_();
  assertAdmin_(token);
  const s = getAppState_();
  s.announcement = null;
  setAppState_(s);
  return s;
}

/** The phone notification for a team message. The name is added inside the app when it opens. */
function sendAnnouncementPush_(s) {
  const a = s.announcement;
  const body = String(a.message).replace(/\{name\}/gi, 'team');
  sendFcmTopicMessage_(a.title || 'SEKNA', body.length > 180 ? body.slice(0, 177) + '…' : body, null, 'usa', 'announcement');
  a.pushed = true;
  setAppState_(s);
  return true;
}

function sendDueAnnouncementPush_() {
  const s = getAppState_();
  const a = s.announcement;
  if (a && a.push && !a.pushed && announcementIsLive_(a)) sendAnnouncementPush_(s);
}

/** Tells the team when a new signed SEKNA app version is published on GitHub. */
function checkAppReleaseAndPush_() {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty(APP_RELEASE.LAST_CHECK_KEY)) || 0;
  if (Date.now() - last < APP_RELEASE.CHECK_EVERY_MINUTES * 60 * 1000) return;
  props.setProperty(APP_RELEASE.LAST_CHECK_KEY, String(Date.now()));
  if (getAppState_().maintenance.on) return;

  const res = UrlFetchApp.fetch(APP_RELEASE.API, {
    headers: { Accept: 'application/vnd.github+json' }, muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return;
  const release = JSON.parse(res.getContentText() || '{}');
  const tag = String(release.tag_name || '');
  if (!tag || release.draft || release.prerelease) return;

  const previous = props.getProperty(APP_RELEASE.LAST_TAG_KEY);
  if (previous === tag) return;
  if (previous) {
    const version = tag.replace(/^v/i, '');
    sendFcmTopicMessage_('SEKNA ' + version + ' is available',
      'A new version of the SEKNA app is ready. Open SEKNA to install it.', null, 'usa', 'app_update');
  }
  props.setProperty(APP_RELEASE.LAST_TAG_KEY, tag);
}


/* ---------- v78: notifications for SEKNA on the web ---------- */
/**
 * Adds (or removes) a browser's notification token to the same topic the Android
 * app listens to, so the web app gets the same notifications. Only approved people.
 */
function webPushSubscribe(accessToken, pushToken, on) {
  assertAccess_(accessToken);
  pushToken = String(pushToken || '');
  if (pushToken.length < 20 || pushToken.length > 4096) throw new Error('Invalid notification token.');
  const props = PropertiesService.getScriptProperties();
  assertFirebaseCredentials_(props);
  const res = UrlFetchApp.fetch('https://iid.googleapis.com/iid/v1:' + (on === false ? 'batchRemove' : 'batchAdd'), {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getFirebaseAccessToken_(props), access_token_auth: 'true' },
    payload: JSON.stringify({ to: '/topics/' + FIREBASE_PUSH.TOPIC, registration_tokens: [pushToken] }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Could not update notifications (' + code + ').');
  const result = (JSON.parse(res.getContentText() || '{}').results || [])[0] || {};
  if (result.error) throw new Error('Could not update notifications: ' + result.error);
  try {
    const who = checkAccessToken_(accessToken);
    UrlFetchApp.fetch('https://iid.googleapis.com/iid/v1:' + (on === false ? 'batchRemove' : 'batchAdd'), {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + getFirebaseAccessToken_(props), access_token_auth: 'true' },
      payload: JSON.stringify({ to: '/topics/' + userPushTopic_(who.email), registration_tokens: [pushToken] })
    });
  } catch (e) {}
  return { ok: true, on: on !== false };
}


/* ---------- v87: monthly report email, share counts, ideas box, plan history ---------- */

const V87 = {
  SHARES_SHEET: 'SEKNA Shares',
  IDEAS_SHEET: 'SEKNA Ideas',
  USAGE_SHEET: 'SEKNA Usage',
  REPORTS_FOLDER: 'SEKNA Reports',
  PLAN_HISTORY_SHEET: 'SEKNA Plan History',
  IDEA_STATUSES: ['New', 'Reviewing', 'Planned', 'Done', 'Declined'],
  REPORT_MAX_BYTES: 15 * 1024 * 1024
};

/** A log sheet in the access spreadsheet, created with its header the first time. */
function v87Sheet_(name, header) {
  const ss = SpreadsheetApp.openById(ACCESS.SPREADSHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header])
      .setFontWeight('bold').setBackground('#203C8E').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

function v87Rows_(sh, width) {
  const last = sh.getLastRow();
  return last > 1 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
}

/** Everyone with an approved device, once per email. */
function approvedPeople_() {
  const seen = {};
  readAccessRows_(getAccessSheet_()).forEach(r => {
    if (r.status === 'Approved' && r.email && !seen[r.email]) {
      seen[r.email] = { email: r.email, name: r.name || nameFromEmail_(r.email) };
    }
  });
  return Object.keys(seen).map(k => seen[k]);
}

/* Monthly report ------------------------------------------------------------ */

function adminReportRecipients(token) {
  assertAdmin_(token);
  return { people: approvedPeople_(), quota: MailApp.getRemainingDailyQuota() };
}

/**
 * Emails the month's results PDF (built in the app) to every approved person, or only to
 * the admin as a test. One email each, so everyone is greeted by name.
 */
function adminSendMonthlyReport(token, pdfBase64, meta) {
  const me = assertAdmin_(token);
  meta = meta || {};
  const bytes = Utilities.base64Decode(String(pdfBase64 || ''));
  if (!bytes.length) throw new Error('The report is empty.');
  if (bytes.length > V87.REPORT_MAX_BYTES) throw new Error('The report is too large to email.');
  const title = String(meta.title || 'Media Plan results').slice(0, 120);
  const fileName = (String(meta.fileName || '').replace(/[^\w.\- ]/g, '').slice(0, 80) || 'SEKNA-Report') .replace(/\.pdf$/i, '') + '.pdf';
  const people = meta.testOnly
    ? [{ email: me.email, name: me.name || nameFromEmail_(me.email) }]
    : approvedPeople_();
  if (!people.length) throw new Error('There is no one to send the report to yet.');
  if (MailApp.getRemainingDailyQuota() < people.length) {
    throw new Error('Not enough email quota left today for ' + people.length + ' emails. Please try again tomorrow.');
  }
  const blob = Utilities.newBlob(bytes, 'application/pdf', fileName);
  // The email's button downloads the PDF, kept in a Drive folder that anyone with the link can view.
  let button = emailButton_(ACCESS.WEB_PAGE_URL, 'Open SEKNA', true);
  try {
    const it = DriveApp.getFoldersByName(V87.REPORTS_FOLDER);
    const folder = it.hasNext() ? it.next() : DriveApp.createFolder(V87.REPORTS_FOLDER);
    const file = folder.createFile(blob.copyBlob().setName(fileName));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    button = emailButton_('https://drive.google.com/uc?export=download&id=' + file.getId(), 'Download PDF', true);
  } catch (err) {
    console.error('Could not keep the report in Drive: ' + err);
  }
  const lines = (Array.isArray(meta.lines) ? meta.lines : []).slice(0, 4).map(l =>
    '<li style="margin:0 0 6px">' + escapeHtml_(String(l).slice(0, 220)) + '</li>').join('');
  const body = '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4c5464">' +
    escapeHtml_(String(meta.intro || 'The media plan results for the month are attached as a PDF.').slice(0, 300)) + '</p>' +
    (lines ? '<ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.5;color:#1d2433">' + lines + '</ul>' : '') +
    button;
  let sent = 0;
  const failed = [];
  people.forEach(p => {
    try {
      sendSeknaEmail_({
        to: p.email,
        name: ACCESS.SENDER_NAME,
        replyTo: ACCESS.SENDER_EMAIL,
        subject: (meta.testOnly ? '[Test] ' : '') + title,
        htmlBody: accessEmailHtml_('Hi ' + escapeHtml_(p.name) + ',', body),
        attachments: [blob]
      });
      sent++;
    } catch (err) {
      console.error('Report to ' + p.email + ' failed: ' + err);
      failed.push(p.email);
    }
  });
  return { sent: sent, failed: failed, testOnly: !!meta.testOnly };
}

/* WhatsApp share counts ----------------------------------------------------- */

/** Called by the app each time someone prepares a WhatsApp image. */
function logShare(token, kind, accountKey) {
  assertRestHere_();
  const a = assertAccess_(token);
  v87Sheet_(V87.SHARES_SHEET, ['Time', 'Email', 'Name', 'Screen', 'Account'])
    .appendRow([new Date(), a.email, a.name || '', String(kind || '').slice(0, 40), String(accountKey || '').slice(0, 12)]);
  return { ok: true };
}

function adminShareStats(token, monthKey) {
  assertRestHere_();
  assertAdmin_(token);
  const tz = Session.getScriptTimeZone();
  const month = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? String(monthKey) : Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const rows = v87Rows_(v87Sheet_(V87.SHARES_SHEET, ['Time', 'Email', 'Name', 'Screen', 'Account']), 5);
  const people = {}, kinds = {}, days = {}, months = {};
  let total = 0;
  rows.forEach(r => {
    if (!(r[0] instanceof Date)) return;
    const m = Utilities.formatDate(r[0], tz, 'yyyy-MM');
    months[m] = (months[m] || 0) + 1;
    if (m !== month) return;
    total++;
    const email = String(r[1] || '');
    (people[email] = people[email] || { email: email, name: String(r[2] || '') || nameFromEmail_(email), n: 0 }).n++;
    const k = String(r[3] || 'other');
    kinds[k] = (kinds[k] || 0) + 1;
    const d = Utilities.formatDate(r[0], tz, 'yyyy-MM-dd');
    days[d] = (days[d] || 0) + 1;
  });
  return {
    month: month,
    total: total,
    people: Object.keys(people).map(k => people[k]).sort((a, b) => b.n - a.n),
    kinds: Object.keys(kinds).map(k => ({ kind: k, n: kinds[k] })).sort((a, b) => b.n - a.n),
    days: days,
    months: Object.keys(months).sort().map(k => ({ month: k, n: months[k] }))
  };
}

/** Clears every share count (the admin's reset button). */
function adminResetShares(token) {
  assertRestHere_();
  assertAdmin_(token);
  const sh = v87Sheet_(V87.SHARES_SHEET, ['Time', 'Email', 'Name', 'Screen', 'Account']);
  const last = sh.getLastRow();
  if (last > 1) sh.deleteRows(2, last - 1);
  return { ok: true };
}

/* Ideas box: only the admin sees what people send --------------------------- */

const IDEA_COLS = ['ID', 'Time', 'Email', 'Name', 'Title', 'Idea', 'Status', 'Reply', 'Updated'];

function ideaFromRow_(r, tz) {
  const t = d => d instanceof Date ? Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ss") : '';
  return { id: String(r[0]), time: t(r[1]), email: String(r[2]), name: String(r[3]), title: String(r[4]),
    text: String(r[5]), status: String(r[6] || 'New'), reply: String(r[7] || ''), updated: t(r[8]) };
}

function submitIdea(token, title, text) {
  assertRestHere_();
  const a = assertAccess_(token);
  title = String(title || '').trim().slice(0, 120);
  text = String(text || '').trim().slice(0, 3000);
  if (!text) throw new Error('Please write your idea first.');
  const now = new Date();
  const id = 'IDEA-' + Utilities.formatDate(now, 'UTC', 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 5).toUpperCase();
  v87Sheet_(V87.IDEAS_SHEET, IDEA_COLS).appendRow([id, now, a.email, a.name || '', title, text, 'New', '', now]);
  try {
    sendSeknaEmail_({
      to: ACCESS.ADMIN_EMAIL,
      name: ACCESS.SENDER_NAME,
      replyTo: a.email,
      subject: '💡 New idea from ' + (a.name || a.email),
      htmlBody: accessEmailHtml_('New idea from ' + escapeHtml_(a.name || a.email),
        (title ? '<p style="margin:0 0 8px;font-size:15px;font-weight:700">' + escapeHtml_(title) + '</p>' : '') +
        '<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#4c5464;white-space:pre-wrap">' + escapeHtml_(text) + '</p>' +
        emailButton_(ACCESS.WEB_PAGE_URL, 'Open SEKNA', true))
    });
  } catch (e) {}
  return { ok: true, id: id };
}

function myIdeas(token) {
  assertRestHere_();
  const a = assertAccess_(token);
  const tz = Session.getScriptTimeZone();
  return v87Rows_(v87Sheet_(V87.IDEAS_SHEET, IDEA_COLS), IDEA_COLS.length)
    .filter(r => normalizeEmail_(r[2]) === normalizeEmail_(a.email))
    .map(r => ideaFromRow_(r, tz)).reverse();
}

function adminIdeas(token) {
  assertRestHere_();
  assertAdmin_(token);
  const tz = Session.getScriptTimeZone();
  return v87Rows_(v87Sheet_(V87.IDEAS_SHEET, IDEA_COLS), IDEA_COLS.length).map(r => ideaFromRow_(r, tz)).reverse();
}

/** The admin sets the status and/or a reply; the person who sent the idea gets an email. */
function adminIdeaUpdate(token, id, status, reply) {
  assertRestHere_();
  assertAdmin_(token);
  if (V87.IDEA_STATUSES.indexOf(status) < 0) throw new Error('Unknown status.');
  reply = String(reply || '').trim().slice(0, 2000);
  const sh = v87Sheet_(V87.IDEAS_SHEET, IDEA_COLS);
  const rows = v87Rows_(sh, IDEA_COLS.length);
  const i = rows.findIndex(r => String(r[0]) === String(id));
  if (i < 0) throw new Error('This idea no longer exists.');
  const r = rows[i];
  const changed = String(r[6]) !== status || String(r[7] || '') !== reply;
  sh.getRange(i + 2, 7, 1, 3).setValues([[status, reply, new Date()]]);
  if (changed && r[2]) {
    const label = { New: 'received', Reviewing: 'being reviewed', Planned: 'planned', Done: 'done ✅', Declined: 'not planned for now' }[status];
    try {
      sendSeknaEmail_({
        to: String(r[2]),
        name: ACCESS.SENDER_NAME,
        replyTo: ACCESS.SENDER_EMAIL,
        subject: 'Your SEKNA idea is ' + label,
        htmlBody: accessEmailHtml_('Hi ' + escapeHtml_(String(r[3] || nameFromEmail_(r[2]))) + ',',
          '<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#4c5464">Your idea' +
          (r[4] ? ' “' + escapeHtml_(r[4]) + '”' : '') + ' is now <b>' + escapeHtml_(label) + '</b>.</p>' +
          (reply ? '<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#1d2433;white-space:pre-wrap">' + escapeHtml_(reply) + '</p>' : '') +
          emailButton_(ACCESS.WEB_PAGE_URL, 'Open SEKNA', true))
      });
    } catch (e) {}
  }
  return { ok: true };
}

/* Plan history: the month's plan against what we achieved ------------------- */

const PLAN_HISTORY_COLS = ['Account', 'Month', 'Saved', 'Saved by', 'Snapshot'];

/**
 * Saves the current month's plan and results from the media plan sheet itself (the app's
 * numbers are not trusted), replacing an earlier save of the same month.
 */
function adminSavePlanHistory(token, accountKey) {
  assertRestHere_();
  const me = assertAdmin_(token);
  const key = normalizeAccountKey_(accountKey);
  const data = buildDashboardData_(key);
  const days = data.dayPlan || [];
  if (!days.length) throw new Error('The media plan sheet has no days for this month.');
  const live = days.filter(d => d.actual);
  // Only a closed month goes into the history: every day of it must have results.
  if (live.length < days.length) {
    throw new Error('The month is not closed yet: ' + live.length + ' of ' + days.length + ' days have results.');
  }
  const sum = (list, f) => list.reduce((a, d) => a + (Number(f(d)) || 0), 0);
  const month = days[0].date.slice(0, 7);
  const planFull = { spend: sum(days, d => d.plan.spend), conversions: sum(days, d => d.plan.conversions), value: sum(days, d => d.plan.value) };
  const planToDate = { spend: sum(live, d => d.plan.spend), conversions: sum(live, d => d.plan.conversions), value: sum(live, d => d.plan.value) };
  const actual = { spend: sum(live, d => d.actual.spend), conversions: sum(live, d => d.actual.conversions), value: sum(live, d => d.actual.value) };
  [planFull, planToDate, actual].forEach(o => { o.roas = safeDiv_(o.value, o.spend); });
  const snap = {
    account: key,
    month: month,
    hijriFrom: days[0].hijri || '',
    hijriTo: days[days.length - 1].hijri || '',
    daysTotal: days.length,
    daysLive: live.length,
    plan: planFull,
    planToDate: planToDate,
    actual: actual,
    channels: (data.channels || []).map(c => ({
      channel: c.channel, planSpend: c.planSpend, spend: c.actualSpend, planValue: c.planValue,
      value: c.actualValue, conversions: c.conversions, roas: c.roas
    })),
    savedAt: new Date().toISOString(),
    savedBy: me.email
  };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = v87Sheet_(V87.PLAN_HISTORY_SHEET, PLAN_HISTORY_COLS);
    const rows = v87Rows_(sh, PLAN_HISTORY_COLS.length);
    const i = rows.findIndex(r => String(r[0]) === key && String(r[1]) === month);
    const row = [key, month, new Date(), me.email, JSON.stringify(snap)];
    if (i >= 0) sh.getRange(i + 2, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
  } finally {
    lock.releaseLock();
  }
  return snap;
}

function getPlanHistory(token, accountKey) {
  assertRestHere_();
  assertAccess_(token);
  const key = normalizeAccountKey_(accountKey);
  const out = [];
  v87Rows_(v87Sheet_(V87.PLAN_HISTORY_SHEET, PLAN_HISTORY_COLS), PLAN_HISTORY_COLS.length).forEach(r => {
    if (String(r[0]) !== key) return;
    try { out.push(JSON.parse(String(r[4]))); } catch (e) {}
  });
  return out.sort((a, b) => String(b.month).localeCompare(String(a.month)));
}

/* App opens and time in the app ------------------------------------------- */

const USAGE_COLS = ['Time', 'Email', 'Name', 'Kind', 'Seconds', 'Account'];

/** The app reports an open, or the seconds it was on screen (at most an hour per call). */
function logUsage(token, kind, seconds, accountKey) {
  assertRestHere_();
  const a = assertAccess_(token);
  if (kind !== 'open' && kind !== 'time') return { ok: false };
  const sec = kind === 'time' ? Math.max(0, Math.min(3600, Math.round(Number(seconds) || 0))) : 0;
  v87Sheet_(V87.USAGE_SHEET, USAGE_COLS).appendRow([new Date(), a.email, a.name || '', kind, sec, String(accountKey || '').slice(0, 12)]);
  return { ok: true };
}

/** The admin's Activity panel: WhatsApp shares, app opens and time in the app this month. */
function adminActivity(token, monthKey) {
  assertRestHere_();
  assertAdmin_(token);
  const tz = Session.getScriptTimeZone();
  const month = /^\d{4}-\d{2}$/.test(String(monthKey || '')) ? String(monthKey) : Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const shares = adminShareStats(token, month);
  const opens = {}, time = {};
  let openTotal = 0, timeTotal = 0;
  v87Rows_(v87Sheet_(V87.USAGE_SHEET, USAGE_COLS), USAGE_COLS.length).forEach(r => {
    if (!(r[0] instanceof Date) || Utilities.formatDate(r[0], tz, 'yyyy-MM') !== month) return;
    const email = String(r[1] || ''), name = String(r[2] || '') || nameFromEmail_(email);
    if (r[3] === 'open') {
      (opens[email] = opens[email] || { email: email, name: name, n: 0 }).n++;
      openTotal++;
    } else if (r[3] === 'time') {
      const s = Number(r[4]) || 0;
      (time[email] = time[email] || { email: email, name: name, sec: 0 }).sec += s;
      timeTotal += s;
    }
  });
  return {
    month: month,
    shares: shares,
    opens: { total: openTotal, people: Object.keys(opens).map(k => opens[k]).sort((a, b) => b.n - a.n) },
    time: { total: timeTotal, people: Object.keys(time).map(k => time[k]).sort((a, b) => b.sec - a.sec) }
  };
}

/** Resets one counter: 'shares', 'opens' or 'time'. */
function adminResetActivity(token, kind) {
  assertRestHere_();
  assertAdmin_(token);
  if (kind === 'shares') return adminResetShares(token);
  if (kind !== 'opens' && kind !== 'time') throw new Error('Unknown counter.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = v87Sheet_(V87.USAGE_SHEET, USAGE_COLS);
    const rows = v87Rows_(sh, USAGE_COLS.length);
    const keep = rows.filter(r => r[3] !== (kind === 'opens' ? 'open' : 'time'));
    if (rows.length) sh.getRange(2, 1, rows.length, USAGE_COLS.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, USAGE_COLS.length).setValues(keep);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/* Top & Bottom 5 campaigns, ranked from the raw campaign rows ---------------- */

/**
 * The sheet's ranking let a campaign that spent £1 and brought £20 top the list. From the
 * current-month tab (one row per campaign per day) the dashboard ranks the day itself:
 *  - Top 5: best ROAS among campaigns that spent at least the minimum and had 2+ conversions.
 *  - Bottom 5: most money lost (spend − value) among campaigns that spent at least the minimum.
 * The minimum is 2% of the day's spend or £50, whichever is higher. Other blocks stay as the
 * sheet has them (keywords, search terms and the rest are not in the sheet as raw rows).
 */
function rerankCampaigns_(ss, account, tz, bw) {
  if (!bw || !bw.day) return;
  const sh = getOptionalSheet_(ss, account, 'currentMonth');
  if (!sh || sh.getLastRow() < 2) return;
  const byName = {};
  let daySpend = 0;
  sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues().forEach(r => {
    if (!r[0] || !r[2]) return;
    const d = asDate_(r[0]);
    if (!isFinite(d.getTime()) || Utilities.formatDate(d, tz, 'yyyy-MM-dd') !== bw.day) return;
    const name = String(r[2]).trim();
    const o = byName[name] || (byName[name] = { name: name, spend: 0, conversions: 0, value: 0 });
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
      key: 'campaigns', title: title, minSpend: minSpend, rankNote: note,
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

/* Server switches (v89, v90) ---------------------------------------------------
 * The dashboard data now comes from the SEKNA server on Firebase. When it fails, the
 * app moves to Apps Script by itself. Since v90 the switch log lives on the server;
 * Apps Script only sends the email (at most one every 3 hours), and keeps the log in
 * the "SEKNA Server" tab only when the server itself cannot be reached.
 */
const SERVER_LOG = { SHEET: 'SEKNA Server', EMAIL_EVERY_MS: 3 * 3600 * 1000, HEADER: ['Time', 'Name', 'Email', 'Server', 'Reason', 'Device'] };

function reportServerEvent(token, kind, reason, device) {
  const who = assertAccess_(token);
  const backup = kind !== 'firebase';
  reason = String(reason || '').slice(0, 200);
  v87Sheet_(SERVER_LOG.SHEET, SERVER_LOG.HEADER).appendRow([new Date(), who.name || '', who.email || '',
    backup ? 'Backup (Apps Script)' : 'Firebase', reason, cleanDevice_(device)]);
  if (backup) serverSwitchEmail_(who, reason);
  return { ok: true };
}

/** Called by the SEKNA server after it logged a switch: the email only. */
function notifyServerSwitch(token, reason) {
  serverSwitchEmail_(assertAccess_(token), String(reason || '').slice(0, 200));
  return { ok: true };
}

function serverSwitchEmail_(who, reason) {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('SEKNA_SERVER_EMAIL_AT')) || 0;
  if (Date.now() - last <= SERVER_LOG.EMAIL_EVERY_MS) return;
  props.setProperty('SEKNA_SERVER_EMAIL_AT', String(Date.now()));
  try {
    sendSeknaEmail_({
      to: ACCESS.ADMIN_EMAIL,
      name: ACCESS.SENDER_NAME,
      subject: '🟠 SEKNA moved to the backup server',
      htmlBody: accessEmailHtml_('SEKNA is running on the backup server',
        '<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#4c5464">The Firebase server did not answer, so SEKNA switched to Apps Script by itself. The team can keep working.</p>' +
        '<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#4c5464"><b>Reason:</b> ' + escapeHtml_(reason || 'Unknown') + '<br><b>Seen by:</b> ' + escapeHtml_(who.name || who.email) + '</p>' +
        '<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#4c5464">Open Admin → Server in SEKNA for details. If the monthly limit was reached, billing has to be turned back on in Google Cloud.</p>' +
        emailButton_(ACCESS.WEB_PAGE_URL, 'Open SEKNA', true))
    });
  } catch (e) {}
}

function adminServerEvents(token) {
  assertAdmin_(token);
  const sh = v87Sheet_(SERVER_LOG.SHEET, SERVER_LOG.HEADER);
  return v87Rows_(sh, SERVER_LOG.HEADER.length).filter(r => r[0]).slice(-40).reverse().map(r => ({
    at: r[0] instanceof Date ? r[0].getTime() : 0,
    name: String(r[1] || ''), email: String(r[2] || ''), server: String(r[3] || ''), reason: String(r[4] || ''), device: String(r[5] || '')
  }));
}

/** Admin → Server → Clear log: removes the rows kept in the sheet (the server clears its own). */
function adminClearServerEvents(token) {
  assertAdmin_(token);
  const sh = v87Sheet_(SERVER_LOG.SHEET, SERVER_LOG.HEADER);
  const last = sh.getLastRow();
  if (last > 1) sh.deleteRows(2, last - 1);
  return { ok: true };
}

/* ===================== Team Tasks =====================
 * One sheet ("SEKNA Tasks") holds every task as a row. Weekly tasks carry the month and the
 * weeks (1–4) they repeat in; quick requests are one-off asks with an optional deadline.
 * Managers (Team Leader, Media Manager, Head of Media) and the admins build the tasks;
 * everyone with access can see the board and tick their own tasks.
 */
const TASKS = {
  SHEET: 'SEKNA Tasks',
  COLS: ['ID', 'Kind', 'Month', 'Weeks', 'Email', 'Title', 'Data', 'Done', 'Created by', 'Created at', 'Updated at', 'Deadline'],
  MANAGER_ROLES: ['Team Leader', 'Media Manager', 'Head of Media'],
  CACHE_KEY: 'sekna_tasks_rows_v1',
  NOTICE_PROP: 'SEKNA_TASK_NOTICES',
  SENT_PROP: 'SEKNA_TASK_SENT'
};

function tasksSheet_() {
  const ss = SpreadsheetApp.openById(ACCESS.SPREADSHEET_ID);
  let sh = ss.getSheetByName(TASKS.SHEET);
  if (!sh) {
    sh = ss.insertSheet(TASKS.SHEET);
    sh.getRange(1, 1, 1, TASKS.COLS.length).setValues([TASKS.COLS])
      .setFontWeight('bold').setBackground('#203C8E').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  // Month, weeks and deadline stay plain text; otherwise Sheets turns "2026-10" into a date
  // and "1,2" into a number, and the tasks no longer match their month.
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SEKNA_TASKS_TEXT') !== '1') {
    sh.getRange('C:D').setNumberFormat('@');
    sh.getRange('L:L').setNumberFormat('@');
    const last = sh.getLastRow();
    if (last > 1) {
      const tz = ss.getSpreadsheetTimeZone();
      const rows = sh.getRange(2, 1, last - 1, TASKS.COLS.length).getValues().map(v => taskFromRow_(v, 0, tz));
      sh.getRange(2, 3, rows.length, 2).setValues(rows.map(t => [t.month, t.weeks.join(',')]));
      sh.getRange(2, 12, rows.length, 1).setValues(rows.map(t => [t.deadline]));
    }
    props.setProperty('SEKNA_TASKS_TEXT', '1');
  }
  return sh;
}
function readTaskRows_(fresh) {
  const hit = fresh ? null : getBigCache_(TASKS.CACHE_KEY);
  if (hit) return hit;
  const sh = tasksSheet_();
  const last = sh.getLastRow();
  const tz = sh.getParent().getSpreadsheetTimeZone();
  const rows = last < 2 ? [] : sh.getRange(2, 1, last - 1, TASKS.COLS.length).getValues().map((v, i) => taskFromRow_(v, i + 2, tz)).filter(t => t.id);
  try { putBigCache_(TASKS.CACHE_KEY, rows, 300); } catch (e) {}
  return rows;
}
function taskFromRow_(v, row, tz) {
  const parse = (x, d) => { try { return x ? JSON.parse(x) : d; } catch (e) { return d; } };
  // Rows written before the text format may hold a Date (month, deadline) or a number (weeks).
  const day = (x, f) => x instanceof Date ? Utilities.formatDate(x, tz || 'Asia/Muscat', f) : String(x || '');
  const weeks = [];
  String(v[3] == null ? '' : v[3]).replace(/[^1-4]/g, '').split('').forEach(n => { n = Number(n); if (weeks.indexOf(n) < 0) weeks.push(n); });
  return {
    row: row, id: String(v[0] || ''), kind: String(v[1] || 'weekly'), month: day(v[2], 'yyyy-MM').slice(0, 7),
    weeks: weeks.sort(),
    email: normalizeEmail_(v[4]), title: String(v[5] || ''), data: parse(v[6], {}), done: parse(v[7], {}),
    by: String(v[8] || ''), at: v[9] instanceof Date ? v[9].getTime() : Number(v[9]) || 0,
    upd: v[10] instanceof Date ? v[10].getTime() : Number(v[10]) || 0, deadline: day(v[11], 'yyyy-MM-dd')
  };
}
function taskToRow_(t) {
  return [t.id, t.kind, t.month, t.weeks.join(','), t.email, t.title, JSON.stringify(t.data || {}), JSON.stringify(t.done || {}),
    t.by, new Date(t.at || Date.now()), new Date(), t.deadline || ''];
}
function clearTasksCache_() {
  try { const c = CacheService.getScriptCache(); const n = Number(c.get(TASKS.CACHE_KEY + '_n')) || 0; c.remove(TASKS.CACHE_KEY + '_n'); for (let i = 0; i < n; i++) c.remove(TASKS.CACHE_KEY + '_' + i); } catch (e) {}
}
function canManageTasks_(email) {
  email = normalizeEmail_(email);
  if (isAdminEmail_(email)) return true;
  const m = getMembers_()[email] || {};
  return TASKS.MANAGER_ROLES.indexOf(m.role) >= 0;
}
function assertTaskManager_(token) {
  const a = assertAccess_(token);
  if (!canManageTasks_(a.email)) throw new Error('Only the Head of Media, Media Managers, Team Leaders and Ibrahim Amin can build tasks.');
  return a;
}
function taskMonthOk_(m) { if (!/^\d{4}-\d{2}$/.test(String(m || ''))) throw new Error('Bad month'); return String(m); }
function teamPeople_(me) {
  const members = getMembers_(), seen = {}, out = [], status = {};
  const add = (email, name) => {
    if (!email || seen[email]) return;
    seen[email] = 1;
    const m = members[email] || {};
    out.push({ email: email, name: name || m.name || email.split('@')[0], role: m.role || '', avatar: m.avatar || 0 });
  };
  const rows = readAccessRows_(getAccessSheet_());
  rows.forEach(r => { if (r.email) status[r.email] = status[r.email] === 'Approved' ? 'Approved' : r.status; });
  rows.forEach(r => { if (r.status === 'Approved') add(r.email, r.name); });
  // Leaders and managers with a position, and the person asking, so they can get tasks too.
  Object.keys(members).forEach(e => { if (members[e] && members[e].role && (!status[e] || status[e] === 'Approved')) add(e, ''); });
  if (me && me.email) add(normalizeEmail_(me.email), me.name);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function publicTask_(t) {
  return { id: t.id, kind: t.kind, month: t.month, weeks: t.weeks, email: t.email, title: t.title, data: t.data, done: t.done, by: t.by, at: t.at, deadline: t.deadline };
}

/** Everything the Team Tasks pages need for one month, in one call. */
function tasksLoad(token, month) {
  assertTasksHere_();
  const a = assertAccess_(token);
  month = taskMonthOk_(month);
  const rows = readTaskRows_();
  const weekAgo = Date.now() - 14 * 864e5;
  const prev = (() => { const y = +month.slice(0, 4), m = +month.slice(5, 7); const d = new Date(y, m - 2, 1); return Utilities.formatDate(d, 'UTC', 'yyyy-MM'); })();
  let sent = {};
  try { sent = (JSON.parse(PropertiesService.getScriptProperties().getProperty(TASKS.SENT_PROP) || '{}') || {})[month] || {}; } catch (e) {}
  return {
    me: { email: a.email, name: a.name || '', canManage: canManageTasks_(a.email) },
    people: teamPeople_(a),
    month: month,
    tasks: rows.filter(t => t.kind === 'weekly' && t.month === month).map(publicTask_),
    quick: rows.filter(t => t.kind === 'quick' && (!t.done.at || t.done.at > weekAgo)).map(publicTask_),
    leave: rows.filter(t => t.kind === 'leave' && (t.month === month || t.month === 'ALL')).map(publicTask_),
    freeze: getLeaveFreeze_(),
    prevCount: rows.filter(t => t.kind === 'weekly' && t.month === prev).length,
    sent: sent
  };
}

/** Create or edit a weekly task or a quick request. */
function taskSave(token, task) {
  assertTasksHere_();
  const a = assertTaskManager_(token);
  task = task || {};
  // weekly tasks, quick requests, or days off ("leave") with an optional backup
  const kind = ['quick', 'leave'].indexOf(task.kind) >= 0 ? task.kind : 'weekly';
  const email = normalizeEmail_(task.email);
  // Weekly = the regular day off every week; Sick / Other are dated extras for one month.
  const LEAVE_TYPES = ['Weekly', 'Sick', 'Other', 'Vacation'];
  const leaveType = LEAVE_TYPES.indexOf((task.data || {}).type) >= 0 ? task.data.type : 'Weekly';
  const title = kind === 'leave' ? leaveType : String(task.title || '').trim().slice(0, 140);
  if (!email) throw new Error('Choose who the task is for.');
  if (!title) throw new Error('Give the task a name.');
  const d = task.data || {};
  const clean = {
    // HA-USA, HA-AR or both. Older tasks kept a single "account".
    accounts: (Array.isArray(d.accounts) ? d.accounts : [d.account]).filter((a, i, all) => (a === 'usa' || a === 'ar') && all.indexOf(a) === i),
    platforms: (Array.isArray(d.platforms) ? d.platforms : []).filter(p => p === 'google' || p === 'microsoft'),
    snaps: (Array.isArray(d.snaps) ? d.snaps : []).slice(0, 12).map(s => ({ n: String(s.n || '').trim().slice(0, 60), t: String(s.t || '').slice(0, 10) })).filter(s => s.n),
    msg: String(d.msg || '').trim().slice(0, 600),
    // Picked days (1–31) instead of whole weeks, e.g. only the 1st and the 7th.
    days: (Array.isArray(d.days) ? d.days : []).map(Number).filter((n, i, all) => n >= 1 && n <= 31 && Math.round(n) === n && all.indexOf(n) === i).sort((a, b) => a - b)
  };
  if (kind === 'leave') {
    // Team Leaders, Media Managers, the Head of Media and the admin set days off and backups.
    if (!canManageTasks_(a.email)) throw new Error('Only Team Leaders, Media Managers, the Head of Media and Ibrahim Amin can set days off.');
    const backup = normalizeEmail_(d.backup);
    clean.type = leaveType;
    clean.backup = backup && backup !== email ? backup : '';
    clean.note = clean.msg;
    if (leaveType === 'Weekly') {
      clean.weekdays = (Array.isArray(d.weekdays) ? d.weekdays : []).map(Number).filter((n, i, all) => n >= 0 && n <= 6 && Math.round(n) === n && all.indexOf(n) === i).sort();
      clean.days = [];
      if (!clean.weekdays.length) throw new Error('Pick the weekly day off.');
    } else if (!clean.days.length) throw new Error('Pick the days off.');
  }
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sh = tasksSheet_();
    const rows = readTaskRows_(true);
    let old = task.id ? rows.filter(r => r.id === task.id)[0] : null;
    // One weekly day-off row per person: a second one updates the first.
    if (!old && kind === 'leave' && leaveType === 'Weekly') old = rows.filter(r => r.kind === 'leave' && r.email === email && (r.data || {}).type === 'Weekly')[0] || null;
    const t = old || { id: (kind === 'quick' ? 'Q-' : kind === 'leave' ? 'L-' : 'T-') + Utilities.getUuid().slice(0, 8).toUpperCase(), kind: kind, at: Date.now(), by: a.email, done: {} };
    t.kind = kind; t.email = email; t.title = title; t.data = clean;
    t.month = kind === 'leave' && leaveType === 'Weekly' ? 'ALL' : kind !== 'quick' ? taskMonthOk_(task.month) : (t.month || Utilities.formatDate(new Date(), 'Asia/Muscat', 'yyyy-MM'));
    t.weeks = kind === 'weekly' ? (Array.isArray(task.weeks) ? task.weeks : []).map(Number).filter(n => n >= 1 && n <= 4).sort() : [];
    if (kind !== 'quick' && clean.days.length) t.weeks = clean.days.map(n => n <= 7 ? 1 : n <= 14 ? 2 : n <= 21 ? 3 : 4).filter((n, i, all) => all.indexOf(n) === i);
    if (kind === 'weekly' && !t.weeks.length) throw new Error('Choose at least one week.');
    t.deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(task.deadline || '')) ? String(task.deadline) : '';
    if (old) sh.getRange(old.row, 1, 1, TASKS.COLS.length).setValues([taskToRow_(t)]);
    else sh.appendRow(taskToRow_(t));
    clearTasksCache_();
    if (kind === 'quick' && !old) setTaskNotice_([email], 'New request: ' + title);
    return publicTask_(t);
  } finally { lock.releaseLock(); }
}

function taskDelete(token, id) {
  assertTasksHere_();
  assertTaskManager_(token);
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const t = readTaskRows_(true).filter(r => r.id === String(id))[0];
    if (!t) return { ok: true };
    if (t.kind === 'leave' && !canManageTasks_(checkAccessToken_(token).email)) throw new Error('Only Team Leaders, Media Managers, the Head of Media and Ibrahim Amin can change days off.');
    tasksSheet_().deleteRow(t.row);
    clearTasksCache_();
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/** Tick or untick a task (week 1–4 for weekly tasks, 0 for a quick request). */
function taskDone(token, id, week, done) {
  assertTasksHere_();
  const a = assertAccess_(token);
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const t = readTaskRows_(true).filter(r => r.id === String(id))[0];
    if (!t) throw new Error('This task was removed.');
    if (t.email !== a.email && !canManageTasks_(a.email)) throw new Error('Only the person on the task can tick it.');
    const k = t.kind === 'quick' ? 'at' : String(Math.max(1, Math.min(4, Number(week) || 1)));
    if (done) t.done[k] = Date.now(); else delete t.done[k];
    tasksSheet_().getRange(t.row, 8).setValue(JSON.stringify(t.done));
    clearTasksCache_();
    return publicTask_(t);
  } finally { lock.releaseLock(); }
}

/** Copies last month's weekly tasks into this month (ticks cleared). */
function tasksCopyMonth(token, fromMonth, toMonth) {
  assertTasksHere_();
  const a = assertTaskManager_(token);
  fromMonth = taskMonthOk_(fromMonth); toMonth = taskMonthOk_(toMonth);
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const rows = readTaskRows_(true);
    const have = {};
    rows.filter(t => t.kind === 'weekly' && t.month === toMonth).forEach(t => { have[t.email + '|' + t.title] = 1; });
    const add = rows.filter(t => t.kind === 'weekly' && t.month === fromMonth && !have[t.email + '|' + t.title]).map(t => taskToRow_({
      id: 'T-' + Utilities.getUuid().slice(0, 8).toUpperCase(), kind: 'weekly', month: toMonth, weeks: t.weeks, email: t.email,
      title: t.title, data: t.data, done: {}, by: a.email, at: Date.now(), deadline: ''
    }));
    if (add.length) {
      const sh = tasksSheet_();
      sh.getRange(sh.getLastRow() + 1, 1, add.length, TASKS.COLS.length).setValues(add);
      clearTasksCache_();
    }
    return { copied: add.length };
  } finally { lock.releaseLock(); }
}

/** Emails each person only their own tasks for that week and lets them know in the app. */
function tasksSendWeek(token, month, week) {
  assertTasksHere_();
  const a = assertTaskManager_(token);
  month = taskMonthOk_(month); week = Math.max(1, Math.min(4, Number(week) || 1));
  const people = {};
  teamPeople_().forEach(p => { people[p.email] = p; });
  const mine = {};
  readTaskRows_().filter(t => t.kind === 'weekly' && t.month === month && t.weeks.indexOf(week) >= 0)
    .forEach(t => { (mine[t.email] = mine[t.email] || []).push(t); });
  const y = +month.slice(0, 4), m = +month.slice(5, 7), dim = new Date(y, m, 0).getDate();
  const from = (week - 1) * 7 + 1, to = week === 4 ? dim : week * 7;
  const monthName = Utilities.formatDate(new Date(y, m - 1, 1), 'UTC', 'MMMM');
  const range = from + '–' + to + ' ' + monthName;
  const emails = Object.keys(mine);
  emails.forEach(email => {
    const p = people[email] || { name: email.split('@')[0] };
    const list = mine[email].map(t => {
      const d = t.data || {};
      const tags = [(d.accounts || (d.account ? [d.account] : [])).map(x => 'HA-' + x.toUpperCase()).join(' + '), (d.platforms || []).map(x => x === 'google' ? 'Google' : 'Microsoft').join(' + ')].filter(Boolean).join(' · ');
      const snaps = (d.snaps || []).map(s => '<li style="margin:2px 0">' + escapeHtml_(s.n) + (s.t ? ' — <b>' + escapeHtml_(s.t) + '</b> Egypt time' : '') + '</li>').join('');
      const days = (d.days || []).filter(n => n >= from && n <= to);
      return '<div style="border:1px solid #e6eaf4;border-radius:12px;padding:12px 14px;margin:0 0 10px">' +
        '<div style="font-weight:800;font-size:15px">' + escapeHtml_(t.title) + '</div>' +
        (days.length ? '<div style="font-size:12px;color:#3d6bff;font-weight:700;margin-top:2px">Only on day ' + days.join(', ') + '</div>' : '') +
        (tags ? '<div style="font-size:12px;color:#8a92a0;margin-top:2px">' + escapeHtml_(tags) + '</div>' : '') +
        (snaps ? '<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;color:#4c5464">' + snaps + '</ul>' : '') +
        (d.msg ? '<div style="margin-top:8px;font-size:13px;color:#4c5464;background:#f8f9fc;border-radius:8px;padding:8px 10px">' + escapeHtml_(d.msg) + '</div>' : '') + '</div>';
    }).join('');
    try {
      sendSeknaEmail_({
        to: email, name: ACCESS.SENDER_NAME, replyTo: a.email,
        subject: '📋 Your SEKNA tasks — Week ' + week + ' (' + range + ')',
        htmlBody: accessEmailHtml_('Week ' + week + ' tasks · ' + escapeHtml_(range),
          '<p style="margin:0 0 14px;font-size:14px;color:#4c5464">Hi ' + escapeHtml_(String(p.name).split(' ')[0]) + ', here are your tasks for this week.</p>' + list +
          emailButton_(ACCESS.WEB_PAGE_URL + '/?tasks=mine', 'Open My Tasks', true))
      });
    } catch (e) { console.error('Task email to ' + email + ' failed: ' + e); }
  });
  setTaskNotice_(emails, 'Week ' + week + ' · ' + range, e => mine[e].length);
  emails.forEach(email => { try { sendUserPush_(email, 'SEKNA · Week ' + week + ' tasks', 'Your tasks for ' + range + ' are ready.'); } catch (e) {} });
  const props = PropertiesService.getScriptProperties();
  let sent = {};
  try { sent = JSON.parse(props.getProperty(TASKS.SENT_PROP) || '{}') || {}; } catch (e) {}
  Object.keys(sent).sort().slice(0, -6).forEach(k => delete sent[k]);
  (sent[month] = sent[month] || {})[week] = Date.now();
  props.setProperty(TASKS.SENT_PROP, JSON.stringify(sent));
  return { sent: emails.length, at: sent[month][week] };
}

/** Leave freeze for busy seasons (Ramadan, Eid…): weekly days off stop while it is on. */
function getLeaveFreeze_() {
  try { const f = JSON.parse(PropertiesService.getScriptProperties().getProperty('SEKNA_LEAVE_FREEZE') || '{}') || {}; return { on: !!f.on, seasons: Array.isArray(f.seasons) ? f.seasons : [] }; }
  catch (e) { return { on: false, seasons: [] }; }
}
function leaveFrozenOn_(iso) {
  const f = getLeaveFreeze_();
  return f.on || f.seasons.some(s => s.from && s.to && s.from <= iso && iso <= s.to);
}
function leaveFreezeSet(token, cfg) {
  assertTasksHere_();
  const a = assertAccess_(token);
  if (!canManageTasks_(a.email)) throw new Error('Only Team Leaders, Media Managers, the Head of Media and Ibrahim Amin can freeze leave.');
  cfg = cfg || {};
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const seasons = (Array.isArray(cfg.seasons) ? cfg.seasons : []).slice(0, 12)
    .map(s => ({ name: String(s.name || 'Season').trim().slice(0, 40), from: String(s.from || ''), to: String(s.to || '') }))
    .filter(s => ok(s.from) && ok(s.to)).map(s => s.from > s.to ? { name: s.name, from: s.to, to: s.from } : s);
  const out = { on: !!cfg.on, seasons: seasons };
  PropertiesService.getScriptProperties().setProperty('SEKNA_LEAVE_FREEZE', JSON.stringify(out));
  return out;
}
function leavesToday_(rows) {
  const now = new Date();
  const month = Utilities.formatDate(now, 'Asia/Muscat', 'yyyy-MM');
  const day = Number(Utilities.formatDate(now, 'Asia/Muscat', 'd'));
  const wd = (Number(Utilities.formatDate(now, 'Asia/Muscat', 'u')) + 1) % 7; // 0 = Saturday … 6 = Friday
  const frozen = leaveFrozenOn_(Utilities.formatDate(now, 'Asia/Muscat', 'yyyy-MM-dd'));
  return rows.filter(t => t.kind === 'leave' && t.data && (t.data.type === 'Weekly'
    ? !frozen && (t.data.weekdays || []).indexOf(wd) >= 0
    : t.month === month && (t.data.days || []).indexOf(day) >= 0 && !(frozen && t.data.type === 'Vacation')));
}

/** Who this person covers today (their leave has them as backup), with that person's snapshots for today. */
function backupTodayFor_(email) {
  email = normalizeEmail_(email);
  const now = new Date();
  const month = Utilities.formatDate(now, 'Asia/Muscat', 'yyyy-MM');
  const day = Number(Utilities.formatDate(now, 'Asia/Muscat', 'd'));
  let rows;
  try { rows = readTaskRows_(); } catch (e) { return []; }
  const leaves = leavesToday_(rows).filter(t => t.data.backup === email);
  if (!leaves.length) return [];
  const names = {};
  try { readAccessRows_(getAccessSheet_()).forEach(r => { if (r.email && !names[r.email]) names[r.email] = r.name; }); } catch (e) {}
  const week = day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4;
  return leaves.map(l => {
    const tasks = rows.filter(t => t.kind === 'weekly' && t.month === month && t.email === l.email && t.weeks.indexOf(week) >= 0 &&
      (!((t.data || {}).days || []).length || t.data.days.indexOf(day) >= 0));
    const snaps = [];
    tasks.forEach(t => {
      const acc = ((t.data || {}).accounts || []).map(x => x === 'usa' ? 'US' : 'AR').join(' + ');
      ((t.data || {}).snaps || []).forEach(s => snaps.push({ n: s.n, t: s.t, acc: acc }));
    });
    return { email: l.email, name: names[l.email] || l.email.split('@')[0], type: l.data.type || 'Vacation', tasks: tasks.length, snaps: snaps.slice(0, 10) };
  });
}

/**
 * Every morning (9 AM Cairo) each backup gets a push on their phone: who is off today and the first snapshot.
 * Run installLeaveMorningPush() once from the Apps Script editor to start it.
 */
function leaveMorningPush() {
  if (tasksMoved_()) return; // the SEKNA server sends it now
  let rows;
  try { rows = readTaskRows_(true); } catch (e) { return; }
  const now = new Date();
  const month = Utilities.formatDate(now, 'Asia/Muscat', 'yyyy-MM');
  const day = Number(Utilities.formatDate(now, 'Asia/Muscat', 'd'));
  const backups = {};
  leavesToday_(rows).filter(t => t.data.backup).forEach(t => { backups[t.data.backup] = 1; });
  const toMin = s => { const m = String(s || '').match(/^(\d+):(\d+) (AM|PM)$/); return m ? (Number(m[1]) % 12 + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) : 9999; };
  Object.keys(backups).forEach(email => {
    backupTodayFor_(email).forEach(b => {
      const snaps = (b.snaps || []).slice().sort((x, y) => toMin(x.t) - toMin(y.t));
      const first = String(b.name).split(' ')[0];
      const body = first + ' is off today — you are covering. ' +
        (snaps.length ? snaps.length + ' snapshot' + (snaps.length > 1 ? 's' : '') + ', first ' + snaps[0].n + ' at ' + snaps[0].t + '.' : 'Open SEKNA for the details.');
      try { sendUserPush_(email, 'SEKNA · You are the backup today', body); } catch (e) { console.error('Backup push to ' + email + ' failed: ' + e); }
    });
  });
}
function installLeaveMorningPush() {
  assertOwnerRun_();
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'leaveMorningPush').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('leaveMorningPush').timeBased().everyDays(1).atHour(9).inTimezone('Africa/Cairo').create();
  return 'Backups will get a push every day around 9 AM Cairo time.';
}

/** A small "new tasks" notice the app shows the next time each person opens it. */
function setTaskNotice_(emails, text, countOf) {
  const props = PropertiesService.getScriptProperties();
  let all = {};
  try { all = JSON.parse(props.getProperty(TASKS.NOTICE_PROP) || '{}') || {}; } catch (e) {}
  emails.forEach(e => { all[e] = { at: Date.now(), text: String(text).slice(0, 120), count: countOf ? countOf(e) : 1 }; });
  props.setProperty(TASKS.NOTICE_PROP, JSON.stringify(all));
}
function taskNoticeFor_(email) {
  try { return (JSON.parse(PropertiesService.getScriptProperties().getProperty(TASKS.NOTICE_PROP) || '{}') || {})[normalizeEmail_(email)] || null; } catch (e) { return null; }
}

/** Each signed-in browser also joins a topic of its own, so one person can get a push. */
function userPushTopic_(email) { return 'sekna-u-' + sha256Hex_(normalizeEmail_(email)).slice(0, 24); }
function sendUserPush_(email, title, body) {
  const props = PropertiesService.getScriptProperties();
  assertFirebaseCredentials_(props);
  const res = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(props.getProperty('FIREBASE_PROJECT_ID')) + '/messages:send', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + getFirebaseAccessToken_(props) },
    payload: JSON.stringify({ message: { topic: userPushTopic_(email), data: { title: String(title), body: String(body), eventType: 'tasks' }, android: { priority: 'HIGH', ttl: '86400s' }, webpush: { headers: { Urgency: 'high', TTL: '86400' } } } })
  });
  return res.getResponseCode();
}

/* ---------- Team Tasks on the SEKNA server (Firebase) ----------
 * The admin moves Team Tasks once from Admin → Server. After that this script keeps only
 * two jobs for the server: sending its emails and pushes (relaySend), and a copy of members. */
function tasksMoved_() { return PropertiesService.getScriptProperties().getProperty('SEKNA_TASKS_MOVED') === '1'; }
function assertTasksHere_() {
  if (tasksMoved_()) throw new Error('Team Tasks moved to the new SEKNA server. Close SEKNA and open it again.');
}
/** The settings the move copies: members, leave freeze, "new tasks" notices, weeks sent. lock: stop answering Team Tasks here. */
function tasksExportProps(token, lock) {
  assertAdmin_(token);
  const props = PropertiesService.getScriptProperties();
  const read = (k, d) => { try { return JSON.parse(props.getProperty(k) || '') || d; } catch (e) { return d; } };
  if (lock) props.setProperty('SEKNA_TASKS_MOVED', '1');
  return { members: getMembers_(), freeze: getLeaveFreeze_(), notices: read(TASKS.NOTICE_PROP, {}), sent: read(TASKS.SENT_PROP, {}), moved: tasksMoved_() };
}
/** Position, "new tasks" notice and today's backups, as the access status gives them. */
function teamStatus(token) {
  const a = assertAccess_(token);
  return { member: getMembers_()[normalizeEmail_(a.email)] || {}, taskNotice: taskNoticeFor_(a.email), backupToday: backupTodayFor_(a.email) };
}
/**
 * Emails and pushes asked for by the SEKNA server. Google signs the server's request (an identity
 * token), and Google checks it here, so only that server account can use this; no key is stored.
 */
function relaySend(idToken, payload) {
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(idToken || '')), { muteHttpExceptions: true });
  let info = {};
  try { info = JSON.parse(res.getContentText()) || {}; } catch (e) {}
  if (res.getResponseCode() !== 200 || info.aud !== 'sekna-relay' || info.email !== 'sekna-server@human-appeal-media-plan.iam.gserviceaccount.com' || String(info.email_verified) !== 'true') {
    throw new Error('SEKNA_RELAY_DENIED');
  }
  payload = payload || {};
  let emails = 0, pushes = 0;
  (Array.isArray(payload.emails) ? payload.emails : []).slice(0, 60).forEach(m => {
    const to = normalizeEmail_(m.to);
    if (!to) return;
    try {
      sendSeknaEmail_({ to: to, name: ACCESS.SENDER_NAME, replyTo: m.replyTo ? normalizeEmail_(m.replyTo) : undefined,
        subject: String(m.subject || 'SEKNA').slice(0, 200),
        htmlBody: accessEmailHtml_(String(m.title || ''), String(m.html || '') +
          (m.button && m.button.url ? emailButton_(String(m.button.url), String(m.button.label || 'Open SEKNA'), true) : '') +
          (Array.isArray(m.buttons) ? m.buttons.slice(0, 3).map(b => emailButton_(String(b.url || ''), String(b.label || 'Open'), !!b.primary)).join('') : '') +
          (m.footer ? '<p style="margin:18px 0 0;font-size:12px;color:#8a92a0">' + escapeHtml_(m.footer) + '</p>' : '')) });
      emails++;
    } catch (e) { console.error('Relay email to ' + to + ' failed: ' + e); }
  });
  (Array.isArray(payload.pushes) ? payload.pushes : []).slice(0, 60).forEach(p => {
    try { if (normalizeEmail_(p.email)) { sendUserPush_(normalizeEmail_(p.email), String(p.title || 'SEKNA'), String(p.body || '')); pushes++; } }
    catch (e) { console.error('Relay push to ' + p.email + ' failed: ' + e); }
  });
  let topics = 0;
  (Array.isArray(payload.topics) ? payload.topics : []).slice(0, 5).forEach(t => {
    try { sendFcmTopicMessage_(String(t.title || 'SEKNA'), String(t.body || ''), null, String(t.account || 'usa'), String(t.eventType || 'announcement')); topics++; }
    catch (e) { console.error('Relay topic push failed: ' + e); }
  });
  // The server keeps maintenance and the team message; this copy feeds the Apps Script backup.
  if (payload.appState && typeof payload.appState === 'object') setAppState_(payload.appState);
  return { emails: emails, pushes: pushes, topics: topics };
}

/* ---------- Sign-in on the SEKNA server (Firebase) ----------
 * After the admin moves sign-in (Admin → Server), the server keeps the devices and rewrites
 * the SEKNA Access sheet as a copy after every change, so the checks below keep working. */
function accessMoved_() { return PropertiesService.getScriptProperties().getProperty('SEKNA_ACCESS_MOVED') === '1'; }
function assertAccessHere_() {
  if (accessMoved_()) throw new Error('Sign-in moved to the new SEKNA server. Close SEKNA and open it again.');
}
/** What the move copies: the key that signs review links, and maintenance / team message. lock: stop sign-in changes here. */
function accessExportProps(token, lock) {
  assertAdmin_(token);
  if (lock) PropertiesService.getScriptProperties().setProperty('SEKNA_ACCESS_MOVED', '1');
  return { secret: getAccessSecret_(), app: getAppState_(), moved: accessMoved_() };
}

/* ---------- Everything else on the SEKNA server ----------
 * Usage and share counts, ideas, plan history and the "new day" notifications move with
 * Admin → Server → Move the rest. The monthly report and web notifications keep working
 * here as the server's fallback until the Gmail password and the push permission are set. */
function restMoved_() { return PropertiesService.getScriptProperties().getProperty('SEKNA_REST_MOVED') === '1'; }
function assertRestHere_() {
  if (restMoved_()) throw new Error('This moved to the new SEKNA server. Close SEKNA and open it again.');
}
/** Where the notifications are up to (so the server neither repeats nor misses a day). lock: stop here. */
function restExportProps(token, lock) {
  assertAdmin_(token);
  const props = PropertiesService.getScriptProperties();
  const day = k => { try { return JSON.parse(props.getProperty(pushSnapshotProperty_(k)) || 'null'); } catch (e) { return null; } };
  const out = { pushDays: {}, releaseTag: props.getProperty(APP_RELEASE.LAST_TAG_KEY) || '', serverMailAt: Number(props.getProperty('SEKNA_SERVER_EMAIL_AT')) || 0 };
  FIREBASE_PUSH.ACCOUNTS.forEach(k => { const d = day(k); if (d && d.date) out.pushDays[k] = d; });
  if (lock) props.setProperty('SEKNA_REST_MOVED', '1');
  out.moved = restMoved_();
  return out;
}
