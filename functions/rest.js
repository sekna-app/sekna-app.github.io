// The rest of Code.gs on the HEMERA server: usage and share counts, the ideas box, plan history,
// the monthly report email, web notifications, and the "new day" phone notifications.
// Until the admin moves them (adminRestMove), every call is passed to Apps Script.
const { fsGet, fsSet, fsDelete, fsUpdate, fsAppend, fsList, fsSetList, batchGet, a1, sheetMeta } = require('./google');
const { ACCESS, assertAccess, assertAdmin, assertPerm, assertOwner, storeRows } = require('./access');
const notify = require('./notify');

const SHEETS = { shares: 'SEKNA Shares', usage: 'SEKNA Usage', ideas: 'SEKNA Ideas', plans: 'SEKNA Plan History' };
const IDEA_STATUSES = ['New', 'Reviewing', 'Planned', 'Done', 'Declined'];
const TZ = 'Asia/Muscat';
const WEB_PAGE_URL = 'https://sekna-app.web.app';
const REPORT_MAX_BYTES = 15 * 1024 * 1024;
const API_URL = 'https://europe-west2-human-appeal-media-plan.cloudfunctions.net/api';
// The emailed PDF is also kept on the server for a while, so the email's Download button can fetch it.
const REPORT_CHUNK = 600 * 1024, REPORT_KEEP = 8;
async function reportStore(bytes, fileName) {
  const id = require('crypto').randomBytes(18).toString('base64url'), n = Math.ceil(bytes.length / REPORT_CHUNK);
  for (let i = 0; i < n; i++) await fsSet('reports/' + id + '_' + i, { b: bytes.subarray(i * REPORT_CHUNK, (i + 1) * REPORT_CHUNK).toString('base64') });
  await fsSet('reports/' + id, { n, fileName, size: bytes.length, at: Date.now() });
  let old = [];
  await fsUpdate('server/report-files', o => { const ids = ((o && o.ids) || []).concat(id); old = ids.slice(0, Math.max(0, ids.length - REPORT_KEEP)); return { ids: ids.slice(-REPORT_KEEP) }; });
  for (const o of old) { const m = await fsGet('reports/' + o).catch(() => null); for (let i = 0; i < ((m && m.n) || 0); i++) await fsDelete('reports/' + o + '_' + i).catch(() => {}); await fsDelete('reports/' + o).catch(() => {}); }
  return id;
}
/** GET /report/<id> (the email's copy) or /lib/<id> (the library's): the stored PDF as a download. The id is a long random key. */
async function reportFile(id, col) {
  col = col === 'reportlib' ? 'reportlib' : 'reports';
  if (!/^[A-Za-z0-9_-]{24}$/.test(String(id || ''))) return null;
  const m = await fsGet(col + '/' + id);
  if (!m || !m.n) return null;
  const parts = [];
  for (let i = 0; i < m.n; i++) { const c = await fsGet(col + '/' + id + '_' + i); if (!c) return null; parts.push(Buffer.from(c.b, 'base64')); }
  return { bytes: Buffer.concat(parts), fileName: m.fileName || 'HEMERA-Report.pdf' };
}
// The report library: every month's PDF sent to the team, kept for good (one per account and month;
// sending a month again replaces its copy). Listed in Plan History.
const LIB_DOC = 'server/report-lib';
async function libStore(acc, month, bytes, fileName, pages) {
  const key = require('crypto').randomBytes(18).toString('base64url'), n = Math.ceil(bytes.length / REPORT_CHUNK);
  for (let i = 0; i < n; i++) await fsSet('reportlib/' + key + '_' + i, { b: bytes.subarray(i * REPORT_CHUNK, (i + 1) * REPORT_CHUNK).toString('base64') });
  await fsSet('reportlib/' + key, { n, fileName, size: bytes.length, at: Date.now() });
  let old = null;
  await fsUpdate(LIB_DOC, o => {
    const items = ((o && o.items) || []).filter(x => { if (x.acc === acc && x.month === month) { old = x; return false; } return true; });
    items.push({ acc, month, key, fileName, size: bytes.length, pages, sentAt: Date.now() });
    return { items };
  });
  if (old) { const m = await fsGet('reportlib/' + old.key).catch(() => null); for (let i = 0; i < ((m && m.n) || 0); i++) await fsDelete('reportlib/' + old.key + '_' + i).catch(() => {}); await fsDelete('reportlib/' + old.key).catch(() => {}); }
}
const DOC = {
  mode: 'rest/mode', shareMonths: 'rest/share-months', usageDays: 'rest/usage-days', ideas: 'rest/ideas',
  shares: m => 'rest/shares-' + m, usage: d => 'rest/usage-' + d, plans: k => 'rest/plan-' + k,
  push: 'rest/push', serverMail: 'rest/server-mail', fx: 'rest/fx', fxTime: 'rest/fx-time', reacts: (acc, m) => 'rest/reacts-' + acc + '-' + m, celebrate: 'rest/celebrations'
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
  // Each person's pages, accounts, days and last share, for the details under their card.
  const mem = await require('./tasks').members().catch(() => ({}));
  rows.forEach(r => {
    const email = r.email || '';
    const p = people[email] = people[email] || { email, name: r.name || nameFromEmail(email), n: 0, kinds: {}, accs: {}, days: {}, last: 0,
      role: (mem[email] || {}).role === 'Head of Media' ? 'CEO' : ((mem[email] || {}).role || ''), avatar: (mem[email] || {}).avatar || 0 };
    p.n++;
    const pk = r.kind || 'other'; p.kinds[pk] = (p.kinds[pk] || 0) + 1;
    if (r.acc) p.accs[r.acc] = (p.accs[r.acc] || 0) + 1;
    const pd = dayOf(r.t); p.days[pd] = (p.days[pd] || 0) + 1;
    if (r.t > p.last) p.last = r.t;
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
/* ---------- celebrations (Plan History → Celebrate this month) ---------- */
// The team gets a notification; the full-screen card shows once to each person (then it stays in Notifications).
const CELEBRATE_REACTS = ['❤️', '🤲', '🔥'];
const CELEBRATE_DAYS = 7;
function celebrationOut(c, email) {
  const counts = {}, mine = [];
  CELEBRATE_REACTS.forEach(r => { const who = (c.react || {})[r] || []; counts[r] = who.length; if (who.indexOf(email) >= 0) mine.push(r); });
  return { id: c.id, at: c.at, account: c.account, month: c.month, msg: c.msg, stats: c.stats || {}, counts, mine };
}
async function celebrationEdit(id, change) {
  let found = null;
  await fsUpdate(DOC.celebrate, doc => {
    const list = (doc && doc.items) || [], c = list.find(x => x.id === String(id));
    if (!c) throw new Error('This message no longer exists.');
    change(c); found = c;
    return { items: list };
  });
  return found;
}

/* ---------- exchange rates (currency switch) ---------- */
// Free, no key. One fetch a day, after the time the admin picked (12:00 PM Muscat by default), kept in Firestore for the whole team.
let fxMemo = 0, fxTry = 0, fxTimeMemo = null, fxTimeAt = 0;
const FX_TIME_DEFAULT = { time: '12:00', tz: 'Asia/Muscat' };
const FX_ZONES = ['Asia/Muscat', 'Africa/Cairo', 'Europe/London', 'Asia/Dubai', 'Asia/Riyadh'];
async function fxTime() {
  if (fxTimeMemo && Date.now() - fxTimeAt < 6e4) return fxTimeMemo;
  const d = (await fsGet(DOC.fxTime).catch(() => null)) || {};
  fxTimeMemo = { time: /^\d{2}:\d{2}$/.test(d.time) ? d.time : FX_TIME_DEFAULT.time, tz: FX_ZONES.includes(d.tz) ? d.tz : FX_TIME_DEFAULT.tz };
  fxTimeAt = Date.now();
  return fxTimeMemo;
}
/** The last moment the day's refresh time passed, in the chosen time zone. */
function fxLastNoon(now, ft) {
  ft = ft || FX_TIME_DEFAULT;
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: ft.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).forEach(x => { p[x.type] = x.value; });
  const off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(now / 1000) * 1000;
  const [h, m] = ft.time.split(':').map(Number);
  const at = Date.UTC(+p.year, +p.month - 1, +p.day, h, m, 0) - off;
  return now >= at ? at : at - 864e5;
}
async function fxFresh() {
  const have = await fsGet(DOC.fx);
  if (have && have.rates && have.at >= fxLastNoon(Date.now(), await fxTime())) return have;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/GBP', { signal: AbortSignal.timeout(8000) });
    const j = await r.json(), pick = {};
    ['USD', 'EUR', 'AED', 'SAR', 'OMR', 'QAR', 'KWD', 'BHD'].forEach(c => { const v = Number(j && j.rates && j.rates[c]); if (v > 0) pick[c] = v; });
    if (!pick.USD) throw new Error('No rates');
    const out = { base: 'GBP', rates: pick, at: Date.now() };
    await fsSet(DOC.fx, out);
    return out;
  } catch (e) {
    console.error('Rates: ' + e.message);
    if (have && have.rates) return have;
    throw new Error('Exchange rates are not available right now.');
  }
}
/** From the 2-minute warm-up: the day's rates right after 12:00 PM, so nobody waits for them. */
async function fxRefreshIfDue() {
  const noon = fxLastNoon(Date.now(), await fxTime());
  if (fxMemo === noon || Date.now() - fxTry < 30 * 6e4) return null; // a failed try waits 30 minutes
  fxTry = Date.now();
  const r = await fxFresh();
  if (r && r.at >= noon) fxMemo = noon;
  return r;
}

const DAY_FACES = ['🔥', '💪', '😐', '😓'];
// Each day keeps { email: { f: face, n: name } } (an older entry is just the face).
function dayReactOut(doc, me) {
  const days = {};
  Object.keys(doc).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).forEach(k => {
    const counts = {}, who = {}; let n = 0, mine = null;
    Object.keys(doc[k] || {}).forEach(e => {
      const v = doc[k][e], f = typeof v === 'string' ? v : v && v.f;
      if (DAY_FACES.indexOf(f) < 0) return;
      counts[f] = (counts[f] || 0) + 1; n++;
      (who[f] = who[f] || []).push((v && v.n) || nameFromEmail(e));
      if (e === me) mine = f;
    });
    if (n) days[k] = { counts, n, mine, who };
  });
  return { faces: DAY_FACES, days };
}

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
      button: { url: WEB_PAGE_URL, label: 'Open HEMERA' } }] }).catch(e => console.error('Idea email: ' + e.message));
    return { ok: true, id };
  },
  /** Exchange rates for the currency switch, from 1 pound (refreshed once a day at the time the admin picked). */
  async fxRates([token]) {
    await assertAccess(token);
    return Object.assign({}, await fxFresh(), { refresh: await fxTime() });
  },
  async adminFxTime([token]) {
    await assertAdmin(token);
    const ft = await fxTime(), have = (await fsGet(DOC.fx)) || {};
    return { refresh: ft, at: have.at || 0, rates: have.rates || null, next: fxLastNoon(Date.now(), ft) + 864e5 };
  },
  async adminFxTimeSet([token, c]) {
    await assertAdmin(token);
    c = c || {};
    const time = String(c.time || ''), tz = String(c.tz || '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Pick a time.');
    if (!FX_ZONES.includes(tz)) throw new Error('Pick a time zone.');
    await fsSet(DOC.fxTime, { time, tz, at: Date.now() });
    fxTimeMemo = { time, tz }; fxTimeAt = Date.now(); fxMemo = 0; fxTry = 0;
    return R.adminFxTime([token]);
  },
  async adminCelebrate([token, c]) {
    const me = await assertPerm(token, 'lab');
    c = c || {};
    const msg = String(c.msg || '').trim().slice(0, 400);
    if (!msg) throw new Error('Write a message first.');
    const account = c.account === 'ar' ? 'ar' : 'usa';
    const month = /^\d{4}-\d{2}$/.test(String(c.month || '')) ? String(c.month) : monthOf(Date.now());
    const num = v => (isFinite(Number(v)) ? Number(v) : null);
    const st = c.stats || {};
    const item = { id: 'C-' + shortId() + shortId(), at: Date.now(), by: me.email, account, month, msg,
      stats: { ach: num(st.ach), value: num(st.value), roas: num(st.roas) }, react: {}, seen: {} };
    await fsUpdate(DOC.celebrate, doc => ({ items: ((doc && doc.items) || []).concat([item]).slice(-10) }));
    await notify.send({ topics: [{ title: '🏆 Thank you, team!', body: msg, account, eventType: 'celebrate' }] });
    return celebrationOut(item, me.email);
  },
  /** The newest celebration this person hasn't seen yet (from the last 7 days), or null. */
  async myCelebration([token]) {
    const a = await assertAccess(token), e = norm(a.email), cut = Date.now() - CELEBRATE_DAYS * 864e5;
    const list = (((await fsGet(DOC.celebrate)) || {}).items || []).filter(c => c.at > cut && !(c.seen || {})[e]);
    return list.length ? celebrationOut(list[list.length - 1], e) : null;
  },
  /** Opened again from Notifications: the newest one, seen or not. */
  async celebrationLatest([token]) {
    const a = await assertAccess(token), list = ((await fsGet(DOC.celebrate)) || {}).items || [];
    return list.length ? celebrationOut(list[list.length - 1], norm(a.email)) : null;
  },
  async celebrationSeen([token, id]) {
    const a = await assertAccess(token), e = norm(a.email);
    await celebrationEdit(id, c => { c.seen = c.seen || {}; c.seen[e] = Date.now(); });
    return { ok: true };
  },
  async celebrationReact([token, id, r]) {
    const a = await assertAccess(token), e = norm(a.email);
    if (CELEBRATE_REACTS.indexOf(r) < 0) throw new Error('Unknown reaction.');
    const c = await celebrationEdit(id, x => {
      x.react = x.react || {};
      const had = (x.react[r] || []).indexOf(e) >= 0; // a second tap takes it back
      x.react[r] = (x.react[r] || []).filter(v => v !== e).concat(had ? [] : [e]);
    });
    return celebrationOut(c, e);
  },
  /** Day by Day → Results: how the team felt about each day (one face per person per day; tap the badge to see who). */
  async dayReactions([token, account, month]) {
    const a = await assertAccess(token), e = norm(a.email);
    const acc = account === 'ar' ? 'ar' : 'usa', m = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : monthOf(Date.now());
    return dayReactOut((await fsGet(DOC.reacts(acc, m))) || {}, e);
  },
  async dayReact([token, account, day, face]) {
    const a = await assertAccess(token), e = norm(a.email);
    const acc = account === 'ar' ? 'ar' : 'usa', d = String(day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Pick a day.');
    if (face != null && DAY_FACES.indexOf(face) < 0) throw new Error('Unknown reaction.');
    const out = await fsUpdate(DOC.reacts(acc, d.slice(0, 7)), doc => {
      doc = doc || {}; const day0 = Object.assign({}, doc[d] || {});
      const had = day0[e] && (typeof day0[e] === 'string' ? day0[e] : day0[e].f);
      if (!face || had === face) delete day0[e]; else day0[e] = { f: face, n: a.name || nameFromEmail(e) }; // the same face again takes it back
      if (Object.keys(day0).length) doc[d] = day0; else delete doc[d];
      return doc;
    });
    return dayReactOut(out || {}, e);
  },
  /** The notifications list (menu → Notifications). */
  async myNotifications([token]) {
    const a = await assertPerm(token, 'notifs');
    return notify.inboxFor(a.email);
  },
  async myIdeas([token]) {
    const a = await assertAccess(token);
    return (((await fsGet(DOC.ideas)) || {}).items || []).filter(i => norm(i.email) === norm(a.email)).map(ideaOut).reverse();
  },
  async adminIdeas([token]) { await assertAdmin(token); return (((await fsGet(DOC.ideas)) || {}).items || []).map(ideaOut).reverse(); },
  async adminIdeaDelete([token, id]) {
    await assertAdmin(token);
    let found = false;
    await fsUpdate(DOC.ideas, doc => {
      const list = (doc && doc.items) || [];
      const keep = list.filter(x => x.id !== String(id));
      found = keep.length !== list.length;
      return { items: keep };
    });
    if (!found) throw new Error('This idea no longer exists.');
    return { ok: true };
  },
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
      notify.send({ emails: [{ to: idea.email, replyTo: 'seknaapp@gmail.com', subject: 'Your HEMERA idea is ' + label, title: 'Hi ' + esc(idea.name || nameFromEmail(idea.email)) + ',',
        html: '<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#4c5464">Your idea' + (idea.title ? ' “' + esc(idea.title) + '”' : '') + ' is now <b>' + esc(label) + '</b>.</p>' +
          (reply ? '<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#1d2433;white-space:pre-wrap">' + esc(reply) + '</p>' : ''),
        button: { url: WEB_PAGE_URL, label: 'Open HEMERA' } }] }).catch(e => console.error('Idea reply email: ' + e.message));
    }
    return { ok: true };
  },

  /** Saves a closed month's plan and results from the sheet itself (the app's numbers are not trusted). */
  async adminSavePlanHistory([token, accountKey]) {
    const me = await assertPerm(token, 'lab');
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
    await assertPerm(token, 'plans');
    const key = require('./dash').normalizeAccountKey_(accountKey);
    return (((await fsGet(DOC.plans(key))) || {}).items || []).slice().sort((a, b) => String(b.month).localeCompare(String(a.month)));
  },

  async adminReportRecipients([token]) {
    await assertOwner(token); // only the HEMERA owner sends the report
    if (!notify.mailReady()) return notify.appsScript('adminReportRecipients', [token]);
    // Each person's position and emblem too, for the thank-you page of the report.
    const mem = await require('./tasks').members().catch(() => ({}));
    const people = (await approvedPeople()).map(p => { const m = mem[p.email] || {}; return Object.assign(p, { role: m.role === 'Head of Media' ? 'CEO' : (m.role || ''), avatar: m.avatar || 0 }); });
    return { people, quota: 500 };
  },
  /** The report library of one account: every month's PDF sent to the team, newest first, with its download link. */
  async reportLib([token, account]) {
    await assertAccess(token);
    const acc = account === 'ar' ? 'ar' : 'usa';
    return (((await fsGet(LIB_DOC)) || {}).items || []).filter(x => x.acc === acc).sort((a, b) => String(b.month).localeCompare(String(a.month)))
      .map(x => ({ month: x.month, fileName: x.fileName, size: x.size, pages: x.pages, sentAt: x.sentAt, url: API_URL + '/lib/' + x.key }));
  },
  /** The month's results PDF (built in the app) to every approved person, or only to the admin as a test. */
  async adminSendMonthlyReport([token, pdfBase64, meta]) {
    const me = await assertOwner(token);
    if (!notify.mailReady()) return notify.appsScript('adminSendMonthlyReport', [token, pdfBase64, meta]);
    meta = meta || {};
    const bytes = Buffer.from(String(pdfBase64 || ''), 'base64');
    if (!bytes.length) throw new Error('The report is empty.');
    if (bytes.length > REPORT_MAX_BYTES) throw new Error('The report is too large to email.');
    const title = String(meta.title || 'Media Plan results').slice(0, 120);
    const fileName = (String(meta.fileName || '').replace(/[^\w.\- ]/g, '').slice(0, 80) || 'HEMERA-Report').replace(/\.pdf$/i, '') + '.pdf';
    const people = meta.testOnly ? [{ email: me.email, name: me.name || nameFromEmail(me.email) }] : await approvedPeople();
    if (!people.length) throw new Error('There is no one to send the report to yet.');
    let link = WEB_PAGE_URL;
    try { link = API_URL + '/report/' + (await reportStore(bytes, fileName)); } catch (e) { console.error('Report store: ' + e.message); }
    const pages = Math.max(1, Math.min(30, Number(meta.pages) || 1)), mb = (bytes.length / 1048576).toFixed(1);
    // The file itself as a card (name, pages, size) that opens the PDF, like an attachment in a chat.
    const pdfCard = '<a href="' + esc(link) + '" style="display:block;text-decoration:none;margin:0 0 18px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d5dbe6;border-radius:14px"><tr>' +
      '<td width="44" style="padding:12px 0 12px 14px"><div style="width:32px;height:32px;border-radius:7px;background:#e5322d;color:#ffffff;font:800 10px Arial,sans-serif;line-height:32px;text-align:center">PDF</div></td>' +
      '<td style="padding:12px 8px;font-family:Arial,sans-serif"><div style="font-size:13px;font-weight:700;color:#1d2433;word-break:break-word">' + esc(fileName) + '</div>' +
      '<div style="font-size:11.5px;color:#8a92a0;margin-top:2px">' + pages + (pages === 1 ? ' page' : ' pages') + ' · ' + mb + ' MB</div></td>' +
      '<td width="40" style="padding:12px 14px 12px 0;text-align:right;font:700 20px Arial,sans-serif;color:#203C8E">&#8681;</td></tr></table></a>';
    const body = P(esc(String(meta.intro || 'The media plan results for the month are attached as a PDF.').slice(0, 300))) + pdfCard;
    const files = [{ filename: fileName, content: bytes, contentType: 'application/pdf' }];
    // A send to the team goes into the report library too (tests do not).
    if (!meta.testOnly && /^\d{4}-\d{2}$/.test(String(meta.month || '')) && (meta.account === 'usa' || meta.account === 'ar')) {
      try { await libStore(meta.account, meta.month, bytes, fileName, pages); } catch (e) { console.error('Report library: ' + e.message); }
    }
    // Each test carries its time, so Gmail shows it as a new email instead of hiding it in the last test's thread.
    const tp = parts(Date.now()), testTag = '[Test ' + tp.hour + ':' + tp.minute + '] ';
    let sent = 0;
    const failed = [];
    for (const p of people) {
      try {
        await notify.sendMail({ to: p.email, replyTo: 'seknaapp@gmail.com', subject: (meta.testOnly ? testTag : '') + title, title: 'Hi ' + esc(p.name) + ',', html: body,
          button: { url: link, label: link === WEB_PAGE_URL ? 'Open HEMERA' : 'Download PDF' }, attachments: files });
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
  await notify.send({ emails: [{ to: 'seknaapp@gmail.com', subject: '🟠 HEMERA moved to the backup server', title: 'HEMERA is running on the backup server',
    html: P('The Firebase server did not answer, so HEMERA switched to Apps Script by itself. The team can keep working.') +
      '<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#4c5464"><b>Reason:</b> ' + esc(reason || 'Unknown') + '<br><b>Seen by:</b> ' + esc(who.name || who.email) + '</p>' +
      P('Open Admin → Server in HEMERA for details. If the monthly limit was reached, billing has to be turned back on in Google Cloud.'),
    button: { url: WEB_PAGE_URL, label: 'Open HEMERA' } }] });
}

/* ---------- new day, due team message, new app version (runs with keepWarm, every 2 minutes) ---------- */
/** The last day each account was announced for (dates only), for /diag/push. */
async function pushState() {
  const st = (await fsGet(DOC.push)) || {};
  // When each account's latest day was first seen, and whether its notification went out (for /diag/push).
  return { days: Object.fromEntries(Object.entries(st.days || {}).map(([k, v]) => [k, v && v.date])),
    seen: Object.fromEntries(Object.entries(st.days || {}).map(([k, v]) => [k, { date: v && v.date, at: v && v.at ? new Date(v.at).toISOString() : '', sent: (v && v.sent) || null }])),
    releaseTag: st.releaseTag || '' };
}

/* ---------- season reminders (the Seasons Calendar's seasons, 14 and 3 days ahead) ---------- */
const SEASONS_H = [
  { k: 'ramadan', m: 9, d: 1, name: 'Ramadan', e: '🌙' }, { k: 'last10', m: 9, d: 21, name: 'The last 10 nights', e: '🌙' },
  { k: 'eidfitr', m: 10, d: 1, name: 'Eid al-Fitr', e: '🎉' }, { k: 'dhulhijjah', m: 12, d: 1, name: 'Dhul Hijjah', e: '🕋' },
  { k: 'arafah', m: 12, d: 9, name: 'The Day of Arafah', e: '🕋' }, { k: 'eidadha', m: 12, d: 10, name: 'Eid al-Adha', e: '🐑' },
  { k: 'ashura', m: 1, d: 10, name: 'Ashura', e: '🤲' }];
const isoPlus = (dk, n) => new Date(Date.parse(dk + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function nthDay(y, mo, wd, n) { const f = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(); return new Date(Date.UTC(y, mo - 1, 1 + (wd - f + 7) % 7 + (n - 1) * 7)).toISOString().slice(0, 10); }
/** The seasons that start exactly 14 or 3 days after `today` (yyyy-mm-dd). */
function seasonsDue(today) {
  const out = [], fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  for (const left of [14, 3]) {
    const dk = isoPlus(today, left), before = isoPlus(dk, -1);
    const h = dk => { const p = {}; fmt.formatToParts(new Date(dk + 'T00:00:00Z')).forEach(x => { p[x.type] = parseInt(x.value, 10); }); return p; };
    const a = h(dk), b = h(before);
    // A Hijri season starts on the first day that reaches its Hijri date.
    SEASONS_H.forEach(s => { if (a.month === s.m && a.day >= s.d && !(b.month === s.m && b.day >= s.d)) out.push({ id: s.k + '-' + a.year, name: s.name, e: s.e, left, acc: '' }); });
    const y = +dk.slice(0, 4), tg = nthDay(y, 11, 4, 4);
    [['thanksgiving', 'Thanksgiving', '🦃', tg], ['givingtuesday', 'Giving Tuesday', '💛', isoPlus(tg, 5)], ['yearend', 'Year-end giving', '🎁', y + '-12-26']]
      .forEach(([k, name, e, at]) => { if (at === dk) out.push({ id: k + '-' + y, name, e, left, acc: 'usa' }); });
  }
  return out;
}

async function pushChecks(latestByAccount, daysByAccount) {
  if (!(await moved())) return { skipped: true };
  const out = {};
  const app = (await fsGet('acc/app')) || {};
  const maintenance = !!(app.maintenance && app.maintenance.on);
  // A team message that was set to show from a later day.
  const a = app.announcement;
  const today = dayOf(Date.now());
  if (a && a.push && !a.pushed && a.message && (!a.showFrom || a.showFrom <= today)) {
    const body = String(a.message).replace(/\{name\}/gi, 'team');
    await notify.send({ topics: [{ title: a.title || 'HEMERA', body: body.length > 180 ? body.slice(0, 177) + '…' : body, account: 'usa', eventType: 'announcement' }] });
    await fsUpdate('acc/app', s => { if (s && s.announcement && s.announcement.id === a.id) s.announcement.pushed = true; return s || undefined; });
    out.announcement = true;
  }
  const state = (await fsGet(DOC.push)) || {};
  const save = {};
  // New version of the HEMERA app on GitHub (every 30 minutes).
  if (Date.now() - (state.releaseCheckAt || 0) > 30 * 60 * 1000) {
    save.releaseCheckAt = Date.now();
    try {
      const r = await fetch('https://api.github.com/repos/ibrahimamin6700-ui/human-appeal-media-plan/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'HEMERA-server' } });
      if (r.ok) {
        const rel = await r.json(), tag = String(rel.tag_name || '');
        if (tag && !rel.draft && !rel.prerelease && tag !== state.releaseTag) {
          if (state.releaseTag && !maintenance) {
            await notify.send({ topics: [{ title: 'HEMERA ' + tag.replace(/^v/i, '') + ' is available', body: 'A new version of the HEMERA app is ready. Open HEMERA to install it.', account: 'usa', eventType: 'app_update' }] });
            out.release = tag;
          }
          save.releaseTag = tag;
        }
      }
    } catch (e) { console.warn('Release check: ' + e.message); }
  }
  // Season reminders: from 9:00 (Muscat), once per season and step (14 and 3 days ahead), to the whole team.
  const nowP = parts(Date.now());
  if (!maintenance && +nowP.hour >= 9 && state.seasonDay !== today) {
    save.seasonDay = today;
    const prefs = (await fsGet('server/app-prefs').catch(() => null)) || {};
    const sent = Object.assign({}, state.seasonSent || {});
    if (prefs.season !== false) {
      for (const s of seasonsDue(today)) {
        const key = s.id + '-' + s.left;
        if (sent[key]) continue;
        await notify.send({ topics: [{ title: s.e + ' ' + s.name + ' in ' + s.left + ' days' + (s.acc ? ' · USA' : ''), body: 'Last year\'s numbers and your prep list are ready. Open HEMERA.',
          account: s.acc || 'usa', eventType: 'season' }] }).catch(e => console.error('Season reminder: ' + e.message));
        sent[key] = Date.now(); out.season = (out.season || []).concat(key);
      }
    }
    // Keep a year of sent reminders.
    Object.keys(sent).forEach(k => { if (Date.now() - sent[k] > 400 * 864e5) delete sent[k]; });
    save.seasonSent = sent;
  }
  // A new latest day in the media plan (date only, like Code.gs).
  for (const key of Object.keys(latestByAccount || {})) {
    const x = latestByAccount[key];
    if (!x || !x.date) continue;
    const prev = (state.days || {})[key];
    const snap = { accountKey: key, date: x.date, dayNumber: Number(x.dayNumber) || 0, monthName: x.monthName || '',
      spend: Math.round((Number(x.spend) || 0) * 100) / 100, conversions: Math.round((Number(x.conversions) || 0) * 100) / 100, value: Math.round((Number(x.value) || 0) * 100) / 100 };
    if (prev && prev.date === snap.date) continue;
    snap.at = Date.now();
    if (prev && !maintenance) {
      const label = snap.monthName && snap.dayNumber ? snap.monthName + ' ' + snap.dayNumber : snap.date;
      const sent = await notify.send({ topics: [{ title: key === 'ar' ? 'Media Plan AR' : 'Media Plan USA', body: 'New data for ' + label + ' is now available.', snapshot: snap, account: key, eventType: 'new_day' }] });
      out[key] = { date: snap.date, sent };
      snap.sent = sent;
    } else snap.sent = maintenance ? 'maintenance' : 'first-run';
    save.days = Object.assign({}, state.days || {}, save.days || {}, { [key]: snap });
    // With the new day: the spend alert (day's spend past its plan by the owner's level) and the day streak
    // (3+ days in a row of value at or above the day's plan) go to the team's phones.
    if (prev && !maintenance) {
      const prefs = Object.assign({ alert: 120, roas: 40 }, (await fsGet('server/app-prefs').catch(() => null)) || {});
      const acc = key === 'ar' ? 'AR' : 'USA', sym = key === 'ar' ? '£' : '$';
      const ach = Number(x.spendAchievement), lvl = Number(prefs.alert) || 0;
      if (lvl && isFinite(ach) && ach * 100 >= lvl && Number(x.targetSpend) > 0) {
        await notify.send({ topics: [{ title: '⚠️ Spend is ' + Math.round(ach * 100) + '% of the day\'s plan · ' + acc,
          body: (x.monthName ? x.monthName + ' ' + x.dayNumber + ': ' : '') + 'spent ' + Math.round(Number(x.spend) || 0).toLocaleString('en-GB') + ' against a plan of ' + Math.round(Number(x.targetSpend)).toLocaleString('en-GB') + ' (sheet currency).',
          account: key, eventType: 'spend_alert' }] }).catch(e => console.error('Spend alert: ' + e.message));
        out[key + 'SpendAlert'] = Math.round(ach * 100);
      }
      const rows = ((daysByAccount || {})[key] || []).filter(r => r && r.actual && r.plan && Number(r.plan.value) > 0).sort((p, q) => (p.date < q.date ? -1 : 1));
      let n = 0; for (let i = rows.length - 1; i >= 0; i--) { if (Number(rows[i].actual.value) >= Number(rows[i].plan.value)) n++; else break; }
      if (n >= 3) {
        await notify.send({ topics: [{ title: '🔥 ' + n + ' days in a row above plan · ' + acc,
          body: 'Conversion value met the day\'s plan ' + n + ' days running. Keep it going!', account: key, eventType: 'streak' }] }).catch(e => console.error('Streak: ' + e.message));
        out[key + 'Streak'] = n;
      }
      // ROAS drop: the new day's return fell by the owner's level (40% by default) against the average of the
      // 7 days before it. The push has no numbers; the app shows them when it opens.
      const rl = prefs.roas == null ? 40 : Number(prefs.roas) || 0, sp = Number(x.spend) || 0;
      const before = ((daysByAccount || {})[key] || []).filter(r => r && r.actual && Number(r.actual.spend) > 0 && r.date < x.date).sort((p, q) => (p.date < q.date ? -1 : 1)).slice(-7);
      if (rl && sp > 0 && before.length >= 5 && !(Number(x.targetSpend) > 0 && sp < 0.3 * Number(x.targetSpend))) {
        const avg = before.reduce((t, r) => t + Number(r.actual.value) / Number(r.actual.spend), 0) / before.length;
        const drop = avg > 0 ? 1 - (Number(x.value) || 0) / sp / avg : 0;
        if (drop * 100 >= rl) {
          await notify.send({ topics: [{ title: '📉 ROAS dropped sharply · ' + acc,
            body: 'The latest day\'s return was much lower than usual. Open HEMERA to see why.', account: key, eventType: 'roas_drop' }] }).catch(e => console.error('ROAS drop: ' + e.message));
          out[key + 'RoasDrop'] = Math.round(drop * 100);
        }
      }
      void sym;
    }
    // The last day of the month is in: the month is complete (once per month and account).
    const dim = snap.date ? new Date(Date.UTC(+snap.date.slice(0, 4), +snap.date.slice(5, 7), 0)).getUTCDate() : 0;
    const mk = snap.date.slice(0, 7), closed = Object.assign({}, state.closed || {}, save.closed || {});
    if (prev && !maintenance && dim && snap.dayNumber === dim && closed[key] !== mk) {
      const name = new Date(Date.UTC(+mk.slice(0, 4), +mk.slice(5, 7) - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      await notify.send({ topics: [{ title: name + ' is complete · ' + (key === 'ar' ? 'AR' : 'USA'),
        body: 'All ' + dim + ' days are in. Plan History and Close the month are ready in Media Plan Lab.', account: key, eventType: 'month_closed' }] });
      closed[key] = mk; save.closed = closed; out[key + 'Closed'] = mk;
    }
  }
  if (Object.keys(save).length) await fsUpdate(DOC.push, s => Object.assign(s || {}, save, save.days ? { days: Object.assign({}, (s && s.days) || {}, save.days) } : {}));
  return out;
}

/* ---------- the move (admin, once) ---------- */
function serialMs(v, tz) { return require('./accounts').serialToMs(v, tz); }
async function adminRestMove([token]) {
  const me = await assertAdmin(token);
  if (await moved()) throw new Error('Already moved to the HEMERA server.');
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

module.exports = { reportFile, call, FNS, pushChecks, pushState, serverSwitchEmail, moved, fxRefreshIfDue };
