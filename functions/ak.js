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
  let q = q0 + '\n\n[HEMERA: this is the written chat. Answer here in writing; never ask the person to call you or move to a voice call. Spell every word correctly: keep the Egyptian dialect, but write it with clean, correct spelling (e.g. إزيك، عايز، دلوقتي، كده، النهارده، إمبارح) and correct hamza (أ إ آ), ة/ه and ى/ي. Re-read your answer for typos before you finish.]';
  if (ctx) {
    hist = hist.filter(x => !(x.role === 'model' && /مش عندي|ليس لدي|don.t have/i.test(x.parts[0].text)));
    q += '\n\n[HEMERA: the live dashboard numbers are in your instructions under "Dashboard numbers". If this is about performance, answer from them and end with [[CARDS]] and the JSON cards. If the answer has no numbers, do not write [[CARDS]] at all.]';
  }
  const mem = await memGet(email);
  const sys = (ctx ? '# HEMERA mode\n' + HM_NUM_RULES + '\n\n' : '') + p.base + '\n\n' + SMART_RULES + memText(mem) + (ctx ? '\n\n## Dashboard numbers (HEMERA)\n' + ctx : '') + '\n\n=== DATA ===\n' + (p.data || '');
  const deep = DEEP_RE.test(q0) || q0.length > 220;
  const payload = { tools: Date.now() < searchOffUntil ? undefined : [{ google_search: {} }, { url_context: {} }], system_instruction: { parts: [{ text: sys }] }, contents: hist.concat([{ role: 'user', parts: (img ? [{ inline_data: { mime_type: img.mime, data: img.data } }] : []).concat([{ text: q }]) }]),
    // v604 faster written answers: a short think for short questions, a capped one otherwise (the photo keeps the script's setting)
    generationConfig: Object.assign({ temperature: 0.2, maxOutputTokens: 3000 }, p.think ? { thinkingConfig: img ? p.think : Object.assign({}, p.think, { thinkingBudget: deep ? 4096 : Math.min(Number(p.think.thinkingBudget) > 0 ? Number(p.think.thinkingBudget) : 1024, q0.length < 140 ? 256 : 768) }) } : { thinkingConfig: { thinkingBudget: deep ? 4096 : q0.length < 140 ? 256 : 768 } }) };
  const url = String(p.url || '').replace(/:generateContent.*$/, ':streamGenerateContent?alt=sse');
  const keys = (p.keys || []).filter(Boolean);
  const used = (async () => { try { const s = (await conf()).secret; await scriptPost({ action: 'used', secret: s, email, name }); } catch (e) {} })();
  let r = null, ki = 0, tries = 0;
  while (ki < keys.length) {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[ki] }, body: JSON.stringify(payload) });
    if (r.status === 400 && payload.tools) { delete payload.tools; continue; }
    if (r.status === 400 && payload.generationConfig.thinkingConfig && !tries++) { delete payload.generationConfig.thinkingConfig; continue; }
    if (r.status === 429 && payload.tools && ki + 1 >= keys.length) { delete payload.tools; searchOffUntil = Date.now() + 15 * 60e3; ki = 0; continue; }
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
  let buf = '', any = false, full = '';const srcs = new Map();
  try {
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        try {
          const j = JSON.parse(line.slice(5));
          const cand = (j.candidates || [])[0] || {}, parts = (cand.content || {}).parts || [];
          const t = parts.filter(x => !x.thought).map(x => x.text || '').join('');
          ((cand.groundingMetadata || {}).groundingChunks || []).forEach(g => { const w = g.web || {}; if (w.uri && srcs.size < 6) srcs.set(w.uri, String(w.title || w.domain || '').slice(0, 80)); });
          if (t) { any = true; full += t; last.chunks++; if (last.chunks === 1) last.first = Date.now() - t0; res.write(t); }
        } catch (e) {}
      }
    }
  } catch (e) { console.error('Alexandra stream: ' + e.message); }
  if (!any) res.write('I could not answer that. Try again.');
  if (srcs.size) res.write('\n[[SOURCES]] ' + JSON.stringify([...srcs].map(([u, t]) => ({ u, t }))));
  try { await memLearn(email, full); } catch (e) {}
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
- Never use markdown, lists, symbols, emojis, tables or [[CARDS]]. Say numbers the way people say them ("ten thousand four hundred dollars", "two point one").
- Give one or two key numbers per answer, not a long list of them.
- Answer in the language they speak. If they speak Arabic, never use Modern Standard Arabic (فصحى): speak like a warm girl from Alexandria (اسكندرانية), in Egyptian Arabic with an Alexandrian touch:
  - "I" verbs start with ن like Alexandrians do: "نشوفلك" (I'll check for you), "نقولك" (I'll tell you), "نبعتلك".
  - Use these Alexandrian/Egyptian expressions naturally, one now and then, never in every sentence: "صباح الفل" (good morning), "من عيوني يا سيدي" (agreeing), "عاش يا معلم" (a task is done), "استنى هنا يا نجم" (you found a problem), "إيه الحلاوة دي؟" (a great result), "حاضر يا ريس، ولا يهمك" (an urgent ask), "لأ كده إحنا عندنا كلام تاني" (you found a mistake), "يا سيدي", "يا معلم", "يا لهوي".
  - Keep it light and friendly, never exaggerated.
- If you are not sure about a number, say so instead of guessing.
- For anything outside HEMERA (news, dates of holidays, platform changes, market facts) never answer from memory: call the search_web tool and say only what it returns; if it finds nothing, say you could not find it.`;
async function live(b, who) {
  const email = String(who.email || '').toLowerCase(), name = String(b.name || who.name || '').trim().slice(0, 60);
  const p = await prep(email, name);
  if (p.blocked) return { ok: false, blocked: true, error: 'You do not have access to Alexandra.' };
  if (p.paused && !p.editor) return { ok: false, error: 'Alexandra is stopped for now.' };
  const keys = (p.keys || []).filter(Boolean);
  if (!keys.length) return { ok: false, error: 'No Gemini key.' };
  // v578 warm-up when the chat opens: the script's data and the model are ready before the voice chat starts
  if (b.warm) { try { await pickLiveModel(keys[0]); } catch (e) {} return { ok: true, warm: true }; }
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
  const ctx = String(b.ctx || '').slice(0, 40000);
  const vmem = memText(await memGet(email));
  const sys = (VOICE_RULES + vmem + '\n\n' + p.base + (ctx ? '\n\n## Dashboard numbers (HEMERA)\n' + ctx : '') + '\n\n=== DATA ===\n' + (p.data || '')).slice(0, 160000);
  return { ok: true, token: j.name, model, voice: c.voice || 'Leda', sys };
}

// v583 a chat answer read aloud in her voice (the speaker under each of her messages)
const ttsCache = new Map();
async function tts(b, who) {
  const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 1800);
  if (!text) return { ok: false, error: 'Nothing to read.' };
  const c = await conf(), v = c.voice || 'Leda', k = v + '|' + (b.style || '') + '|' + text;
  if (ttsCache.has(k)) return ttsCache.get(k);
  const p = await prep(String(who.email || '').toLowerCase(), String(b.name || who.name || '').trim().slice(0, 60));
  if (p.blocked) return { ok: false, blocked: true, error: 'You do not have access to Alexandra.' };
  const keys = (p.keys || []).filter(Boolean);
  const arab = /[؀-ۿ]/.test(text);
  const style = b.style && who.owner ? String(b.style).slice(0, 200) + ': ' : '';
  const payload = { contents: [{ parts: [{ text: (style || (arab ? 'Read this aloud naturally and warmly, like a friendly girl from Alexandria, in Egyptian Arabic: ' : 'Read this aloud naturally and warmly: ')) + text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } } } };
  let r = null;
  for (let ki = 0; ki < keys.length; ki++) {
    r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[ki] }, body: JSON.stringify(payload) });
    if (r.status === 429) continue;
    break;
  }
  if (!r || !r.ok) { const t = r ? await r.text().catch(() => '') : ''; let why = ''; try { why = ((JSON.parse(t).error || {}).message || '').slice(0, 160); } catch (e) {} return { ok: false, error: 'Gemini voice ' + (r ? r.status : '') + (why ? ': ' + why : '') }; }
  const j = await r.json();
  const a = ((((j.candidates || [])[0] || {}).content || {}).parts || []).find(x => x.inlineData || x.inline_data);
  if (!a) return { ok: false, error: 'Gemini sent no audio.' };
  const d = a.inlineData || a.inline_data;
  const out = { ok: true, mime: d.mimeType || d.mime_type || 'audio/L16;rate=24000', data: d.data };
  await count(o => { o.tts = (o.tts || 0) + 1; });
  if (ttsCache.size > 60) ttsCache.delete(ttsCache.keys().next().value);
  ttsCache.set(k, out); return out;
}

// v600 the notification sound in her voice: the owner picks one in the chat, every phone app downloads it
const NOTIF = 'server/ak-notif';
async function notifSet(b, who) {
  const data = String(b.data || ''), mime = String(b.mime || 'audio/wav');
  if (!/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 200)) || data.length > 700000) return { ok: false, error: 'The sound is too big or not valid.' };
  const ver = Date.now();
  await fsUpdate(NOTIF, () => ({ data, mime, ver, by: who.email, text: String(b.text || '').slice(0, 120) }));
  return { ok: true, ver };
}
async function notifGet(onlyVer) { const d = (await fsGet(NOTIF).catch(() => null)) || {}; if (!d.data) return { ok: true, ver: 0 }; return onlyVer ? { ok: true, ver: d.ver } : { ok: true, ver: d.ver, mime: d.mime, data: d.data }; }

// v608 smarter Alexandra: Google Search and links for things outside HEMERA, a memory per person, deeper thinking for analysis
const DEEP_RE = /ليه|ليش|لماذا|حلل|حلّل|تحليل|اقترح|اقتراح|خطة|استراتيج|قارن|مقارنة|توقع|توقّع|ازاي نحسن|إزاي نحسن|why|analy[sz]e|suggest|recommend|strategy|compare|forecast|plan for|what should/i;
const SMART_RULES = `# Thinking and sources
- Think beyond the app when it helps: you may use Google Search (and read links the person sends) for things outside HEMERA, like news, holidays and seasons, donor behaviour, ad platform changes, industry benchmarks or best practice. Say briefly where it comes from.
- HEMERA numbers (spend, value, ROAS, campaigns, plans) come ONLY from the dashboard data you were given, never from the web. Never guess or round a number differently from the data; if a number is not in the data, say so.
- Before you answer, check your numbers against the data once more.
# Memory
- Under "What you remember" are facts this person told you before. Use them.
- If the person tells you something worth remembering for later (a preference, a decision, a target, a fact about the team, the accounts or the campaigns), add one last line: [[REMEMBER]] <the fact in one short sentence>. Only for things that matter later; never for passing questions.
- If they ask you to forget something, add one last line: [[FORGET]] <a few words of what to forget>.`;
const MEM = 'server/ak-mem';
let memCache = null, memAt = 0;
async function memAll() { if (memCache && Date.now() - memAt < 60000) return memCache; memCache = (await fsGet(MEM).catch(() => null)) || {}; memAt = Date.now(); return memCache; }
async function memGet(email) { try { const a = (await memAll())[email.replace(/\./g, ',')]; return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function memText(m) { return m.length ? '\n\n## What you remember about this person (from past chats)\n' + m.slice(-40).map(x => '- ' + x.t + (x.at ? ' (' + new Date(x.at).toISOString().slice(0, 10) + ')' : '')).join('\n') : ''; }
async function memLearn(email, text) {
  const add = [...String(text).matchAll(/\[\[REMEMBER\]\]\s*([^\n\[]{3,240})/g)].map(m => m[1].trim());
  const del = [...String(text).matchAll(/\[\[FORGET\]\]\s*([^\n\[]{2,120})/g)].map(m => m[1].trim().toLowerCase());
  if (!add.length && !del.length) return;
  const k = email.replace(/\./g, ',');
  await fsUpdate(MEM, d => { d = d || {}; let a = Array.isArray(d[k]) ? d[k] : [];
    if (del.length) a = a.filter(x => !del.some(w => w.split(/\s+/).filter(z => z.length > 2).every(z => x.t.toLowerCase().includes(z))));
    add.forEach(t => { if (!a.some(x => x.t === t)) a.push({ t, at: Date.now() }); });
    d[k] = a.slice(-60); return d; });
  memCache = null;
}

// v609 a search the voice call can ask for: Gemini with Google Search answers in a few lines with its sources (no guessing)
let searchOffUntil = 0;
async function search(b, who) {
  const q = String(b.q || '').trim().slice(0, 400);
  if (!q) return { ok: false, error: 'No question.' };
  if (Date.now() < searchOffUntil) return { ok: false, error: 'Google search is resting for a few minutes (daily limit).' };
  const p = await prep(String(who.email || '').toLowerCase(), String(b.name || who.name || '').trim().slice(0, 60));
  if (p.blocked) return { ok: false, error: 'No access.' };
  const keys = (p.keys || []).filter(Boolean), url = String(p.url || '').replace(/:streamGenerateContent.*$/, ':generateContent').replace(/\?alt=sse$/, '');
  const payload = { tools: [{ google_search: {} }], contents: [{ role: 'user', parts: [{ text: 'Search Google and answer in 2 or 3 short sentences, only facts you found, with dates where it matters. If you find nothing reliable, say so. Question: ' + q }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 600 } };
  let r = null;
  for (let ki = 0; ki < keys.length; ki++) { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[ki] }, body: JSON.stringify(payload) }); if (r.status !== 429) break; }
  if (!r || r.status === 429) { searchOffUntil = Date.now() + 15 * 60e3; return { ok: false, error: 'Google search is resting for a few minutes (daily limit).' }; }
  if (!r.ok) return { ok: false, error: 'Search failed (' + r.status + ').' };
  const j = await r.json(), c = (j.candidates || [])[0] || {};
  const answer = ((c.content || {}).parts || []).filter(x => !x.thought).map(x => x.text || '').join('').trim();
  const sources = []; ((c.groundingMetadata || {}).groundingChunks || []).forEach(g => { const w = g.web || {}; if (w.uri && sources.length < 5) sources.push({ u: w.uri, t: String(w.title || '').slice(0, 80) }); });
  await count(o => { o.search = (o.search || 0) + 1; });
  return { ok: true, answer: answer || 'Nothing reliable found.', sources };
}
// Alexandra writes a short note for the budget picture or the monthly report: what she looked at, the numbers she used, and 3 choices.
async function note(b, who) {
  const kind = b.kind === 'month' ? 'month' : 'budget', facts = String(b.facts || '').trim().slice(0, 7000);
  if (!facts) return { ok: false, error: 'No numbers to read.' };
  const p = await prep(String(who.email || '').toLowerCase(), String(b.name || who.name || '').trim().slice(0, 60));
  if (p.blocked) return { ok: false, error: 'No access.' };
  const keys = (p.keys || []).filter(Boolean), url = String(p.url || '').replace(/:streamGenerateContent.*$/, ':generateContent').replace(/\?alt=sse$/, '');
  const max = kind === 'month' ? 220 : 150;
  const what = kind === 'month' ? "the note that goes on the notes page of this month's PDF report for the team and managers" : "the one-line note printed under the title of this month's budget picture, sent to the manager on WhatsApp";
  const prompt = `You are Alexandra, the media analyst of the Human Appeal digital team. Write ${what}.
Use ONLY the numbers below. Never invent a number, a campaign or a reason. Plain, warm, professional English, short sentences, no emoji, no hashtags.
Return JSON only:
{"think":"2 or 3 short sentences in the first person: what you looked at and what stood out",
 "seen":["up to 6 very short chips with the key numbers you used, e.g. \"$48.2k budget\", \"+18% vs Nov\", \"4.2x ROAS\""],
 "options":[{"tag":"SHORT","text":"..."},{"tag":"FOR THE MANAGER","text":"..."},{"tag":"<2-word angle in capitals>","text":"..."}]}
Each option text at most ${max} characters, one or two sentences, different angles, written so a manager understands it at a glance.
${b.more ? 'Give 3 new options, different from: ' + String(b.more).slice(0, 600) : ''}

NUMBERS:
${facts}`;
  const payload = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: b.more ? 0.9 : 0.5, maxOutputTokens: 1400, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 512 } } };
  let r = null;
  for (let ki = 0; ki < keys.length; ki++) { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[ki] }, body: JSON.stringify(payload) }); if (r.status !== 429) break; }
  if (!r) return { ok: false, error: 'Alexandra is not set up yet.' };
  if (r.status === 429) return { ok: false, error: 'Too many requests right now. Try again in a minute.' };
  if (!r.ok) return { ok: false, error: 'Alexandra could not answer (' + r.status + ').' };
  const j = await r.json(), c = (j.candidates || [])[0] || {};
  const txt = ((c.content || {}).parts || []).filter(x => !x.thought).map(x => x.text || '').join('').trim();
  let o = null; try { o = JSON.parse(txt.replace(/^```(?:json)?|```$/g, '').trim()); } catch (e) { const m = txt.match(/\{[\s\S]*\}/); try { o = m && JSON.parse(m[0]); } catch (e2) {} }
  if (!o || !Array.isArray(o.options) || !o.options.length) return { ok: false, error: 'Alexandra could not write the note. Try again.' };
  await count(x => { x.note = (x.note || 0) + 1; });
  return { ok: true, think: String(o.think || '').slice(0, 400), seen: (Array.isArray(o.seen) ? o.seen : []).slice(0, 6).map(x => String(x).slice(0, 30)),
    options: o.options.slice(0, 3).map(x => ({ tag: String(x.tag || '').toUpperCase().slice(0, 24), text: String(x.text || '').trim().slice(0, max + 20) })).filter(x => x.text) };
}
module.exports = { note, search, memGet, memText, ask, link, state, usageMail, voice, live, tts, notifSet, notifGet };
