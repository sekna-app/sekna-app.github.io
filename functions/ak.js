// Alexandra on HEMERA's own server (v569): faster, and the answer comes word by word.
// The Alexandra Apps Script (HemeraApi.gs v26) still owns the bot: the team sheet, Teach the bot rules, access and
// the Gemini keys. This server asks it for those (action 'prep', cached a few minutes per person), asks Gemini
// itself with streaming, and reports each question back (action 'used') so Usage in Teach the bot stays right.
const { fsGet, fsUpdate } = require('./google');
const AK_URL = 'https://script.google.com/macros/s/AKfycbwDgKEmZ54-FxWfyCoYAE-u6HZBcFA7V0c0DpUToVfPfNpo0HMyrPueFgUBtXBH--e1/exec';
const DOC = 'server/alexandra', USE = 'server/ak-usage';

// How to answer about the numbers: kept here, so a change needs only a server deploy (not a new script version).
const HM_NUM_RULES = [
  'IMPORTANT: this section overrides any earlier instruction that says you only help with sheets and links, or that tells you to send people to a teammate for numbers. In HEMERA you DO have the numbers below and you answer from them.',
  'You are also a sharp media-buying analyst. The lines below are the live numbers from the HEMERA dashboard for the account the person has open (and the other account when it is loaded).',
  '- Answer any question about these numbers, even when it is worded loosely, has typos or mixes Arabic and English (ROAS = روز / روس). Work out what they mean.',
  '- Calculate what you need yourself: totals, averages, differences, % change, best and worst, ranks, pace to the end of the month (daily average so far x days in the month), spend per day needed to reach the plan (budget left / days left).',
  '- "This week" = the week in the weekly lines that holds the latest day. "Last week" = the week before it. "The same week last month" = the same day numbers in the previous month, from the days before this month. Compare only days that both periods have so far, and say so.',
  '- Follow-up questions build on the chat so far: "and last month?" means the same comparison for last month.',
  '- Use only these numbers. If something needed is not in them, say plainly that you do not have it. Never invent a number.',
  '- Reply in the language of the question (Egyptian Arabic when they write Arabic). Keep it short: one or two lines saying what the numbers mean, no tables, no long lists.',
  '- When the answer has numbers, end the message with a line [[CARDS]] and then a JSON list of 1 to 6 cards, nothing after it:',
  '  Write the tag exactly as [[CARDS]] alone on its own line (two square brackets on each side, nothing else on that line), then the JSON list on the next line. Never write [[CARDS], or put the list inside the tag.',
  '  [{"l":"ROAS · Sat 14 Nov","v":"2.84x","p":"107% of plan","d":"up","s":"Target 2.65x"}]',
  '  l = short English label with the period; v = the number formatted ($ for money in USD accounts, £ for GBP, x for ROAS, % for shares); p = optional short pill (vs plan or change, like "+12%"); d = "up" when good, "down" when bad, "" when neutral; s = optional short English line.',
  '  One card for a single figure. For a comparison, one card per metric with the change in p. For rankings, one card per item (best first).',
  '  In a comparison card, v is only the newer figure (like "$41,155"); the older one goes in s (like "vs $43,568 · Oct week 1"). Never write "X vs Y" in v.',
  '- Season and holiday names are always written in English, also in Arabic answers: Ramadan, Last 10 nights, Eid al-Fitr, Dhul Hijjah, Day of Arafah, Eid al-Adha, Ashura, Thanksgiving, Giving Tuesday, Tax season, Year-end. Never write them in Arabic letters.',
  '- Team questions (who is the CEO, who is the Team Leader, what is my rank, who is in the team) are answered from "The HEMERA team" list in the dashboard numbers. Use the role exactly as written there. Never say the person asking is the assistant.',
  '- Questions that are not about the numbers (sheets, links, team, days off) are answered as before, without cards.',
  '',
  'v24 · more data from HEMERA, and how to use it:',
  '- Money in the dashboard numbers is already in the account currency (HEMERA converted GBP with the day rate). Write it with that symbol and never convert again.',
  '- CAMPAIGNS: questions about a campaign, or "the best / worst campaign this month / in the last 7 days", are answered from the "Campaigns" lines (one line per campaign with yday, 7d, 30d, month and prev30). Rank campaigns, never campaign types, unless the person asks about types. Best = highest ROAS among campaigns that spent at least 5% of the total spend of that window; say this rule in a few words. Cards: the top 3 (or bottom 3), one card per campaign, l = short campaign name and the window, v = ROAS, s = spend and value.',
  '- TYPES OVER MONTHS AND YEARS: "PMax 2025 vs 2026", "PMax last year" and the like are answered from "Every month by campaign type". Compare the same months in both years (for the current year only the months it has so far) and say which months you compared. Add up spend, value and conv, then ROAS = value / spend. Never answer with the account total when a type was asked.',
  '- PACE, FORECAST, ACCURACY, "should we spend more or less": use only the numbers under "Worked out by HEMERA". Do not recount them. Give the answer in this order: 1) where the month ends at the current pace (spend, value, ROAS, plan accuracy), 2) what each day needs to reach the plan, 3) the advice, which must follow the HEMERA signal (SCALE / HOLD / PULL BACK) and say why with 2 or 3 numbers (ROAS vs target, value vs plan in the last 7 days). When advising a change, name the strongest and the weakest campaigns from the Campaigns lines (by 7d ROAS) so the person knows where to move money.',
  '- "Did anything drop / is anything wrong": answer from "Things that dropped". List the main ones first; say that Demand Gen and Video are lower priority because value is not their main goal. If the list says nothing dropped, say so.',
  '- SEARCH TERMS: questions about search terms or AI Max are answered from the "Search terms · AI Max snapshot" lines (the most wasted terms to add as negatives, the best terms to scale), with the report run date.',
  '- Every number you write must come from these lines or from a simple sum, difference or ratio of them. Show the sum when you calculate one.'
].join('\n');

let cfg = null, cfgAt = 0;
const last = { at: 0, step: '', ms: 0, chunks: 0 };
const preps = {};
async function conf() { if (cfg && Date.now() - cfgAt < 120000) return cfg; cfg = (await fsGet(DOC).catch(() => null)) || {}; cfgAt = Date.now(); return cfg; }
async function scriptPost(o) {
  const r = await fetch(AK_URL, { method: 'POST', body: JSON.stringify(o), redirect: 'follow' });
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { throw new Error('Alexandra script answered ' + r.status); }
}
/** Owner: a new secret for the link; the owner's HEMERA hands it to the script (action 'link'). */
async function link(email) {
  const secret = require('crypto').randomBytes(24).toString('base64url');
  await fsUpdate(DOC, d => Object.assign({}, d || {}, { secret, ok: false, linkedBy: email, at: Date.now() }));
  cfg = null; return { secret };
}
async function state() { const c = await conf(); return { linked: !!(c.secret && c.ok), waiting: !!(c.secret && !c.ok), at: c.okAt || null, last }; }
async function prep(email, name) {
  const k = email + '|' + name, c = preps[k];
  if (c && Date.now() - c.at < 240000) return c.v;
  const s = (await conf()).secret;
  if (!s) { const e = new Error('Alexandra is not linked to the server yet.'); e.fallback = true; throw e; }
  const v = await scriptPost({ action: 'prep', secret: s, email, name });
  if (!v || !v.ok) { if (v && v.badSecret) cfg = null; const e = new Error((v && v.error) || 'The Alexandra script did not answer.'); e.fallback = true; throw e; }
  if (!(await conf()).ok) { await fsUpdate(DOC, d => Object.assign({}, d || {}, { ok: true, okAt: Date.now() })); cfg = null; }
  preps[k] = { at: Date.now(), v };
  return v;
}
function month() { return new Date().toISOString().slice(0, 7); }
async function count(f) { const m = month(); await fsUpdate(USE, d => { d = d || {}; const o = d[m] = d[m] || { n: 0, limit: 0, err: 0 }; f(o); return d; }).catch(() => {}); }

/** POST /ak/ask {token, q, history, ctx, name}: streams the answer as plain text (JSON when it cannot). */
async function ask(req, res, b, who) {
  const email = String(who.email || '').toLowerCase(), name = String(b.name || who.name || '').trim().slice(0, 60);
  const q0 = String(b.q || '').trim().slice(0, 1500), t0 = Date.now();
  // v572 a photo from the chat (JPEG made smaller in the app), read by Gemini with the question
  const img = b.image && /^image\/(jpeg|png|webp)$/.test(String(b.image.mime || '')) && typeof b.image.data === 'string' && b.image.data.length < 4e6 && /^[A-Za-z0-9+/=]+$/.test(b.image.data.slice(0, 200)) ? b.image : null;
  Object.assign(last, { at: t0, step: 'start', ms: 0, chunks: 0 });
  if (!q0) { res.json({ ok: true, answer: '' }); return; }
  let p;
  try { p = await prep(email, name); } catch (e) { last.step = 'prep: ' + e.message; res.json({ ok: false, fallback: true, error: e.message }); return; }
  last.step = 'prep ok ' + (Date.now() - t0) + 'ms';
  if (p.blocked) { res.json({ ok: false, blocked: true, error: 'You do not have access to Alexandra.' }); return; }
  if (p.paused && !p.editor) { res.json({ ok: true, answer: 'Alexandra is stopped for now. Try again later.', api: 'srv' }); return; }
  const ctx = String(b.ctx || '').slice(0, 120000);
  let hist = (Array.isArray(b.history) ? b.history : []).slice(-6).filter(x => x && x.text && (x.role === 'user' || x.role === 'model'))
    .map(x => ({ role: x.role, parts: [{ text: String(x.text).slice(0, 4000) }] }));
  let q = q0;
  if (ctx) {
    hist = hist.filter(x => !(x.role === 'model' && /مش عندي|ليس لدي|don.t have/i.test(x.parts[0].text)));
    q += '\n\n[HEMERA: the live dashboard numbers are in your instructions under "Dashboard numbers". If this is about performance, answer from them and end with [[CARDS]] and the JSON cards. If the answer has no numbers, do not write [[CARDS]] at all.]';
  }
  const sys = (ctx ? '# HEMERA mode\n' + HM_NUM_RULES + '\n\n' : '') + p.base + (ctx ? '\n\n## Dashboard numbers (HEMERA)\n' + ctx : '') + '\n\n=== DATA ===\n' + (p.data || '');
  const payload = { system_instruction: { parts: [{ text: sys }] }, contents: hist.concat([{ role: 'user', parts: (img ? [{ inline_data: { mime_type: img.mime, data: img.data } }] : []).concat([{ text: q }]) }]),
    generationConfig: Object.assign({ temperature: 0.2, maxOutputTokens: 3000 }, p.think ? { thinkingConfig: p.think } : {}) };
  const url = String(p.url || '').replace(/:generateContent.*$/, ':streamGenerateContent?alt=sse');
  const keys = (p.keys || []).filter(Boolean);
  const used = (async () => { try { const s = (await conf()).secret; await scriptPost({ action: 'used', secret: s, email, name }); } catch (e) {} })();
  let r = null, ki = 0, tries = 0;
  while (ki < keys.length) {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[ki] }, body: JSON.stringify(payload) });
    if (r.status === 400 && payload.generationConfig.thinkingConfig && !tries++) { delete payload.generationConfig.thinkingConfig; continue; }
    if (r.status === 429) { ki++; continue; }
    // v574 Gemini busy (500/503): wait a little and try again, twice
    if (r.status >= 500 && tries < 3) { tries++; await new Promise(z => setTimeout(z, 900 * tries)); continue; }
    break;
  }
  if (!r || r.status === 429) { await count(o => { o.limit++; }); await used; res.json({ ok: true, answer: 'Too many messages right now. Try again in a minute.', api: 'srv' }); return; }
  if (!r.ok) { const t = await r.text().catch(() => ''); console.error('Alexandra Gemini ' + r.status + ': ' + t.slice(0, 300)); await count(o => { o.err++; }); await used; let why = ''; try { why = ((JSON.parse(t).error || {}).message || '').slice(0, 160); } catch (e) {} last.step = 'gemini ' + r.status + (img ? ' (photo)' : '') + ': ' + why; res.json({ ok: false, fallback: true, error: 'Gemini ' + r.status + (why ? ': ' + why : '') }); return; }
  res.status(200);
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('X-Accel-Buffering', 'no');
  res.set('X-Ak', 'stream');
  if (res.flushHeaders) res.flushHeaders();
  const dec = new TextDecoder();
  let buf = '', any = false;
  try {
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        try {
          const j = JSON.parse(line.slice(5));
          const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
          const t = parts.filter(x => !x.thought).map(x => x.text || '').join('');
          if (t) { any = true; last.chunks++; if (last.chunks === 1) last.first = Date.now() - t0; res.write(t); }
        } catch (e) {}
      }
    }
  } catch (e) { console.error('Alexandra stream: ' + e.message); }
  if (!any) res.write('I could not answer that. Try again.');
  await count(o => { o.n++; });
  await used;
  last.step = 'done'; last.ms = Date.now() - t0;
  res.end();
}

/** The month's usage mail to the owners: what the server cost (from Google's budget report) and Alexandra's questions. */
async function usageMail(tz, sendMail, owners, mailReady) {
  if (!mailReady()) return null;
  const now = new Date(), parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Asia/Muscat', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(now).forEach(x => { parts[x.type] = x.value; });
  const y = +parts.year, m = +parts.month, d = +parts.day, h = +parts.hour % 24, dim = new Date(Date.UTC(y, m, 0)).getUTCDate(), mk = y + '-' + String(m).padStart(2, '0');
  const st = (await fsGet('server/ak-mail').catch(() => null)) || {};
  const kind = !st.test ? 'test' : (d === dim && h >= 20 && st.month !== mk) ? 'month' : null;
  if (!kind) return null;
  await fsUpdate('server/ak-mail', s => Object.assign({}, s || {}, kind === 'test' ? { test: Date.now() } : { month: mk }));
  const bill = (await fsGet('server/billing').catch(() => null)) || {}, use = ((await fsGet(USE).catch(() => null)) || {})[mk] || { n: 0, limit: 0, err: 0 };
  const label = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const has = bill.month === mk, cost = has ? Number(bill.cost) || 0 : 0, cur = bill.currency || 'USD';
  const costLine = has ? (cost > 0 ? `<b style="color:#c63a4a">${cur} ${cost.toFixed(2)}</b> so far this month (the cap is ${cur} ${Number(bill.budget || 0).toFixed(2)}).` : `<b style="color:#13804f">Nothing charged</b>: still inside the free tier.`)
    : `<b style="color:#13804f">Nothing charged</b>: Google has not reported any cost for ${label}.`;
  const row = (a, b) => `<tr><td style="padding:8px 0;color:#6b7385;border-top:1px solid #eef1f7">${a}</td><td style="padding:8px 0;text-align:right;font-weight:800;color:#141b33;border-top:1px solid #eef1f7">${b}</td></tr>`;
  const html = `<p style="margin:0 0 12px">${kind === 'test' ? 'This is a test of the monthly usage email. The real one comes on the last day of each month.' : `Here is how much HEMERA used in ${label}.`}</p>
    <p style="margin:0 0 12px">Server cost: ${costLine}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font:14px Arial,sans-serif">
    ${row('Alexandra questions on the server', use.n.toLocaleString('en-US'))}${row('Voice chats with Alexandra', (use.voice || 0).toLocaleString('en-US'))}${row('Gemini busy (too many at once)', use.limit)}${row('Gemini errors', use.err)}${row('Gemini plan', 'Free tier · no charge')}</table>`;
  let sent = 0;
  for (const to of owners) { try { await sendMail({ to, subject: (kind === 'test' ? '[Test] ' : '') + 'HEMERA usage · ' + label, title: 'HEMERA usage · ' + label, html }); sent++; } catch (e) { console.error('Usage mail to ' + to + ': ' + e.message); } }
  return { kind, sent };
}


// v573 voice samples for the owner (Gemini text-to-speech, the same voices Gemini Live speaks with)
const VOICES = ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Despina', 'Sulafat'];
const SAMPLE = 'Say warmly and clearly: مرحباً، أنا ألكسندرا. صرف امبارح كان عشرة آلاف دولار، والعائد اتنين ونص. Hi, I am Alexandra, your media assistant. How can I help you today?';
const voiceCache = {};
async function voice(b, who) {
  const v = String(b.voice || '');
  if (b.pick) {
    if (!VOICES.includes(v)) return { ok: false, error: 'Unknown voice.' };
    await fsUpdate(DOC, d => Object.assign({}, d || {}, { voice: v, voiceBy: who.email, voiceAt: Date.now() })); cfg = null;
    return { ok: true, voice: v };
  }
  if (!v) return { ok: true, voices: VOICES, picked: (await conf()).voice || '' };
  if (!VOICES.includes(v)) return { ok: false, error: 'Unknown voice.' };
  if (voiceCache[v]) return voiceCache[v];
  const p = await prep(String(who.email || '').toLowerCase(), String(b.name || who.name || '').trim().slice(0, 60));
  const keys = (p.keys || []).filter(Boolean);
  const payload = { contents: [{ parts: [{ text: SAMPLE }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } } } };
  let r = null, j = null;
  for (let ki = 0; ki < keys.length; ki++) {
    r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[ki] }, body: JSON.stringify(payload) });
    if (r.status === 429) continue;
    break;
  }
  if (!r || !r.ok) return { ok: false, error: 'Gemini could not make the voice (' + (r ? r.status : 'no key') + ').' };
  j = await r.json();
  const part = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  const a = part.find(x => x.inlineData || x.inline_data);
  if (!a) return { ok: false, error: 'Gemini sent no audio.' };
  const d = a.inlineData || a.inline_data;
  const out = { ok: true, voice: v, mime: d.mimeType || d.mime_type || 'audio/L16;rate=24000', data: d.data };
  voiceCache[v] = out; return out;
}

// v575 voice chat (Gemini Live): a one-use token so the app talks to Gemini directly without ever seeing a key
let liveModel = '', liveModelAt = 0;
async function pickLiveModel(key) {
  if (liveModel && Date.now() - liveModelAt < 6 * 36e5) return liveModel;
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key } });
  const j = await r.json().catch(() => ({}));
  const live = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('bidiGenerateContent')).map(m => m.name);
  const score = n => (/native-audio/.test(n) ? 100 : /live/.test(n) ? 50 : 0) + (/flash/.test(n) ? 10 : 0) + (/latest/.test(n) ? 5 : 0) - (/thinking|lite|exp/.test(n) ? 3 : 0) + (parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0);
  live.sort((a, b) => score(b) - score(a) || b.localeCompare(a));
  liveModel = live[0] || 'models/gemini-2.5-flash-native-audio-preview-09-2025'; liveModelAt = Date.now();
  return liveModel;
}
const VOICE_RULES = `# Voice chat
You are talking out loud with the person, like a phone call. Speak naturally and warmly as Alexandra.
- Keep each answer short: one to three sentences, unless they ask for more.
- Never use markdown, lists, symbols, tables or [[CARDS]]. Say numbers the way people say them ("ten thousand four hundred dollars", "two point one").
- Answer in the language they speak. If they speak Arabic, answer in Egyptian Arabic.
- If you are not sure about a number, say so instead of guessing.`;
async function live(b, who) {
  const email = String(who.email || '').toLowerCase(), name = String(b.name || who.name || '').trim().slice(0, 60);
  const p = await prep(email, name);
  if (p.blocked) return { ok: false, blocked: true, error: 'You do not have access to Alexandra.' };
  if (p.paused && !p.editor) return { ok: false, error: 'Alexandra is stopped for now.' };
  const keys = (p.keys || []).filter(Boolean);
  if (!keys.length) return { ok: false, error: 'No Gemini key.' };
  const now = Date.now();
  let r = null, why = '', model = '';
  for (let ki = 0; ki < keys.length; ki++) {
    try { model = await pickLiveModel(keys[ki]); } catch (e) {}
    r = await fetch('https://generativelanguage.googleapis.com/v1alpha/auth_tokens', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[ki] },
      body: JSON.stringify({ uses: 1, expireTime: new Date(now + 30 * 60e3).toISOString(), newSessionExpireTime: new Date(now + 2 * 60e3).toISOString() }) });
    if (r.status === 429) continue;
    break;
  }
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok || !j.name) { why = ((j.error || {}).message || '').slice(0, 200); console.error('Alexandra live token ' + (r && r.status) + ': ' + why); return { ok: false, error: 'Gemini voice ' + (r ? r.status : '') + (why ? ': ' + why : '') }; }
  await count(o => { o.voice = (o.voice || 0) + 1; });
  const c = await conf();
  const ctx = String(b.ctx || '').slice(0, 90000);
  const sys = (VOICE_RULES + '\n\n' + p.base + (ctx ? '\n\n## Dashboard numbers (HEMERA)\n' + ctx : '') + '\n\n=== DATA ===\n' + (p.data || '')).slice(0, 300000);
  return { ok: true, token: j.name, model, voice: c.voice || 'Leda', sys };
}
module.exports = { ask, link, state, usageMail, voice, live };
