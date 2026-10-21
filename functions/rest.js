// The rest of Code.gs on the SEKNA server: usage and share counts, the ideas box, plan history,
// the monthly report email, web notifications, and the "new day" phone notifications.
// Until the admin moves them (adminRestMove), every call is passed to Apps Script.
const { fsGet, fsSet, fsUpdate, fsAppend, fsList, fsSetList, batchGet, a1, sheetMeta } = require('./google');
const { ACCESS, assertAccess, assertAdmin, storeRows } = require('./access');
const notify = require('./notify');

const SHEETS = { shares: 'SEKNA Shares', usage: 'SEKNA Usage', ideas: 'SEKNA Ideas', plans: 'SEKNA Plan History' };
const IDEA_STATUSES = ['New', 'Reviewing', 'Planned', 'Done', 'Declined'];
const TZ = 'Asia/Muscat';
const WEB_PAGE_URL = 'https://sekna-app.web.app';
const REPORT_MAX_BYTES = 15 * 1024 * 1024;
const DOC = {
  mode: 'rest/mode', shareMonths: 'rest/share-months', usageDays: 'rest/usage-days', ideas: 'rest/ideas',
  shares: m => 'rest/shares-' + m, usage: d => 'rest/usage-' + d, plans: k => 'rest/plan-' + k,
  push: 'rest/push', serverMail: 'rest/server-mail'
};

const norm = e => String(e || '').trim().toLowerCase();
const esc = notify.esc;
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0];
  const part = local.split(/[._\-+0-9]+/).filter(Boolean)[0] || local;
  return part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : 'there';
}
function parts(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return p;
}
const monthOf = ms => { const p = parts(ms); return `${p.year}-${p.month}`; };
const dayOf = ms => { const p = parts(ms); return `${p.year}-${p.month}-${p.day}`; };
const isoLocal = ms => { if (!ms) return ''; const p = parts(ms); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; };
const P = s => '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4c5464">' + s + '</p>';
const shortId = () => require('crypto').randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
const monthOk = m => (/^\d{4}-\d{2}$/.test(String(m || '')) ? String(m) : monthOf(Date.now()));

async function approvedPeople() {
  const seen = {};
  (await storeRows(true)).forEach(r => { if (r.status === 'Approved' && r.email && !seen[r.email]) seen[r.email] = { email: r.email, name: r.name || nameFromEmail(r.email) }; });
  return Object.keys(seen).map(k => seen[k]);
}

/* ---------- moved yet? ---------- */
let modeCache = null;
async function moved() {
  if (modeCache && Date.now() - modeCache.at < 30000) return modeCache.on;
  const m = await fsGet(DOC.mode);
  modeCache = { at: Date.now(), on: !!(m && m.mode === 'firebase') };
  return modeCache.on;
}

/* ---------- share counts ---------- */
async function shareStats(month) {
  const rows = await fsList(DOC.shares(month));
  const people = {}, kinds = {}, days = {};
  rows.forEach(r => {
    const email = r.email || '';
    (people[email] = people[email] || { email, name: r.name || nameFromEmail(email), n: 0 }).n++;
    const k = r.kind || 'other'; kinds[k] = (kinds[k] || 0) + 1;
    const d = dayOf(r.t); days[d] = (days[d] || 0) + 1;
  });
  const months = (await fsGet(DOC.shareMonths)) || {};
  return {
    month, total: rows.length,
    people: Object.keys(people).map(k => people[k]).sort((a, b) => b.n - a.n),
    kinds: Object.keys(kinds).map(k => ({ kind: k, n: kinds[k] })).sort((a, b) => b.n - a.n),
    days, months: Object.keys(months).sort().map(k => ({ month: k, n: months[k] }))
  };
}
async function resetShares() {
  const months = (await fsGet(DOC.shareMonths)) || {};
  for (const m of Object.keys(months)) await fsSetList(DOC.shares(m), []);
  await fsSet(DOC.shareMonths, {});
}

/* ---------- ideas ---------- */
const ideaOut = i => ({ id: i.id, time: isoLocal(i.t), email: i.email, name: i.name, title: i.title, text: i.text, status: i.status || 'New', reply: i.reply || '', updated: isoLocal(i.upd) });

/* ---------- the calls (same names and arguments as Code.gs) ---------- */
const R = {
  async logShare([token, kind, accountKey]) {
    const a = await assertAccess(token), t = Date.now(), m = monthOf(t);
    await fsAppend(DOC.shares(m), { t, email: a.email, name: a.name || '', kind: String(kind || '').slice(0, 40), acc: String(accountKey || '').slice(0, 12) });
    await fsUpdate(DOC.shareMonths, o => { o = o || {}; o[m] = (o[m] || 0) + 1; return o; });
    return { ok: true };
  },
  async adminShareStats([token, monthKey]) { await assertAdmin(token); return shareStats(monthOk(monthKey)); },
  async adminResetShares([token]) { await assertAdmin(token); await resetShares(); return { ok: true }; },

  async logUsage([token, kind, seconds, accountKey]) {
    const a = await assertAccess(token);
    if (kind !== 'open' && kind !== 'time') return { ok: false };
    const sec = kind === 'time' ? Math.max(0, Math.min(3600, Math.round(Number(seconds) || 0))) : 0, t = Date.now(), d = dayOf(t);
    await fsAppend(DOC.usage(d), { t, email: a.email, name: a.name || '', kind, sec, acc: String(accountKey || '').slice(0, 12) });
    const days = (await fsGet(DOC.usageDays)) || {};
    if (!days[d]) await fsUpdate(DOC.usageDays, o => { o = o || {}; if (o[d]) return undefined; o[d] = 1; return o; });
    return { ok: true };
  },
  async adminActivity([token, monthKey]) {
    await assertAdmin(token);
    const month = monthOk(monthKey);
    const days = Object.keys((await fsGet(DOC.usageDays)) || {}).filter(d => d.slice(0, 7) === month);
    const lists = await Promise.all(days.map(d => fsList(DOC.usage(d))));
    const opens = {}, time = {};
    let openTotal = 0, timeTotal = 0;
    lists.forEach(list => list.forEach(r => {
      const email = r.email || '', name = r.name || nameFromEmail(email);
      if (r.kind === 'open') { (opens[email] = opens[email] || { email, name, n: 0 }).n++; openTotal++; }
      else if (r.kind === 'time') { const s = Number(r.sec) || 0; (time[email] = time[email] || { email, name, sec: 0 }).sec += s; timeTotal += s; }
    }));
    return { month, shares: await shareStats(month),
      opens: { total: openTotal, people: Object.keys(opens).map(k => opens[k]).sort((a, b) => b.n - a.n) },
      time: { total: timeTotal, people: Object.keys(time).map(k => time[k]).sort((a, b) => b.sec - a.sec) } };
  },
  async adminResetActivity([token, kind]) {
    await assertAdmin(token);
    if (kind === 'shares') { await resetShares(); return { ok: true }; }
    if (kind !== 'opens' && kind !== 'time') throw new Error('Unknown counter.');
    const drop = kind === 'opens' ? 'open' : 'time';
    for (const d of Object.keys((await fsGet(DOC.usageDays)) || {})) {
      const list = await fsList(DOC.usage(d));
      const keep = list.filter(r => r.kind !== drop);
      if (keep.length !== list.length) await fsSetList(DOC.usage(d), keep);
    }
    return { ok: true };
  },

  async submitIdea([token, title, text]) {
    const a = await assertAccess(token);
    title = String(title || '').trim().slice(0, 120);
    text = String(text || '').trim().slice(0, 3000);
    if (!text) throw new Error('Please write your idea first.');
    const t = Date.now(), p = parts(t);
    const id = 'IDEA-' + `${p.year}${p.month}${p.day}`.slice(2) + '-' + shortId();
    await fsUpdate(DOC.ideas, doc => ({ items: ((doc && doc.items) || []).concat([{ id, t, email: a.email, name: a.name || '', title, text, status: 'New', reply: '', upd: t }]) }));
    notify.send({ emails: [{ to: 'seknaapp@gmail.com', replyTo: a.email, subject: '💡 New idea from ' + (a.name || a.email), title: 'New idea from ' + esc(a.name || a.email),
      html: (title ? '<p style="margin:0 0 8px;font-size:15px;font-weight:700">' + esc(title) + '</p>' : '') +
        '<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#4c5464;white-space:pre-wrap">' + esc(text) + '</p>',
      button: { url: WEB_PAGE_URL, label: 'Open SEKNA' } }] }).catch(e => console.error('Idea email: ' + e.message));
    return { ok: true, id };
  },
  async myIdeas([token]) {
    const a = await assertAccess(token);
    return (((await fsGet(DOC.ideas)) || {}).items || []).filter(i => norm(i.email) === norm(a.email)).map(ideaOut).reverse();
  },
  async adminIdeas([token]) { await assertAdmin(token); return (((await fsGet(DOC.ideas)) || {}).items || []).map(ideaOut).reverse(); },
  async adminIdeaUpdate([token, id, status, reply]) {
    await assertAdmin(token);
    if (IDEA_STATUSES.indexOf(status) < 0) throw new Error('Unknown status.');
    reply = String(reply || '').trim().slice(0, 2000);
    let idea = null, changed = false;
    await fsUpdate(DOC.ideas, doc => {
      const list = (doc && doc.items) || [], i = list.find(x => x.id === String(id));
      if (!i) throw new Error('This idea no longer exists.');
      changed = i.status !== status || (i.reply || '') !== reply;
      i.status = status; i.reply = reply; i.upd = Date.now(); idea = i;
      return { items: list };
    });
    if (changed && idea.email) {
      const label = { New: 'received', Reviewing: 'being reviewed', Planned: 'planned', Done: 'done ✅', Declined: 'not planned for now' }[status];
      notify.send({ emails: [{ to: idea.email, replyTo: 'seknaapp@gmail.com', subject: 'Your SEKNA idea is ' + label, title: 'Hi ' + esc(idea.name || nameFromEmail(idea.email)) + ',',
        html: '<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#4c5464">Your idea' + (idea.title ? ' “' + esc(idea.title) + '”' : '') + ' is now <b>' + esc(label) + '</b>.</p>' +
          (reply ? '<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#1d2433;white-space:pre-wrap">' + esc(reply) + '</p>' : ''),
        button: { url: WEB_PAGE_URL, label: 'Open SEKNA' } }] }).catch(e => console.error('Idea reply email: ' + e.message));
    }
    return { ok: true };
  },

  /** Saves a closed month's plan and results from the sheet itself (the app's numbers are not trusted). */
  async adminSavePlanHistory([token, accountKey]) {
    const me = await assertAdmin(token);
    const { buildDashboardData, normalizeAccountKey_ } = require('./dash');
    const key = normalizeAccountKey_(accountKey);
    const data = await buildDashboardData(key);
    const days = data.dayPlan || [];
    if (!days.length) throw new Error('The media plan sheet has no days for this month.');
    const live = days.filter(d => d.actual);
    if (live.length < days.length) throw new Error('The month is not closed yet: ' + live.length + ' of ' + days.length + ' days have results.');
    const sum = (list, f) => list.reduce((a, d) => a + (Number(f(d)) || 0), 0);
    const div = (a, b) => (b ? a / b : null);
    const planFull = { spend: sum(days, d => d.plan.spend), conversions: sum(days, d => d.plan.conversions), value: sum(days, d => d.plan.value) };
    const planToDate = { spend: sum(live, d => d.plan.spend), conversions: sum(live, d => d.plan.conversions), value: sum(live, d => d.plan.value) };
    const actual = { spend: sum(live, d => d.actual.spend), conversions: sum(live, d => d.actual.conversions), value: sum(live, d => d.actual.value) };
    [planFull, planToDate, actual].forEach(o => { o.roas = div(o.value, o.spend); });
    const month = days[0].date.slice(0, 7);
    const snap = { account: key, month, hijriFrom: days[0].hijri || '', hijriTo: days[days.length - 1].hijri || '', daysTotal: days.length, daysLive: live.length,
      plan: planFull, planToDate, actual,
      channels: (data.channels || []).map(c => ({ channel: c.channel, planSpend: c.planSpend, spend: c.actualSpend, planValue: c.planValue, value: c.actualValue, conversions: c.conversions, roas: c.roas })),
      savedAt: new Date().toISOString(), savedBy: me.email };
    await fsUpdate(DOC.plans(key), doc => ({ items: ((doc && doc.items) || []).filter(x => x.month !== month).concat([snap]) }));
    return snap;
  },
  async getPlanHistory([token, accountKey]) {
    await assertAccess(token);
    const key = require('./dash').normalizeAccountKey_(accountKey);
    return (((await fsGet(DOC.plans(key))) || {}).items || []).slice().sort((a, b) => String(b.month).localeCompare(String(a.month)));
  },

  async adminReportRecipients([token]) {
    await assertAdmin(token);
    if (!notify.mailReady()) return notify.appsScript('adminReportRecipients', [token]);
    return { people: await approvedPeople(), quota: 500 };
  },
  /** The month's results PDF (built in the app) to every approved person, or only to the admin as a test. */
  async adminSendMonthlyReport([token, pdfBase64, meta]) {
    const me = await assertAdmin(token);
    if (!notify.mailReady()) return notify.appsScript('adminSendMonthlyReport', [token, pdfBase64, meta]);
    meta = meta || {};
    const bytes = Buffer.from(String(pdfBase64 || ''), 'base64');
    if (!bytes.length) throw new Error('The report is empty.');
    if (bytes.length > REPORT_MAX_BYTES) throw new Error('The report is too large to email.');
    const title = String(meta.title || 'Media Plan results').slice(0, 120);
    const fileName = (String(meta.fileName || '').replace(/[^\w.\- ]/g, '').slice(0, 80) || 'SEKNA-Report').replace(/\.pdf$/i, '') + '.pdf';
    const people = meta.testOnly ? [{ email: me.email, name: me.name || nameFromEmail(me.email) }] : await approvedPeople();
    if (!people.length) throw new Error('There is no one to send the report to yet.');
    const lines = (Array.isArray(meta.lines) ? meta.lines : []).slice(0, 4).map(l => '<li style="margin:0 0 6px">' + esc(String(l).slice(0, 220)) + '</li>').join('');
    const body = P(esc(String(meta.intro || 'The media plan results for the month are attached as a PDF.').slice(0, 300))) +
      (lines ? '<ul style="margin:0 0 16px;padding-left:18px;font-size:14px;line-height:1.5;color:#1d2433">' + lines + '</ul>' : '');
    let sent = 0;
    const failed = [];
    for (const p of people) {
      try {
        await notify.sendMail({ to: p.email, replyTo: 'seknaapp@gmail.com', subject: (meta.testOnly ? '[Test] ' : '') + title, title: 'Hi ' + esc(p.name) + ',', html: body,
          button: { url: WEB_PAGE_URL, label: 'Open SEKNA' }, attachments: [{ filename: fileName, content: bytes, contentType: 'application/pdf' }] });
        sent++;
      } catch (err) { console.error('Report to ' + p.email + ' failed: ' + err.message); failed.push(p.email); }
    }
    return { sent, failed, testOnly: !!meta.testOnly };
  },

  async webPushSubscribe([accessToken, pushToken, on]) {
    const a = await assertAccess(accessToken);
    pushToken = String(pushToken || '');
    if (pushToken.length < 20 || pushToken.length > 4096) throw new Error('Invalid notification token.');
    try { await notify.subscribeTopics(pushToken, a.email, on); }
    catch (err) {
      const st = err && err.response && err.response.status;
      if (st === 401 || st === 403) return notify.appsScript('webPushSubscribe', [accessToken, pushToken, on]);
      throw err;
    }
    return { ok: true, on: on !== false };
  }
};

/* ---------- the server switch email (at most one every 3 hours) ---------- */
async function serverSwitchEmail(who, reason) {
  let go = false;
  await fsUpdate(DOC.serverMail, o => { o = o || {}; if (Date.now() - (o.at || 0) <= 3 * 3600 * 1000) return undefined; go = true; return { at: Date.now() }; });
  if (!go) return;
  await notify.send({ emails: [{ to: 'seknaapp@gmail.com', subject: '🟠 SEKNA moved to the backup server', title: 'SEKNA is running on the backup server',
    html: P('The Firebase server did not answer, so SEKNA switched to Apps Script by itself. The team can keep working.') +
      '<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#4c5464"><b>Reason:</b> ' + esc(reason || 'Unknown') + '<br><b>Seen by:</b> ' + esc(who.name || who.email) + '</p>' +
      P('Open Admin → Server in SEKNA for details. If the monthly limit was reached, billing has to be turned back on in Google Cloud.'),
    button: { url: WEB_PAGE_URL, label: 'Open SEKNA' } }] });
}

/* ---------- new day, due team message, new app version (runs with keepWarm, every 2 minutes) ---------- */
/** The last day each account was announced for (dates only), for /diag/push. */
async function pushState() {
  const st = (await fsGet(DOC.push)) || {};
  return { days: Object.fromEntries(Object.entries(st.days || {}).map(([k, v]) => [k, v && v.date])), releaseTag: st.releaseTag || '' };
}

async function pushChecks(latestByAccount) {
  if (!(await moved())) return { skipped: true };
  const out = {};
  const app = (await fsGet('acc/app')) || {};
  const maintenance = !!(app.maintenance && app.maintenance.on);
  // A team message that was set to show from a later day.
  const a = app.announcement;
  const today = dayOf(Date.now());
  if (a && a.push && !a.pushed && a.message && (!a.showFrom || a.showFrom <= today)) {
    const body = String(a.message).replace(/\{name\}/gi, 'team');
    await notify.send({ topics: [{ title: a.title || 'SEKNA', body: body.length > 180 ? body.slice(0, 177) + '…' : body, account: 'usa', eventType: 'announcement' }] });
    await fsUpdate('acc/app', s => { if (s && s.announcement && s.announcement.id === a.id) s.announcement.pushed = true; return s || undefined; });
    out.announcement = true;
  }
  const state = (await fsGet(DOC.push)) || {};
  const save = {};
  // New version of the SEKNA app on GitHub (every 30 minutes).
  if (Date.now() - (state.releaseCheckAt || 0) > 30 * 60 * 1000) {
    save.releaseCheckAt = Date.now();
    try {
      const r = await fetch('https://api.github.com/repos/ibrahimamin6700-ui/human-appeal-media-plan/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SEKNA-server' } });
      if (r.ok) {
        const rel = await r.json(), tag = String(rel.tag_name || '');
        if (tag && !rel.draft && !rel.prerelease && tag !== state.releaseTag) {
          if (state.releaseTag && !maintenance) {
            await notify.send({ topics: [{ title: 'SEKNA ' + tag.replace(/^v/i, '') + ' is available', body: 'A new version of the SEKNA app is ready. Open SEKNA to install it.', account: 'usa', eventType: 'app_update' }] });
            out.release = tag;
          }
          save.releaseTag = tag;
        }
      }
    } catch (e) { console.warn('Release check: ' + e.message); }
  }
  // A new latest day in the media plan (date only, like Code.gs).
  for (const key of Object.keys(latestByAccount || {})) {
    const x = latestByAccount[key];
    if (!x || !x.date) continue;
    const prev = (state.days || {})[key];
    const snap = { accountKey: key, date: x.date, dayNumber: Number(x.dayNumber) || 0, monthName: x.monthName || '',
      spend: Math.round((Number(x.spend) || 0) * 100) / 100, conversions: Math.round((Number(x.conversions) || 0) * 100) / 100, value: Math.round((Number(x.value) || 0) * 100) / 100 };
    if (prev && prev.date === snap.date) continue;
    if (prev && !maintenance) {
      const label = snap.monthName && snap.dayNumber ? snap.monthName + ' ' + snap.dayNumber : snap.date;
      const sent = await notify.send({ topics: [{ title: key === 'ar' ? 'Media Plan AR' : 'Media Plan USA', body: 'New data for ' + label + ' is now available.', snapshot: snap, account: key, eventType: 'new_day' }] });
      out[key] = { date: snap.date, sent };
    }
    save.days = Object.assign({}, state.days || {}, save.days || {}, { [key]: snap });
  }
  if (Object.keys(save).length) await fsUpdate(DOC.push, s => Object.assign(s || {}, save, save.days ? { days: Object.assign({}, (s && s.days) || {}, save.days) } : {}));
  return out;
}

/* ---------- the move (admin, once) ---------- */
function serialMs(v, tz) { return require('./accounts').serialToMs(v, tz); }
async function adminRestMove([token]) {
  const me = await assertAdmin(token);
  if (await moved()) throw new Error('Already moved to the SEKNA server.');
  const props = await notify.appsScript('restExportProps', [token, false]);
  const tz = (await sheetMeta(ACCESS.SPREADSHEET_ID)).timeZone;
  const meta = await sheetMeta(ACCESS.SPREADSHEET_ID), has = n => meta.sheets.some(s => s.title === n);
  const read = async (name, range) => has(name) ? ((await batchGet(ACCESS.SPREADSHEET_ID, [a1(name, range)]))[0] || []) : [];
  const counts = { shares: 0, usage: 0, ideas: 0, plans: 0 };
  // Share counts, one list per month.
  const byMonth = {};
  (await read(SHEETS.shares, 'A2:E')).forEach(r => { const t = serialMs(r[0], tz); if (!t) return; (byMonth[monthOf(t)] = byMonth[monthOf(t)] || []).push({ t, email: norm(r[1]), name: String(r[2] || ''), kind: String(r[3] || ''), acc: String(r[4] || '') }); counts.shares++; });
  const months = {};
  for (const m of Object.keys(byMonth)) { await fsSetList(DOC.shares(m), byMonth[m]); months[m] = byMonth[m].length; }
  await fsSet(DOC.shareMonths, months);
  // Opens and time, one list per day.
  const byDay = {};
  (await read(SHEETS.usage, 'A2:F')).forEach(r => { const t = serialMs(r[0], tz); if (!t || (r[3] !== 'open' && r[3] !== 'time')) return; (byDay[dayOf(t)] = byDay[dayOf(t)] || []).push({ t, email: norm(r[1]), name: String(r[2] || ''), kind: r[3], sec: Number(r[4]) || 0, acc: String(r[5] || '') }); counts.usage++; });
  const days = {};
  for (const d of Object.keys(byDay)) { await fsSetList(DOC.usage(d), byDay[d]); days[d] = 1; }
  await fsSet(DOC.usageDays, days);
  // Ideas.
  const ideas = (await read(SHEETS.ideas, 'A2:I')).filter(r => r[0]).map(r => ({ id: String(r[0]), t: serialMs(r[1], tz), email: norm(r[2]), name: String(r[3] || ''),
    title: String(r[4] || ''), text: String(r[5] || ''), status: String(r[6] || 'New'), reply: String(r[7] || ''), upd: serialMs(r[8], tz) }));
  await fsSet(DOC.ideas, { items: ideas }); counts.ideas = ideas.length;
  // Plan history.
  const plans = {};
  (await read(SHEETS.plans, 'A2:E')).forEach(r => { try { const s = JSON.parse(String(r[4])); (plans[String(r[0])] = plans[String(r[0])] || []).push(s); counts.plans++; } catch (e) {} });
  for (const k of Object.keys(plans)) await fsSet(DOC.plans(k), { items: plans[k] });
  // Notifications carry on from where Apps Script stopped (no repeat, nothing missed).
  await fsSet(DOC.push, { days: props.pushDays || {}, releaseTag: props.releaseTag || '', releaseCheckAt: Date.now() });
  if (props.serverMailAt) await fsSet(DOC.serverMail, { at: props.serverMailAt });
  await fsSet(DOC.mode, { mode: 'firebase', at: Date.now(), by: me.email, counts });
  modeCache = { at: Date.now(), on: true };
  // From now on Apps Script stops its own notifications and these calls.
  await notify.appsScript('restExportProps', [token, true]);
  return counts;
}

async function call(fn, args) {
  if (fn === 'adminRestMove') return adminRestMove(args);
  if (fn === 'adminRestMoveStatus') {
    await assertAdmin(args[0]);
    const m = (await fsGet(DOC.mode)) || { mode: 'appsscript' };
    m.mail = notify.mailReady() ? 'Gmail' : 'Apps Script';
    try { await notify.fcm(notify.topicMessage({ title: 'check' }), true); m.push = 'Firebase'; } catch (e) { m.push = e.denied ? 'Apps Script (no permission yet)' : 'Apps Script'; }
    return m;
  }
  if (!(await moved())) return notify.appsScript(fn, args);
  return R[fn](args);
}
const FNS = Object.keys(R).concat(['adminRestMove', 'adminRestMoveStatus']);

module.exports = { call, FNS, pushChecks, pushState, serverSwitchEmail, moved };
