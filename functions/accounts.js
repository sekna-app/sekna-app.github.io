// Sign-in, approvals, devices, invites, maintenance and team messages on the SEKNA server,
// ported from Code.gs. Until the admin moves them (adminAccessMove), every call is passed to
// Apps Script. After the move the "SEKNA Access" sheet is kept as a copy (rewritten after every
// change), because the Apps Script parts that are not moved yet still check tokens there.
const crypto = require('crypto');
const { fsGet, fsSet, fsUpdate, batchGet, a1, valuesUpdate, valuesUpdateTyped, valuesClear, sheetMeta } = require('./google');
const { ACCESS, ACC, sha256, assertAccess, assertAdmin, assertOwner, checkAccessToken, storeRows, forgetRows, accessMoved, markMoved, isAdminEmail,
  PERM_KEYS, PERM_DOC, permDefaults, permsFor, forgetPerms } = require('./access');
const tasks = require('./tasks');

const API_URL = 'https://europe-west2-human-appeal-media-plan.cloudfunctions.net/api';
const CFG = {
  ADMIN_EMAIL: 'seknaapp@gmail.com',
  SENDER_EMAIL: 'seknaapp@gmail.com',
  WEB_PAGE_URL: 'https://sekna-app.web.app',
  CODE_TTL_MS: 600 * 1000,
  CODE_MAX_ATTEMPTS: 5,
  CODE_COOLDOWN_MS: 55 * 1000,
  CODES_PER_HOUR: 5,
  PROFILES_SHEET: 'SEKNA Profiles',
  TZ: 'Asia/Muscat'
};
const DOC = { secret: 'acc/secret', app: 'acc/app', otp: k => 'acc/otp-' + k };

/* ---------- helpers ---------- */

const norm = e => String(e || '').trim().toLowerCase();
const validEmail = e => e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0];
  const part = local.split(/[._\-+0-9]+/).filter(Boolean)[0] || local;
  return part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : 'there';
}
const cleanDevice = d => String(d || 'Unknown device').replace(/[<>]/g, '').slice(0, 120);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function parts(ms, tz) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz || CFG.TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return p;
}
const isoLocal = (ms, tz) => { if (!ms) return ''; const p = parts(ms, tz); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; };
const sheetDate = (ms, tz) => { if (!ms) return ''; const p = parts(ms, tz); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; };
const ymd = ms => { const p = parts(ms); return `${p.year}${p.month}${p.day}`.slice(2); };
const today = () => { const p = parts(Date.now()); return `${p.year}-${p.month}-${p.day}`; };
const shortId = () => crypto.randomBytes(3).toString('hex').toUpperCase();
/** A spreadsheet date number (days since 1899-12-30, in the sheet's time zone) as epoch ms. */
function serialToMs(v, tz) {
  const n = Number(v);
  if (!n || !isFinite(n)) return 0;
  const naive = Math.round((n - 25569) * 864e5);
  const p = parts(naive, tz);
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return naive - (shown - naive);
}

async function secret() {
  const s = await fsGet(DOC.secret);
  if (!s || !s.value) throw new Error('Sign-in has not moved to the SEKNA server yet.');
  return s.value;
}
async function sign(text) {
  return crypto.createHmac('sha256', await secret()).update(String(text), 'utf8').digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sameSig(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
async function reviewUrl(id, decision) {
  return `${API_URL}/review?id=${encodeURIComponent(id)}&decision=${decision}&sig=${encodeURIComponent(await sign(id + '|' + decision))}`;
}

function relayEmail(m) { return tasks.relay({ emails: [m] }); }
const P = s => '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4c5464">' + s + '</p>';

/* ---------- rows: Firestore, with the sheet kept as a copy ---------- */

async function saveRows(change) {
  const out = await fsUpdate(ACC.rows, doc => {
    const list = (doc && Array.isArray(doc.items)) ? doc.items.slice() : [];
    const r = change(list);
    return r === undefined ? undefined : { items: r || list };
  });
  forgetRows(out && out.items);
  await mirror(out && out.items).catch(err => console.error('Access sheet copy failed: ' + err.message));
  return out ? out.items : [];
}
/** Rewrites the "SEKNA Access" sheet from Firestore, so Apps Script still knows every device. */
async function mirror(list) {
  list = list || await storeRows(true);
  const seen = (await fsGet(ACC.seen)) || {};
  const tz = (await sheetMeta(ACCESS.SPREADSHEET_ID)).timeZone;
  const n = list.length;
  if (n) {
    await valuesUpdate(ACCESS.SPREADSHEET_ID, a1(ACCESS.SHEET_NAME, `A2:E${n + 1}`), list.map(r => [r.id, r.name, r.email, r.status, r.device || '']));
    await valuesUpdateTyped(ACCESS.SPREADSHEET_ID, a1(ACCESS.SHEET_NAME, `F2:H${n + 1}`),
      list.map(r => [sheetDate(r.requestedAt, tz), sheetDate(r.decidedAt, tz), sheetDate(Math.max(r.lastSeen || 0, seen[r.tokenHash] || 0), tz)]));
    await valuesUpdate(ACCESS.SPREADSHEET_ID, a1(ACCESS.SHEET_NAME, `I2:J${n + 1}`), list.map(r => [r.tokenHash || '', r.deviceId || '']));
  }
  await valuesClear(ACCESS.SPREADSHEET_ID, a1(ACCESS.SHEET_NAME, `A${n + 2}:J`));
}

/* ---------- app state (maintenance, team message) ---------- */

let appCache = null;
async function appState() {
  if (appCache && Date.now() - appCache.at < 30000) return JSON.parse(JSON.stringify(appCache.s));
  const s = (await fsGet(DOC.app)) || {};
  appCache = { at: Date.now(), s: JSON.parse(JSON.stringify(s)) };
  s.maintenance = s.maintenance || { on: false, reason: '' };
  s.announcement = s.announcement || null;
  return s;
}
const live = a => !!(a && a.message && (!a.showFrom || a.showFrom <= today()));
function publicApp(s) {
  const a = s.announcement;
  return { maintenance: { on: !!s.maintenance.on, reason: s.maintenance.reason || '' }, announcement: live(a) ? { id: a.id, title: a.title || '', message: a.message } : null };
}
async function setApp(change) {
  appCache = null;
  const out = await fsUpdate(DOC.app, s => { s = s || {}; s.maintenance = s.maintenance || { on: false, reason: '' }; s.announcement = s.announcement || null; return change(s) || s; });
  // Apps Script keeps a copy (its dashboard backup and app-release pushes look at maintenance).
  tasks.relay({ appState: out }).catch(err => console.warn('App state copy: ' + err.message));
  return out;
}
async function pushAnnouncement(s) {
  const a = s.announcement, body = String(a.message).replace(/\{name\}/gi, 'team');
  await tasks.relay({ topics: [{ title: a.title || 'SEKNA', body: body.length > 180 ? body.slice(0, 177) + '…' : body, account: 'usa', eventType: 'announcement' }] });
}

/* ---------- photos (read from the Profiles sheet Apps Script filled) ---------- */
let photoCache = null;
async function photos() {
  if (photoCache && Date.now() - photoCache.at < 10 * 60 * 1000) return photoCache.map;
  const map = {};
  try {
    const [rows] = await batchGet(ACCESS.SPREADSHEET_ID, [a1(CFG.PROFILES_SHEET, 'A2:B')]);
    (rows || []).forEach(r => { if (r[0] && r[1]) map[norm(r[0])] = String(r[1]); });
  } catch (e) {}
  photoCache = { at: Date.now(), map };
  return map;
}

/* ---------- the calls (same names and arguments as Code.gs) ---------- */

const A = {
  async accessRequestCode([email]) {
    email = norm(email);
    if (!validEmail(email)) throw new Error('Please enter a valid email address.');
    const key = sha256(email).slice(0, 40);
    const code = String(crypto.randomInt(100000, 1000000));
    await fsUpdate(DOC.otp(key), o => {
      o = o || {};
      if (o.cdUntil && Date.now() < o.cdUntil) throw new Error('A code was just sent. Please wait a minute before requesting another one.');
      const rl = o.rl && Date.now() < o.rl.until ? o.rl : { n: 0, until: Date.now() + 3600 * 1000 };
      if (rl.n >= CFG.CODES_PER_HOUR) throw new Error('Too many codes requested. Please try again in an hour.');
      rl.n++;
      return { hash: sha256(email + ':' + code), attempts: 0, exp: Date.now() + CFG.CODE_TTL_MS, cdUntil: Date.now() + CFG.CODE_COOLDOWN_MS, rl };
    });
    const name = nameFromEmail(email);
    await relayEmail({ to: email, replyTo: CFG.SENDER_EMAIL, subject: 'Your SEKNA verification code: ' + code, title: 'Hi ' + esc(name) + ',',
      html: P('Use this code to verify your email and request access to the SEKNA dashboard:') +
        '<div style="margin:0 0 16px;padding:16px;border-radius:12px;background:#eef2fd;text-align:center;font-size:30px;font-weight:800;letter-spacing:8px;color:#203C8E">' + code + '</div>' +
        '<p style="margin:0;font-size:12px;line-height:1.6;color:#8a92a0">The code expires in 10 minutes. If you did not request it, you can ignore this email.</p>' });
    return { ok: true, name };
  },

  async accessVerifyCode([email, code, device, deviceId]) {
    email = norm(email);
    code = String(code || '').replace(/\D/g, '');
    const key = sha256(email).slice(0, 40);
    let verdict = '';
    await fsUpdate(DOC.otp(key), o => {
      if (!o || !o.hash || Date.now() > o.exp) { verdict = 'expired'; return o ? Object.assign(o, { hash: '' }) : undefined; }
      if (o.attempts >= CFG.CODE_MAX_ATTEMPTS) { verdict = 'attempts'; return Object.assign(o, { hash: '' }); }
      if (!sameSig(o.hash, sha256(email + ':' + code))) { verdict = 'wrong'; o.attempts++; return o; }
      verdict = 'ok';
      return Object.assign(o, { hash: '' });
    });
    if (verdict === 'expired') throw new Error('This code has expired. Please request a new one.');
    if (verdict === 'attempts') throw new Error('Too many attempts. Please request a new code.');
    if (verdict === 'wrong') throw new Error('That code is not correct. Please try again.');

    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    deviceId = String(deviceId || '').replace(/[^\w-]/g, '').slice(0, 64);
    let req = null, status = 'Pending';
    await saveRows(list => {
      const mine = list.filter(r => r.email === email);
      const blocked = mine.some(r => r.status === 'Denied' || r.status === 'Revoked');
      // Approved at once: the admins, people the admin invited, and new devices of people already approved.
      const known = mine.some(r => r.status === 'Approved' || r.status === 'Signed out' || r.status === 'Invited');
      status = isAdminEmail(email) || (known && !blocked) ? 'Approved' : 'Pending';
      const invite = mine.find(r => r.status === 'Invited' && !r.tokenHash);
      const same = deviceId ? mine.find(r => r.deviceId === deviceId) : null;
      const reuse = same || invite;
      req = { id: reuse ? reuse.id : 'REQ-' + ymd(now) + '-' + shortId(), name: nameFromEmail(email), email, status, device: cleanDevice(device),
        requestedAt: now, decidedAt: status === 'Approved' ? now : 0, lastSeen: now, tokenHash: sha256(token), deviceId };
      if (reuse) list[list.indexOf(reuse)] = req; else list.push(req);
      return list;
    });
    if (!isAdminEmail(email)) await adminRequestEmail(req, status === 'Approved').catch(err => console.error('Admin email: ' + err.message));
    return { ok: true, token, status, name: req.name };
  },

  async accessStatus([token]) {
    const a = await checkAccessToken(token);
    const perms = a.ok ? await permsFor(a.email) : null;
    const out = { status: a.status, name: a.name || '', email: a.email || '', isAdmin: !!(perms && perms.admin === true), owner: !!(a.ok && isAdminEmail(a.email)), perms,
      photo: '', member: {}, taskNotice: null, backupToday: [], pushTopic: '', dashboard: { version: 'server' }, app: null };
    if (!a.ok) return out;
    const [ph, team, st] = await Promise.all([photos(), tasks.teamStatusFor(a).catch(() => null), appState()]);
    out.photo = ph[a.email] || '';
    if (team) Object.assign(out, team);
    else out.member = (await tasks.members())[a.email] || {};
    out.pushTopic = 'sekna-u-' + sha256(norm(a.email)).slice(0, 24);
    out.app = publicApp(st);
    return out;
  },

  async accessSignOut([token]) {
    const hash = sha256(String(token || ''));
    await saveRows(list => {
      const r = list.find(x => x.tokenHash === hash);
      if (!r || r.status !== 'Approved') return undefined;
      r.status = 'Signed out'; r.decidedAt = Date.now();
      return list;
    });
    return { ok: true };
  },

  async adminOverview([token]) {
    const me = await assertAdmin(token);
    const [list, seen, ph, mem] = await Promise.all([storeRows(true), fsGet(ACC.seen), photos(), tasks.members()]);
    const sn = seen || {};
    const rows = list.map(r => {
      const last = Math.max(r.lastSeen || 0, sn[r.tokenHash] || 0);
      return { id: r.id, name: r.name, email: r.email, status: r.status || 'Pending', device: r.device || '',
        requestedAt: isoLocal(r.requestedAt), lastSeen: isoLocal(last), lastSeenMs: last };
    });
    return { me: me.email, now: Date.now(), rows, photos: ph, members: mem };
  },

  /** Admin → Permissions: everyone approved, with their role and what they can use (the SEKNA admin only). */
  async adminPerms([token]) {
    await assertOwner(token);
    const [rows, mem, over] = await Promise.all([storeRows(), tasks.members(), fsGet(PERM_DOC)]);
    const seen = {}, people = [];
    // Approved people, and those still waiting or invited, so their access can be set before approving.
    const rank = { Approved: 0, Pending: 1, Invited: 2 };
    rows.filter(r => r.status in rank).sort((a, b) => rank[a.status] - rank[b.status]).forEach(r => {
      const e = norm(r.email); if (seen[e]) return; seen[e] = 1;
      const role = (mem[e] || {}).role || '';
      people.push({ email: e, name: r.name || '', role, status: r.status, owner: isAdminEmail(e), defaults: permDefaults(role), set: (over || {})[e] || {} });
    });
    for (const p of people) p.perms = await permsFor(p.email);
    return { keys: PERM_KEYS, people };
  },
  async adminPermsSet([token, changes]) {
    const me = await assertOwner(token);
    const out = await fsUpdate(PERM_DOC, doc => {
      const all = Object.assign({}, doc || {});
      Object.keys(changes && typeof changes === 'object' ? changes : {}).slice(0, 200).forEach(email => {
        const e = norm(email);
        if (!e || isAdminEmail(e)) return;
        const c = changes[email] || {}, cur = Object.assign({}, all[e] || {});
        PERM_KEYS.forEach(k => { if (c[k] === true || c[k] === false || c[k] === 'lock') cur[k] = c[k]; else if (c[k] === null) delete cur[k]; });
        if (c.blocked === true) cur.blocked = true; else if (c.blocked === false) delete cur.blocked;
        if (Object.keys(cur).length) all[e] = cur; else delete all[e];
      });
      all._by = me.email; all._at = Date.now();
      return all;
    });
    forgetPerms();
    return { ok: true, at: out._at };
  },

  async adminSetStatus([token, id, action]) {
    const me = await assertAdmin(token);
    await guardOwner(me, id);
    const map = { approve: 'Approved', restore: 'Approved', deny: 'Denied', revoke: 'Revoked' };
    if (!map[action]) throw new Error('Unknown action.');
    return decide(String(id || ''), map[action]);
  },

  async adminInvite([token, email]) {
    const me = await assertAdmin(token);
    email = norm(email);
    if (!validEmail(email)) throw new Error('Please enter a valid email address.');
    const name = nameFromEmail(email);
    let already = false;
    await saveRows(list => {
      const mine = list.filter(r => r.email === email);
      if (mine.some(r => r.status === 'Approved')) { already = true; return undefined; }
      if (mine.some(r => r.status === 'Invited')) return undefined;
      const now = Date.now();
      list.push({ id: 'INV-' + ymd(now) + '-' + shortId(), name, email, status: 'Invited', device: 'Invited by ' + me.email, requestedAt: now, decidedAt: now, lastSeen: 0, tokenHash: '', deviceId: '' });
      return list;
    });
    if (already) return { ok: true, already: true, name };
    await relayEmail({ to: email, replyTo: CFG.SENDER_EMAIL, subject: name + ', you have access to the SEKNA dashboard', title: 'Hi ' + esc(name) + ',',
      html: P('You have been given access to the SEKNA dashboard. Open the SEKNA app, or the link below, and confirm your email with the code we send you.'),
      button: { url: CFG.WEB_PAGE_URL, label: 'Open SEKNA' } });
    return { ok: true, already: false, name };
  },

  async adminDelete([token, id]) {
    const me = await assertAdmin(token);
    await guardOwner(me, id);
    let name = '';
    await saveRows(list => {
      const r = list.find(x => x.id === String(id || ''));
      if (!r) throw new Error('This record no longer exists.');
      if (r.status === 'Approved' || r.status === 'Pending') throw new Error('Revoke or deny this device before deleting it.');
      name = r.name;
      return list.filter(x => x !== r);
    });
    return { ok: true, name };
  },

  /** From the review page that the admin opens from the request email. */
  async accessDecide([id, decision, sig]) {
    id = String(id || ''); decision = String(decision || '');
    if (['approve', 'deny', 'revoke'].indexOf(decision) < 0 || !sameSig(String(sig || ''), await sign(id + '|' + decision))) throw new Error('This link is not valid.');
    return decide(id, decision === 'approve' ? 'Approved' : decision === 'deny' ? 'Denied' : 'Revoked');
  },

  async adminGetAppState([token]) { await assertAdmin(token); return appState(); },
  async adminClearRecent([token]) { await assertAdmin(token); return setApp(s => { s.recentClearedAt = Date.now(); }); },
  async adminSetMaintenance([token, on, reason]) {
    const me = await assertAdmin(token);
    return setApp(s => { s.maintenance = on ? { on: true, reason: String(reason || '').trim().slice(0, 300), since: Date.now(), by: me.email } : { on: false, reason: '' }; });
  },
  async adminPublishAnnouncement([token, title, message, showFrom, sendPush]) {
    const me = await assertAdmin(token);
    message = String(message || '').trim().slice(0, 1000);
    if (!message) throw new Error('Please write the message first.');
    showFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(showFrom || '')) ? String(showFrom) : '';
    let s = await setApp(st => { st.announcement = { id: 'MSG-' + Date.now(), title: String(title || '').trim().slice(0, 80), message, showFrom, push: !!sendPush, pushed: false, createdAt: Date.now(), by: me.email }; });
    let pushed = false;
    if (sendPush && live(s.announcement)) {
      await pushAnnouncement(s);
      s = await setApp(st => { if (st.announcement) st.announcement.pushed = true; });
      pushed = true;
    }
    return { state: s, pushed };
  },
  async adminClearAnnouncement([token]) { await assertAdmin(token); return setApp(s => { s.announcement = null; }); }
};

/** People given Admin can't turn off or delete the SEKNA admin's own devices. */
async function guardOwner(me, id) {
  if (isAdminEmail(me.email)) return;
  const r = (await storeRows()).find(x => x.id === String(id || ''));
  if (r && isAdminEmail(r.email)) throw new Error('Only the SEKNA admin can change this.');
}

async function decide(id, status) {
  let row = null, before = '';
  await saveRows(list => {
    const r = list.find(x => x.id === id);
    if (!r) throw new Error('This request no longer exists.');
    before = r.status; r.status = status; r.decidedAt = Date.now(); row = r;
    return list;
  });
  if (status === 'Approved' && before !== 'Approved' && row.tokenHash) {
    await relayEmail({ to: row.email, replyTo: CFG.SENDER_EMAIL, subject: "You're verified, " + row.name + ' — SEKNA dashboard access is active',
      title: "You're verified, " + esc(row.name) + '!',
      html: P('Your identity has been confirmed and your access to the SEKNA dashboard is now active.') + P('Open the SEKNA app — or SEKNA on the web — to continue.'),
      button: { url: CFG.WEB_PAGE_URL, label: 'Open SEKNA' } }).catch(err => console.error('Approval email: ' + err.message));
  }
  return { status, name: row.name, email: row.email };
}

function details(r) {
  const p = parts(r.requestedAt);
  const line = (k, v) => '<tr><td style="padding:6px 12px 6px 0;color:#8a92a0;font-size:12px;white-space:nowrap">' + k +
    '</td><td style="padding:6px 0;color:#1d2433;font-size:13px;font-weight:700">' + esc(v) + '</td></tr>';
  return '<table style="border-collapse:collapse;margin:0 0 16px">' + line('Name', r.name) + line('Email', r.email) + line('Device', r.device) +
    line('Requested', `${+p.day} ${new Date(r.requestedAt).toLocaleDateString('en-GB', { month: 'short', timeZone: CFG.TZ })} ${p.year}, ${p.hour}:${p.minute}`) + '</table>';
}
async function adminRequestEmail(r, autoApproved) {
  const buttons = autoApproved ? [{ url: await reviewUrl(r.id, 'revoke'), label: 'Revoke this device' }]
    : [{ url: await reviewUrl(r.id, 'approve'), label: 'Approve', primary: true }, { url: await reviewUrl(r.id, 'deny'), label: 'Deny' }];
  await relayEmail({ to: CFG.ADMIN_EMAIL, replyTo: r.email, subject: (autoApproved ? 'New device: ' : 'Access request: ') + r.name + ' (' + r.email + ')',
    title: autoApproved ? 'New device signed in' : 'New access request',
    html: P(esc(r.name) + (autoApproved ? ' is already approved and confirmed their email on a new device, so it was approved automatically.' : ' confirmed their email and is asking for access to the SEKNA dashboard.')) + details(r),
    buttons, footer: 'Manage everyone from SEKNA → Admin → People.' });
}

/* ---------- the review page (opened from the admin email) ---------- */

async function reviewPage(q) {
  const id = String(q.id || ''), decision = String(q.decision || ''), sig = String(q.sig || '');
  let ok = false;
  try { ok = ['approve', 'deny', 'revoke'].indexOf(decision) >= 0 && sameSig(sig, await sign(id + '|' + decision)); } catch (e) {}
  const row = ok ? (await storeRows(true)).find(r => r.id === id) : null;
  const verb = decision === 'approve' ? 'Approve' : decision === 'deny' ? 'Deny' : 'Revoke';
  const body = !row ? '<h1>Link not valid</h1><p class="muted">This link is invalid or the request no longer exists.</p>'
    : '<p class="kicker">Access request</p><h1>' + verb + ' ' + esc(row.name) + '?</h1>' + details(row) +
      '<p class="muted">Current status: <b>' + esc(row.status) + '</b></p>' +
      '<button id="go" class="' + (decision === 'approve' ? 'primary' : 'danger') + '" onclick="decide()">' + verb + ' access</button><p id="msg" class="muted"></p>' +
      '<script>function decide(){var b=document.getElementById("go"),m=document.getElementById("msg");b.disabled=true;b.textContent="Saving…";' +
      'fetch(' + JSON.stringify(API_URL + '/call') + ',{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify({fn:"accessDecide",args:' + JSON.stringify([id, decision, sig]).replace(/</g, '\\u003c') + '})})' +
      '.then(function(r){return r.json()}).then(function(j){if(!j.ok)throw new Error(j.error||"Could not save");b.textContent="Done ✓";m.textContent=j.result.name+" is now "+j.result.status+".";})' +
      '.catch(function(e){b.disabled=false;b.textContent="Try again";m.textContent=e.message;});}</script>';
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SEKNA • Access request</title><style>' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;' +
    'background:linear-gradient(160deg,#2a4eb3,#203c8e 45%,#0f1f52);font-family:Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1d2433}' +
    '.card{width:min(420px,100%);background:#fff;border-radius:22px;padding:26px 24px;box-shadow:0 30px 80px rgba(6,14,40,.45)}' +
    '.brand{font-size:20px;font-weight:900;letter-spacing:1px;color:#203C8E}.brand:after{content:"";display:block;width:34px;height:3px;margin-top:6px;border-radius:2px;background:#C28D3E}' +
    '.kicker{margin:20px 0 0;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#8a92a0}' +
    'h1{margin:6px 0 14px;font-size:22px;letter-spacing:-.02em}.muted{font-size:13px;color:#636b7a}' +
    'button{width:100%;margin-top:8px;padding:14px;border:0;border-radius:13px;font-size:14px;font-weight:800;color:#fff;cursor:pointer}' +
    'button.primary{background:linear-gradient(180deg,#2b4db0,#203c8e)}button.danger{background:#c0392b}button:disabled{opacity:.75;cursor:default}' +
    '</style></head><body><div class="card"><div class="brand">SEKNA</div>' + body + '</div></body></html>';
}

/* ---------- the move (admin, once) ---------- */

async function adminAccessMove([token]) {
  const a = await assertAdmin(token);
  if (await accessMoved()) throw new Error('Sign-in already moved to the SEKNA server.');
  const props = await tasks.appsScript('accessExportProps', [token, false]);
  if (!props || !props.secret) throw new Error('Apps Script did not give the sign-in settings.');
  const tz = (await sheetMeta(ACCESS.SPREADSHEET_ID)).timeZone;
  const [values] = await batchGet(ACCESS.SPREADSHEET_ID, [a1(ACCESS.SHEET_NAME, 'A2:J')]);
  const rows = (values || []).filter(v => v && v[0] && v[2]).map(v => ({
    id: String(v[0]), name: String(v[1] || ''), email: norm(v[2]), status: String(v[3] || '').trim() || 'Pending', device: String(v[4] || ''),
    requestedAt: serialToMs(v[5], tz), decidedAt: serialToMs(v[6], tz), lastSeen: serialToMs(v[7], tz),
    tokenHash: String(v[8] || ''), deviceId: String(v[9] || '')
  }));
  const me = rows.find(r => r.status === 'Approved' && r.tokenHash === sha256(String(token)));
  if (!me) throw new Error('Your own device was not found in the sheet; nothing was moved.');
  await fsSet(DOC.secret, { value: props.secret });
  await fsSet(ACC.rows, { items: rows });
  await fsSet(ACC.seen, {});
  await fsSet(DOC.app, props.app || { maintenance: { on: false, reason: '' }, announcement: null });
  const counts = { rows: rows.length, approved: rows.filter(r => r.status === 'Approved').length, people: new Set(rows.map(r => r.email)).size };
  await fsSet(ACC.mode, { mode: 'firebase', at: Date.now(), by: a.email, counts });
  markMoved();
  forgetRows(rows);
  // From now on Apps Script refuses sign-in changes and sends old review links here.
  await tasks.appsScript('accessExportProps', [token, true]);
  return counts;
}

/** Router: before the move every call goes to Apps Script unchanged. */
async function call(fn, args) {
  if (fn === 'adminAccessMove') return adminAccessMove(args);
  if (fn === 'adminAccessMoveStatus') { await assertAdmin(args[0]); return (await fsGet(ACC.mode)) || { mode: 'appsscript' }; }
  if (!(await accessMoved())) return tasks.appsScript(fn, args);
  return A[fn](args);
}
const FNS = Object.keys(A).concat(['adminAccessMove', 'adminAccessMoveStatus']);

/** Maintenance: only admins get data while it is on (after the move). */
async function maintenanceBlocks(email) {
  if (!(await accessMoved()) || isAdminEmail(email)) return false;
  return !!(await appState()).maintenance.on;
}

module.exports = { accessMovedFlag: accessMoved, call, FNS, reviewPage, maintenanceBlocks, serialToMs, sheetDate, isoLocal };
