// Team Tasks, days off and team members on the SEKNA server (Firestore), ported from Code.gs.
// Until the admin moves the data over (adminTasksMove), every call is passed to Apps Script,
// so nothing changes for anyone before the move. Emails and pushes still go out through
// Apps Script (relaySend), called with this server's own Google identity, not a stored key.
const crypto = require('crypto');
const { fsGet, fsSet, fsUpdate, batchGet, a1 } = require('./google');
const { assertAccess, accessRows, isAdminEmail } = require('./access');

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzjgZ1nXxLTcFdeFCIEznOj2H0XCo9YGUeu1YF2pJdsQiOo_aM-Mn6HxKKNk8peEuM1Ig/exec';
const TASKS_SHEET = { ID: '1PWV9exRy9dwW3H66bt7W4E1SQb63EJbgVz96yS6fQkI', NAME: 'SEKNA Tasks' };
const MANAGER_ROLES = ['Team Leader', 'Media Manager', 'Head of Media'];
const ROLES = ['Media Buyer', 'Senior Media Buyer', 'Team Leader', 'Media Manager', 'Head of Media'];
const LEAVE_TYPES = ['Weekly', 'Sick', 'Other', 'Vacation'];
const WEB_PAGE_URL = 'https://sekna-app.web.app';
const DOC = {
  mode: 'team/mode', members: 'team/members', index: 'team/index', quick: 'team/quick',
  leave: 'team/leave', meta: 'team/meta', notices: 'team/notices', month: m => 'team/m-' + m
};

/* ---------- small helpers ---------- */

const norm = e => String(e || '').trim().toLowerCase();
const uid = p => p + crypto.randomBytes(4).toString('hex').toUpperCase();
function monthOk(m) { if (!/^\d{4}-\d{2}$/.test(String(m || ''))) throw new Error('Bad month'); return String(m); }
function weekOf(d) { return d <= 7 ? 1 : d <= 14 ? 2 : d <= 21 ? 3 : 4; }
function prevMonth(m) { const y = +m.slice(0, 4), mo = +m.slice(5, 7); const d = new Date(Date.UTC(y, mo - 2, 1)); return d.toISOString().slice(0, 7); }
/** Today in Muscat: { iso, month, day, wd } with wd 0 = Saturday … 6 = Friday, like Code.gs. */
function muscatToday(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(new Date(ms || Date.now())).forEach(x => { p[x.type] = x.value; });
  const wd = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].indexOf(p.weekday);
  return { iso: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`, day: Number(p.day), wd };
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
const items = doc => (doc && Array.isArray(doc.items) ? doc.items : []);
function pub(t) { return { id: t.id, kind: t.kind, month: t.month, weeks: t.weeks, email: t.email, title: t.title, data: t.data, done: t.done, by: t.by, at: t.at, deadline: t.deadline }; }

/* ---------- Apps Script bridge ---------- */

async function appsScript(fn, args) {
  const res = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'call', fn, args }), redirect: 'follow' });
  const j = await res.json();
  if (!j || !j.ok) throw new Error((j && j.error) || 'Apps Script did not answer.');
  return j.result;
}
/** This server's Google identity token; Apps Script checks it with Google before sending anything. */
async function identityToken() {
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=sekna-relay&format=full',
    { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error('No server identity (' + r.status + ')');
  return r.text();
}
/** Emails (wrapped in the SEKNA email design by Apps Script) and pushes to one person each. */
async function relay(payload) {
  if (!(payload.emails || []).length && !(payload.pushes || []).length && !(payload.topics || []).length && !payload.appState) return { emails: 0, pushes: 0 };
  return appsScript('relaySend', [await identityToken(), payload]);
}

/* ---------- moved yet? ---------- */

let modeCache = null;
async function moved() {
  if (modeCache && Date.now() - modeCache.at < 30000) return modeCache.on;
  const m = await fsGet(DOC.mode);
  const on = !!(m && m.mode === 'firebase');
  modeCache = { at: Date.now(), on };
  return on;
}

/* ---------- people ---------- */

async function members() { return (await fsGet(DOC.members)) || {}; }
function canManage(email, mem) { email = norm(email); return isAdminEmail(email) || MANAGER_ROLES.indexOf((mem[email] || {}).role) >= 0; }
async function assertManager(token) {
  const a = await assertAccess(token), mem = await members();
  if (!canManage(a.email, mem)) throw new Error('Only the Head of Media, Media Managers, Team Leaders and Ibrahim Amin can build tasks.');
  return { a, mem };
}
async function teamPeople(mem, me) {
  const seen = {}, out = [], status = {};
  const add = (email, name) => {
    if (!email || seen[email]) return;
    seen[email] = 1;
    const m = mem[email] || {};
    out.push({ email, name: name || m.name || email.split('@')[0], role: m.role || '', avatar: m.avatar || 0 });
  };
  const rows = await accessRows();
  rows.forEach(r => { if (r.email) status[r.email] = status[r.email] === 'Approved' ? 'Approved' : r.status; });
  rows.forEach(r => { if (r.status === 'Approved') add(r.email, r.name); });
  Object.keys(mem).forEach(e => { if (mem[e] && mem[e].role && (!status[e] || status[e] === 'Approved')) add(e, ''); });
  if (me && me.email) add(norm(me.email), me.name);
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

/* ---------- leave ---------- */

function frozenOn(meta, iso) {
  const f = (meta && meta.freeze) || {};
  return !!f.on || (f.seasons || []).some(s => s.from && s.to && s.from <= iso && iso <= s.to);
}
function leavesToday(leave, meta, now) {
  const t = muscatToday(now), frozen = frozenOn(meta, t.iso);
  return leave.filter(l => l.data && (l.data.type === 'Weekly'
    ? !frozen && (l.data.weekdays || []).indexOf(t.wd) >= 0
    : l.month === t.month && (l.data.days || []).indexOf(t.day) >= 0 && !(frozen && l.data.type === 'Vacation')));
}
async function backupTodayFor(email, ctx) {
  email = norm(email);
  const t = muscatToday();
  const leave = ctx.leave || items(await fsGet(DOC.leave)), meta = ctx.meta || (await fsGet(DOC.meta)) || {};
  const mine = leavesToday(leave, meta).filter(l => l.data.backup === email);
  if (!mine.length) return [];
  const month = ctx.monthItems || items(await fsGet(DOC.month(t.month)));
  const names = {};
  (await accessRows()).forEach(r => { if (r.email && !names[r.email]) names[r.email] = r.name; });
  const week = weekOf(t.day);
  return mine.map(l => {
    const tasks = month.filter(x => x.email === l.email && (x.weeks || []).indexOf(week) >= 0 && (!((x.data || {}).days || []).length || x.data.days.indexOf(t.day) >= 0));
    const snaps = [];
    tasks.forEach(x => {
      const acc = ((x.data || {}).accounts || []).map(a => a === 'usa' ? 'US' : 'AR').join(' + ');
      ((x.data || {}).snaps || []).forEach(s => snaps.push({ n: s.n, t: s.t, acc }));
    });
    return { email: l.email, name: names[l.email] || l.email.split('@')[0], type: l.data.type || 'Vacation', tasks: tasks.length, snaps: snaps.slice(0, 10) };
  });
}

/* ---------- index: which document holds a task ---------- */

async function locate(id) { const ix = (await fsGet(DOC.index)) || {}; return ix[String(id)] || ''; }
async function indexSet(changes) {
  await fsUpdate(DOC.index, ix => { ix = ix || {}; Object.keys(changes).forEach(k => { if (changes[k]) ix[k] = changes[k]; else delete ix[k]; }); return ix; });
}
const docOf = loc => loc === 'quick' ? DOC.quick : loc === 'leave' ? DOC.leave : DOC.month(loc.slice(2));

async function setNotices(emails, text, countOf) {
  if (!emails.length) return;
  await fsUpdate(DOC.notices, all => {
    all = all || {};
    emails.forEach(e => { all[e] = { at: Date.now(), text: String(text).slice(0, 120), count: countOf ? countOf(e) : 1 }; });
    return all;
  });
}

/* ---------- the calls (same names and arguments as Code.gs) ---------- */

const T = {
  async tasksLoad([token, month]) {
    const a = await assertAccess(token);
    month = monthOk(month);
    const [mem, cur, prev, quick, leave, meta] = await Promise.all([members(), fsGet(DOC.month(month)), fsGet(DOC.month(prevMonth(month))),
      fsGet(DOC.quick), fsGet(DOC.leave), fsGet(DOC.meta)]);
    const twoWeeks = Date.now() - 14 * 864e5;
    return {
      store: 'firebase',
      me: { email: a.email, name: a.name || '', canManage: canManage(a.email, mem) },
      people: await teamPeople(mem, a),
      month,
      tasks: items(cur).map(pub),
      quick: items(quick).filter(q => !(q.done && q.done.at) || q.done.at > twoWeeks).map(pub),
      leave: items(leave).filter(l => l.month === month || l.month === 'ALL').map(pub),
      freeze: (meta && meta.freeze) || { on: false, seasons: [] },
      prevCount: items(prev).length,
      sent: ((meta && meta.sent) || {})[month] || {}
    };
  },

  async taskSave([token, task]) {
    const { a, mem } = await assertManager(token);
    task = task || {};
    const kind = ['quick', 'leave'].indexOf(task.kind) >= 0 ? task.kind : 'weekly';
    const email = norm(task.email);
    const d = task.data || {};
    const leaveType = LEAVE_TYPES.indexOf(d.type) >= 0 ? d.type : 'Weekly';
    const title = kind === 'leave' ? leaveType : String(task.title || '').trim().slice(0, 140);
    if (!email) throw new Error('Choose who the task is for.');
    if (!title) throw new Error('Give the task a name.');
    const clean = {
      accounts: (Array.isArray(d.accounts) ? d.accounts : [d.account]).filter((x, i, all) => (x === 'usa' || x === 'ar') && all.indexOf(x) === i),
      platforms: (Array.isArray(d.platforms) ? d.platforms : []).filter(p => p === 'google' || p === 'microsoft'),
      snaps: (Array.isArray(d.snaps) ? d.snaps : []).slice(0, 12).map(s => ({ n: String((s && s.n) || '').trim().slice(0, 60), t: String((s && s.t) || '').slice(0, 10) })).filter(s => s.n),
      msg: String(d.msg || '').trim().slice(0, 600),
      days: (Array.isArray(d.days) ? d.days : []).map(Number).filter((n, i, all) => n >= 1 && n <= 31 && Math.round(n) === n && all.indexOf(n) === i).sort((x, y) => x - y)
    };
    if (kind === 'leave') {
      if (!canManage(a.email, mem)) throw new Error('Only Team Leaders, Media Managers, the Head of Media and Ibrahim Amin can set days off.');
      const backup = norm(d.backup);
      clean.type = leaveType;
      clean.backup = backup && backup !== email ? backup : '';
      clean.note = clean.msg;
      if (leaveType === 'Weekly') {
        clean.weekdays = (Array.isArray(d.weekdays) ? d.weekdays : []).map(Number).filter((n, i, all) => n >= 0 && n <= 6 && Math.round(n) === n && all.indexOf(n) === i).sort();
        clean.days = [];
        if (!clean.weekdays.length) throw new Error('Pick the weekly day off.');
      } else if (!clean.days.length) throw new Error('Pick the days off.');
    }
    let month;
    if (kind === 'leave' && leaveType === 'Weekly') month = 'ALL';
    else if (kind !== 'quick') month = monthOk(task.month);
    let weeks = kind === 'weekly' ? (Array.isArray(task.weeks) ? task.weeks : []).map(Number).filter(n => n >= 1 && n <= 4).sort() : [];
    if (kind !== 'quick' && clean.days.length) weeks = clean.days.map(weekOf).filter((n, i, all) => all.indexOf(n) === i);
    if (kind === 'weekly' && !weeks.length) throw new Error('Choose at least one week.');
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(task.deadline || '')) ? String(task.deadline) : '';

    const oldLoc = task.id ? await locate(task.id) : '';
    const loc = kind === 'quick' ? 'quick' : kind === 'leave' ? 'leave' : 'm-' + month;
    let saved = null, isNew = false;
    // An edit that moves a weekly task to another month leaves its old document.
    if (oldLoc && oldLoc !== loc) {
      let old = null;
      await fsUpdate(docOf(oldLoc), doc => { const list = items(doc); old = list.find(x => x.id === task.id) || null; return { items: list.filter(x => x.id !== task.id) }; });
      if (old) saved = old;
    }
    await fsUpdate(docOf(loc), doc => {
      const list = items(doc).slice();
      let t = task.id ? list.find(x => x.id === task.id) : null;
      if (!t && saved) { t = saved; list.push(t); }
      // One weekly day-off row per person: a second one updates the first.
      if (!t && kind === 'leave' && leaveType === 'Weekly') t = list.find(x => x.email === email && (x.data || {}).type === 'Weekly') || null;
      if (!t) { t = { id: uid(kind === 'quick' ? 'Q-' : kind === 'leave' ? 'L-' : 'T-'), kind, at: Date.now(), by: a.email, done: {} }; list.push(t); isNew = true; }
      t.kind = kind; t.email = email; t.title = title; t.data = clean; t.weeks = weeks; t.deadline = deadline; t.upd = Date.now();
      t.month = kind === 'quick' ? (t.month || muscatToday().month) : month;
      t.done = t.done || {};
      saved = t;
      return { items: list };
    });
    if (oldLoc !== loc || isNew) await indexSet({ [saved.id]: loc });
    if (kind === 'quick' && isNew) await setNotices([email], 'New request: ' + title);
    return pub(saved);
  },

  async taskDelete([token, id]) {
    const { a, mem } = await assertManager(token);
    const loc = await locate(id);
    if (!loc) return { ok: true };
    if (loc === 'leave' && !canManage(a.email, mem)) throw new Error('Only Team Leaders, Media Managers, the Head of Media and Ibrahim Amin can change days off.');
    await fsUpdate(docOf(loc), doc => ({ items: items(doc).filter(x => x.id !== String(id)) }));
    await indexSet({ [String(id)]: null });
    return { ok: true };
  },

  async taskDone([token, id, week, done]) {
    const a = await assertAccess(token), mem = await members();
    const loc = await locate(id);
    if (!loc) throw new Error('This task was removed.');
    let out = null;
    await fsUpdate(docOf(loc), doc => {
      const list = items(doc), t = list.find(x => x.id === String(id));
      if (!t) throw new Error('This task was removed.');
      if (t.email !== a.email && !canManage(a.email, mem)) throw new Error('Only the person on the task can tick it.');
      const k = t.kind === 'quick' ? 'at' : String(Math.max(1, Math.min(4, Number(week) || 1)));
      t.done = t.done || {};
      if (done) t.done[k] = Date.now(); else delete t.done[k];
      out = t;
      return { items: list };
    });
    return pub(out);
  },

  async tasksCopyMonth([token, fromMonth, toMonth]) {
    const { a } = await assertManager(token);
    fromMonth = monthOk(fromMonth); toMonth = monthOk(toMonth);
    const from = items(await fsGet(DOC.month(fromMonth)));
    const added = [];
    await fsUpdate(DOC.month(toMonth), doc => {
      const list = items(doc).slice(), have = {};
      list.forEach(t => { have[t.email + '|' + t.title] = 1; });
      added.length = 0;
      from.filter(t => !have[t.email + '|' + t.title]).forEach(t => {
        const n = { id: uid('T-'), kind: 'weekly', month: toMonth, weeks: t.weeks, email: t.email, title: t.title, data: t.data, done: {}, by: a.email, at: Date.now(), deadline: '' };
        list.push(n); added.push(n.id);
      });
      return added.length ? { items: list } : undefined;
    });
    if (added.length) { const ch = {}; added.forEach(i => { ch[i] = 'm-' + toMonth; }); await indexSet(ch); }
    return { copied: added.length };
  },

  async tasksSendWeek([token, month, week]) {
    const { a, mem } = await assertManager(token);
    month = monthOk(month); week = Math.max(1, Math.min(4, Number(week) || 1));
    const people = {};
    (await teamPeople(mem)).forEach(p => { people[p.email] = p; });
    const mine = {};
    items(await fsGet(DOC.month(month))).filter(t => (t.weeks || []).indexOf(week) >= 0).forEach(t => { (mine[t.email] = mine[t.email] || []).push(t); });
    const y = +month.slice(0, 4), m = +month.slice(5, 7), dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const from = (week - 1) * 7 + 1, to = week === 4 ? dim : week * 7;
    const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
    const range = from + '–' + to + ' ' + monthName;
    const emails = Object.keys(mine);
    const mails = emails.map(email => {
      const p = people[email] || { name: email.split('@')[0] };
      const list = mine[email].map(t => {
        const d = t.data || {};
        const tags = [(d.accounts || (d.account ? [d.account] : [])).map(x => 'HA-' + x.toUpperCase()).join(' + '), (d.platforms || []).map(x => x === 'google' ? 'Google' : 'Microsoft').join(' + ')].filter(Boolean).join(' · ');
        const snaps = (d.snaps || []).map(s => '<li style="margin:2px 0">' + esc(s.n) + (s.t ? ' — <b>' + esc(s.t) + '</b> Egypt time' : '') + '</li>').join('');
        const days = (d.days || []).filter(n => n >= from && n <= to);
        return '<div style="border:1px solid #e6eaf4;border-radius:12px;padding:12px 14px;margin:0 0 10px">' +
          '<div style="font-weight:800;font-size:15px">' + esc(t.title) + '</div>' +
          (days.length ? '<div style="font-size:12px;color:#3d6bff;font-weight:700;margin-top:2px">Only on day ' + days.join(', ') + '</div>' : '') +
          (tags ? '<div style="font-size:12px;color:#8a92a0;margin-top:2px">' + esc(tags) + '</div>' : '') +
          (snaps ? '<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;color:#4c5464">' + snaps + '</ul>' : '') +
          (d.msg ? '<div style="margin-top:8px;font-size:13px;color:#4c5464;background:#f8f9fc;border-radius:8px;padding:8px 10px">' + esc(d.msg) + '</div>' : '') + '</div>';
      }).join('');
      return { to: email, replyTo: a.email, subject: '📋 Your SEKNA tasks — Week ' + week + ' (' + range + ')', title: 'Week ' + week + ' tasks · ' + esc(range),
        html: '<p style="margin:0 0 14px;font-size:14px;color:#4c5464">Hi ' + esc(String(p.name).split(' ')[0]) + ', here are your tasks for this week.</p>' + list,
        button: { url: WEB_PAGE_URL + '/?tasks=mine', label: 'Open My Tasks' } };
    });
    await setNotices(emails, 'Week ' + week + ' · ' + range, e => mine[e].length);
    let sentAt = Date.now();
    await fsUpdate(DOC.meta, meta => {
      meta = meta || {};
      const sent = meta.sent || {};
      Object.keys(sent).sort().slice(0, -6).forEach(k => delete sent[k]);
      (sent[month] = sent[month] || {})[week] = sentAt;
      meta.sent = sent;
      return meta;
    });
    await relay({ emails: mails, pushes: emails.map(e => ({ email: e, title: 'SEKNA · Week ' + week + ' tasks', body: 'Your tasks for ' + range + ' are ready.' })) });
    return { sent: emails.length, at: sentAt };
  },

  async leaveFreezeSet([token, cfg]) {
    const a = await assertAccess(token), mem = await members();
    if (!canManage(a.email, mem)) throw new Error('Only Team Leaders, Media Managers, the Head of Media and Ibrahim Amin can freeze leave.');
    cfg = cfg || {};
    const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const seasons = (Array.isArray(cfg.seasons) ? cfg.seasons : []).slice(0, 12)
      .map(s => ({ name: String((s && s.name) || 'Season').trim().slice(0, 40), from: String((s && s.from) || ''), to: String((s && s.to) || '') }))
      .filter(s => ok(s.from) && ok(s.to)).map(s => s.from > s.to ? { name: s.name, from: s.to, to: s.from } : s);
    const out = { on: !!cfg.on, seasons };
    await fsUpdate(DOC.meta, meta => Object.assign(meta || {}, { freeze: out }));
    return out;
  },

  /** Position or avatar for one email (admin). Apps Script keeps a copy until it is retired. */
  async adminSetMember([token, email, field, value]) {
    const a = await assertAccess(token);
    if (!isAdminEmail(a.email)) { const e = new Error('SEKNA_ADMIN_ONLY'); e.access = true; throw e; }
    email = norm(email);
    if (!email) throw new Error('Missing email');
    let result = null;
    await fsUpdate(DOC.members, all => {
      all = all || {};
      const m = all[email] || {};
      if (field === 'role') {
        const r = String(value || '');
        if (r && ROLES.indexOf(r) < 0) throw new Error('Unknown position');
        if (r) m.role = r; else delete m.role;
      } else if (field === 'avatar') {
        const n = Math.round(Number(value) || 0);
        if (n !== 0 && (n < 11 || n > 24)) throw new Error('Unknown avatar');
        if (n) m.avatar = n; else delete m.avatar;
      } else throw new Error('Unknown field');
      if (m.role || m.avatar) all[email] = m; else delete all[email];
      result = all[email] || {};
      return all;
    });
    try { await appsScript('adminSetMember', [token, email, field, value]); } catch (e) { console.warn('Apps Script member copy: ' + e.message); }
    return { email, member: result };
  },

  /** What the app adds to the access status: position, the "new tasks" notice, and who this person covers today. */
  async teamStatus([token]) {
    const a = await assertAccess(token);
    const [mem, notices] = await Promise.all([members(), fsGet(DOC.notices)]);
    return { member: mem[a.email] || {}, taskNotice: (notices || {})[a.email] || null, backupToday: await backupTodayFor(a.email, {}) };
  }
};

/** Position, "new tasks" notice and today's backups for one signed-in person (used by the access status). */
async function teamStatusFor(a) {
  if (!(await moved())) return null;
  const [mem, notices] = await Promise.all([members(), fsGet(DOC.notices)]);
  return { member: mem[a.email] || {}, taskNotice: (notices || {})[a.email] || null, backupToday: await backupTodayFor(a.email, {}) };
}

/* ---------- the move (admin, once) ---------- */

/** Copies the SEKNA Tasks sheet and the Apps Script settings into Firestore, then switches Team Tasks over. */
async function adminTasksMove([token]) {
  const a = await assertAccess(token);
  if (!isAdminEmail(a.email)) { const e = new Error('SEKNA_ADMIN_ONLY'); e.access = true; throw e; }
  // Once moved, the sheet is out of date: copying it again would lose the changes made since.
  if (await moved()) throw new Error('Team Tasks already moved to the SEKNA server.');
  const props = await appsScript('tasksExportProps', [token, false]);
  const [rows] = await batchGet(TASKS_SHEET.ID, [a1(TASKS_SHEET.NAME, 'A2:L')], true);
  const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const asMonth = v => { const s = String(v || ''); const m = s.match(/^(\d{4})-(\d{2})/); if (m) return m[1] + '-' + m[2];
    const d = new Date(s); return isNaN(d) ? s : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const asDay = v => { const s = String(v || ''); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d = new Date(s); return !s || isNaN(d) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const asMs = v => { const n = Number(v); if (n > 1e11) return n; const d = new Date(String(v || '')); return isNaN(d) ? 0 : d.getTime(); };
  const tasks = (rows || []).filter(v => v && v[0]).map(v => {
    const weeks = String(v[3] == null ? '' : v[3]).split(/[^0-9]+/).map(Number).filter(n => n >= 1 && n <= 4);
    const kind = String(v[1] || 'weekly');
    const month = String(v[2] || '').toUpperCase() === 'ALL' ? 'ALL' : asMonth(v[2]);
    return { id: String(v[0]), kind, month, weeks: weeks.filter((n, i, all) => all.indexOf(n) === i).sort(), email: norm(v[4]), title: String(v[5] || ''),
      data: parse(v[6], {}), done: parse(v[7], {}), by: String(v[8] || ''), at: asMs(v[9]), upd: asMs(v[10]), deadline: asDay(v[11]) };
  });
  const byMonth = {}, quick = [], leave = [], index = {};
  tasks.forEach(t => {
    if (t.kind === 'quick') { quick.push(t); index[t.id] = 'quick'; }
    else if (t.kind === 'leave') { leave.push(t); index[t.id] = 'leave'; }
    else if (/^\d{4}-\d{2}$/.test(t.month)) { (byMonth[t.month] = byMonth[t.month] || []).push(t); index[t.id] = 'm-' + t.month; }
  });
  for (const m of Object.keys(byMonth)) await fsSet(DOC.month(m), { items: byMonth[m] });
  await fsSet(DOC.quick, { items: quick });
  await fsSet(DOC.leave, { items: leave });
  await fsSet(DOC.index, index);
  await fsSet(DOC.members, props.members || {});
  await fsSet(DOC.notices, props.notices || {});
  await fsSet(DOC.meta, { freeze: props.freeze || { on: false, seasons: [] }, sent: props.sent || {} });
  const counts = { weekly: Object.keys(byMonth).reduce((n, m) => n + byMonth[m].length, 0), months: Object.keys(byMonth).length, quick: quick.length, leave: leave.length, members: Object.keys(props.members || {}).length, rows: tasks.length };
  await fsSet(DOC.mode, { mode: 'firebase', at: Date.now(), by: a.email, counts });
  modeCache = { at: Date.now(), on: true };
  // From now on Apps Script refuses Team Tasks changes and stops its own 9 AM push.
  await appsScript('tasksExportProps', [token, true]);
  return counts;
}

/* ---------- 9 AM: a push to each backup ---------- */

async function morningPush() {
  if (!(await moved())) return { skipped: true };
  const [leave, meta] = await Promise.all([fsGet(DOC.leave), fsGet(DOC.meta)]);
  const lv = items(leave), mt = meta || {};
  const monthItems = items(await fsGet(DOC.month(muscatToday().month)));
  const backups = {};
  leavesToday(lv, mt).filter(l => l.data.backup).forEach(l => { backups[l.data.backup] = 1; });
  const toMin = s => { const m = String(s || '').match(/^(\d+):(\d+) (AM|PM)$/); return m ? (Number(m[1]) % 12 + (m[3] === 'PM' ? 12 : 0)) * 60 + Number(m[2]) : 9999; };
  const pushes = [];
  for (const email of Object.keys(backups)) {
    (await backupTodayFor(email, { leave: lv, meta: mt, monthItems })).forEach(b => {
      const snaps = (b.snaps || []).slice().sort((x, y) => toMin(x.t) - toMin(y.t));
      const first = String(b.name).split(' ')[0];
      pushes.push({ email, title: 'SEKNA · You are the backup today',
        body: first + ' is off today — you are covering. ' + (snaps.length ? snaps.length + ' snapshot' + (snaps.length > 1 ? 's' : '') + ', first ' + snaps[0].n + ' at ' + snaps[0].t + '.' : 'Open SEKNA for the details.') });
    });
  }
  return relay({ pushes });
}

/** Router: before the move every call goes to Apps Script unchanged. */
async function call(fn, args) {
  if (fn === 'adminTasksMove') return adminTasksMove(args);
  if (fn === 'adminTasksMoveStatus') {
    const a = await assertAccess(args[0]);
    if (!isAdminEmail(a.email)) { const e = new Error('SEKNA_ADMIN_ONLY'); e.access = true; throw e; }
    return (await fsGet(DOC.mode)) || { mode: 'appsscript' };
  }
  if (!(await moved())) return appsScript(fn, args);
  return T[fn](args);
}
const FNS = Object.keys(T).concat(['adminTasksMove', 'adminTasksMoveStatus']);

module.exports = { call, FNS, morningPush, muscatToday, leavesToday, frozenOn, weekOf, prevMonth, appsScript, relay, teamStatusFor, members };
