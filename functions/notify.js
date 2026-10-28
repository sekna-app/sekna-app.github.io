// Emails and notifications from the HEMERA server.
// Emails: Gmail (seknaapp@gmail.com) with an App Password kept in Google Secret Manager.
// Notifications: Firebase Cloud Messaging with this server's own Google identity.
// Whatever cannot go out directly yet (no password, no permission) goes through Apps Script.
const crypto = require('crypto');
const { defineSecret } = require('firebase-functions/params');
const { request, PROJECT_ID, fsUpdate, fsGet } = require('./google');

// The deploy workflow writes mail-on.txt only when the password exists, so the server can be deployed
// without it (declaring a secret makes the deploy look for it in Google Secret Manager). A file and not an
// environment variable, because the deploy reads the code without the workflow's variables.
const MAIL_ON_DEPLOY = require('fs').existsSync(require('path').join(__dirname, 'mail-on.txt'));
const GMAIL_PASSWORD = MAIL_ON_DEPLOY ? defineSecret('GMAIL_APP_PASSWORD') : null;
const SENDER = { email: 'seknaapp@gmail.com', name: 'HEMERA' };
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzjgZ1nXxLTcFdeFCIEznOj2H0XCo9YGUeu1YF2pJdsQiOo_aM-Mn6HxKKNk8peEuM1Ig/exec';
const MEDIA_TOPIC = 'media-plan-updates';

const norm = e => String(e || '').trim().toLowerCase();
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
const userTopic = email => 'sekna-u-' + crypto.createHash('sha256').update(norm(email), 'utf8').digest('hex').slice(0, 24);

/* ---------- the HEMERA email design (as in Code.gs) ---------- */

function emailHtml(title, bodyHtml) {
  return '<div style="background:#f4f6fb;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#1d2433">' +
    '<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6eaf4">' +
    '<div style="background:#203C8E;padding:20px 24px;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:1px">HEMERA' +
    '<div style="height:3px;width:38px;background:#C28D3E;margin-top:8px;border-radius:2px"></div></div>' +
    '<div style="padding:24px"><h2 style="margin:0 0 12px;font-size:19px;color:#1d2433">' + title + '</h2>' + bodyHtml + '</div>' +
    '<div style="padding:14px 24px;background:#f8f9fc;color:#8a92a0;font-size:11px">HEMERA • Day by day.</div></div></div>';
}
function button(href, label, primary) {
  return '<a href="' + esc(href) + '" style="display:inline-block;padding:12px 22px;margin:4px 8px 0 0;border-radius:10px;' +
    'text-decoration:none;font-weight:700;font-size:14px;' + (primary ? 'background:#203C8E;color:#ffffff' : 'background:#eef1f7;color:#1d2433') + '">' + esc(label) + '</a>';
}
function render(m) {
  return emailHtml(String(m.title || ''), String(m.html || '') +
    (m.button && m.button.url ? button(m.button.url, m.button.label || 'Open HEMERA', true) : '') +
    (Array.isArray(m.buttons) ? m.buttons.slice(0, 3).map(b => button(b.url, b.label || 'Open', !!b.primary)).join('') : '') +
    (m.footer ? '<p style="margin:18px 0 0;font-size:12px;color:#8a92a0">' + esc(m.footer) + '</p>' : ''));
}

/* ---------- Gmail ---------- */

let transport = null;
// Firebase hands a bound secret to the function as an environment variable of the same name.
function mailPassword() { return String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''); }
function mailReady() { return mailPassword().length >= 16; }
function mailer() {
  if (!transport) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: SENDER.email, pass: mailPassword() } });
  }
  return transport;
}
/** One email: { to, subject, title, html, button, buttons, footer, replyTo, attachments:[{filename, content(Buffer), contentType}] } */
async function sendMail(m) {
  await mailer().sendMail({ from: { name: SENDER.name, address: SENDER.email }, to: norm(m.to), replyTo: m.replyTo ? norm(m.replyTo) : undefined,
    subject: String(m.subject || 'HEMERA').slice(0, 200), html: m.rawHtml || render(m), text: 'Open this email in an app that shows HTML.',
    attachments: m.attachments || undefined });
}

/* ---------- Firebase Cloud Messaging ---------- */

let fcmDeniedUntil = 0;
async function fcm(message, validateOnly) {
  if (!validateOnly && Date.now() < fcmDeniedUntil) { const e = new Error('no permission'); e.denied = true; throw e; }
  try {
    return await request(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, { method: 'POST', data: validateOnly ? { message, validate_only: true } : { message } });
  } catch (err) {
    const st = err && err.response && err.response.status;
    if (st === 401 || st === 403) { fcmDeniedUntil = Date.now() + 10 * 60 * 1000; err.denied = true; }
    throw err;
  }
}
const highPriority = { android: { priority: 'HIGH', ttl: '86400s' }, webpush: { headers: { Urgency: 'high', TTL: '86400' } } };
/** Data-only message to one person's own topic (their phones and browsers). */
function userMessage(p) {
  return Object.assign({ topic: userTopic(p.email), data: { title: String(p.title || 'HEMERA'), body: String(p.body || ''), eventType: String(p.eventType || 'tasks') } }, highPriority);
}
/** Data-only message to everyone (the media plan topic), as sendFcmTopicMessage_ in Code.gs. */
function topicMessage(t) {
  const s = t.snapshot || {};
  return Object.assign({ topic: MEDIA_TOPIC, data: {
    title: String(t.title || 'Media Plan'), body: String(t.body || 'Media Plan data was updated.'),
    accountKey: String(t.account || s.accountKey || 'usa'), eventType: String(t.eventType || 'updated'),
    date: String(s.date || ''), dayNumber: String(s.dayNumber || 0), monthName: String(s.monthName || ''),
    spend: String(s.spend || 0), conversions: String(s.conversions || 0), value: String(s.value || 0)
  } }, highPriority);
}

/* ---------- Apps Script (until it is retired) ---------- */

async function appsScript(fn, args) {
  const res = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'call', fn, args }), redirect: 'follow' });
  const j = await res.json();
  if (!j || !j.ok) throw new Error((j && j.error) || 'Apps Script did not answer.');
  return j.result;
}
async function identityToken() {
  const r = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=sekna-relay&format=full',
    { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error('No server identity (' + r.status + ')');
  return r.text();
}

/* ---------- the notifications list in the app (what was sent, newest first) ---------- */
// Team notifications go to one list, a person's own ones (tasks, backup) to theirs.
const INBOX_TEAM = 'inbox/team';
const inboxOf = email => 'inbox/' + userTopic(email);
const INBOX_KEEP = 60, INBOX_DAYS = 60;
async function inboxAdd(path, entries) {
  if (!entries.length) return;
  const cutoff = Date.now() - INBOX_DAYS * 864e5;
  await fsUpdate(path, doc => {
    const list = ((doc && doc.items) || []).filter(x => x.at > cutoff);
    return { items: entries.concat(list).slice(0, INBOX_KEEP) };
  });
}
function inboxEntry(x, type, account) {
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: Date.now(), title: String(x.title || 'HEMERA').slice(0, 90),
    body: String(x.body || '').slice(0, 240), type: String(type || 'updated'), account: account || '' };
}
async function inboxRecord(payload) {
  const team = (payload.topics || []).map(t => inboxEntry(t, t.eventType, t.account || (t.snapshot && t.snapshot.accountKey) || ''));
  const mine = {};
  (payload.pushes || []).forEach(p => { const e = norm(p.email); if (e) (mine[e] = mine[e] || []).push(inboxEntry(p, p.eventType || 'tasks', '')); });
  try { await inboxAdd(INBOX_TEAM, team); } catch (e) { console.warn('Inbox: ' + e.message); }
  for (const e of Object.keys(mine)) { try { await inboxAdd(inboxOf(e), mine[e]); } catch (err) { console.warn('Inbox: ' + err.message); } }
}
/** The team's notifications and this person's own, newest first. */
async function inboxFor(email) {
  const [team, mine] = await Promise.all([fsGet(INBOX_TEAM), fsGet(inboxOf(email))]);
  return ((team && team.items) || []).concat((mine && mine.items) || []).sort((a, b) => b.at - a.at).slice(0, INBOX_KEEP);
}

/**
 * Sends { emails, pushes, topics, appState }. Each part goes out directly when it can,
 * the rest through Apps Script (relaySend). Returns what was sent each way.
 */
async function send(payload) {
  payload = payload || {};
  await inboxRecord(payload);
  const left = { emails: [], pushes: [], topics: [] };
  const out = { emails: 0, pushes: 0, topics: 0, relayed: 0 };
  if (mailReady()) {
    for (const m of payload.emails || []) {
      try { await sendMail(m); out.emails++; } catch (e) { console.error('Mail to ' + m.to + ': ' + e.message); left.emails.push(m); }
    }
  } else left.emails = (payload.emails || []).slice();
  for (const p of payload.pushes || []) {
    try { await fcm(userMessage(p)); out.pushes++; } catch (e) { if (!e.denied) console.error('Push: ' + e.message); left.pushes.push(p); }
  }
  for (const t of payload.topics || []) {
    try { await fcm(topicMessage(t)); out.topics++; } catch (e) { if (!e.denied) console.error('Topic push: ' + e.message); left.topics.push(t); }
  }
  const relayBody = {};
  if (left.emails.length) relayBody.emails = left.emails.map(m => Object.assign({}, m, { attachments: undefined }));
  if (left.pushes.length) relayBody.pushes = left.pushes;
  if (left.topics.length) relayBody.topics = left.topics;
  if (payload.appState) relayBody.appState = payload.appState;
  if (payload.pushMoved) relayBody.pushMoved = true;
  if (Object.keys(relayBody).length) {
    const r = await appsScript('relaySend', [await identityToken(), relayBody]);
    out.relayed = (r && (r.emails || 0) + (r.pushes || 0) + (r.topics || 0)) || 0;
  }
  return out;
}

/** Adds or removes a browser's notification token to the team topic and the person's own topic. */
async function subscribeTopics(pushToken, email, on) {
  const op = on === false ? 'batchRemove' : 'batchAdd';
  for (const topic of [MEDIA_TOPIC, userTopic(email)]) {
    const r = await request(`https://iid.googleapis.com/iid/v1:${op}`, { method: 'POST',
      data: { to: '/topics/' + topic, registration_tokens: [pushToken] }, headers: { access_token_auth: 'true' } });
    const res = ((r && r.results) || [])[0] || {};
    if (res.error && topic === MEDIA_TOPIC) throw new Error('Could not update notifications: ' + res.error);
  }
}

/** What the admin's Server page shows: can the server email and notify by itself yet? */
async function capability() {
  let push = 'unknown';
  try { await fcm(Object.assign({}, userMessage({ email: 'check@sekna', title: 'check' })), true); push = 'ok'; } catch (e) { push = e.denied ? 'no permission' : 'error'; }
  return { mail: mailReady() ? 'Gmail' : 'Apps Script', push: push === 'ok' ? 'Firebase' : 'Apps Script (' + push + ')' };
}

module.exports = { GMAIL_PASSWORD, MAIL_ON_DEPLOY, send, sendMail, mailReady, render, emailHtml, button, esc, userTopic, subscribeTopics,
  appsScript, identityToken, fcm, topicMessage, MEDIA_TOPIC, inboxFor };
