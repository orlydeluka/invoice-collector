'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { extractUrls, matchesKeywords } = require('./urls');
const { fetchInvoicePdf, closeBrowser } = require('./fetcher');
const { sendInvoice, sendFailure } = require('./mailer');

const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.API_TOKEN;
const KEYWORDS = (process.env.KEYWORDS ?? 'חשבונית,קבלה,invoice,receipt')
  .split(',').map((s) => s.trim()).filter(Boolean);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const SEEN_FILE = path.join(DATA_DIR, 'seen.json');
const SEEN_DAYS = 30;

if (!API_TOKEN) {
  console.error('חסר API_TOKEN במשתני הסביבה');
  process.exit(1);
}

// ---- זיכרון לינקים שכבר טופלו, כדי לא לשלוח את אותה חשבונית פעמיים ----
let seen = {};
try { seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); } catch { /* קובץ חדש */ }
const hash = (u) => crypto.createHash('sha256').update(u).digest('hex').slice(0, 32);
function wasSeen(url) {
  const t = seen[hash(url)];
  return t && Date.now() - t < SEEN_DAYS * 864e5;
}
function markSeen(url) {
  const cutoff = Date.now() - SEEN_DAYS * 864e5;
  for (const [k, t] of Object.entries(seen)) if (t < cutoff) delete seen[k];
  seen[hash(url)] = Date.now();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SEEN_FILE, JSON.stringify(seen));
  } catch (e) { console.warn('לא ניתן לשמור seen.json:', e.message); }
}

// ---- תור: חשבונית אחת בכל פעם, כדי לא להעמיס על השרת ----
let chain = Promise.resolve();
function enqueue(job) {
  const p = chain.then(job);
  chain = p.catch(() => {});
  return p;
}

async function processUrl(url, { sourceText, source }) {
  try {
    const pdf = await fetchInvoicePdf(url);
    await sendInvoice({ url, pdf, sourceText, source });
    markSeen(url);
    console.log(`נשלח: ${url} (${pdf.method}, ${pdf.buffer.length} bytes)`);
    return { url, ok: true, method: pdf.method, filename: pdf.filename };
  } catch (e) {
    console.error(`נכשל: ${url}:`, e.message);
    await sendFailure({ url, error: e.message, sourceText }).catch((err) => console.error('גם מייל השגיאה נכשל:', err.message));
    return { url, ok: false, error: e.message };
  }
}

// ---- שרת ----
const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.text({ type: 'text/*', limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

function authorized(req) {
  const header = req.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : (req.body && req.body.token) || req.query.token || '';
  const a = Buffer.from(String(given));
  const b = Buffer.from(API_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

/**
 * POST /api/invoice
 * גוף: { text: "תוכן ההודעה או לינק", source: "sms" | "whatsapp" | "manual", force?: bool, wait?: bool }
 * אפשר גם לשלוח טקסט רגיל (text/plain).
 */
app.post('/api/invoice', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'טוקן שגוי' });

  const body = typeof req.body === 'string' ? { text: req.body } : req.body || {};
  const text = [body.text, body.url, body.message].filter(Boolean).join('\n');
  const source = String(body.source || req.query.source || 'manual');
  const force = body.force === true || body.force === 'true' || req.query.force === '1';
  const wait = body.wait === true || body.wait === 'true' || req.query.wait === '1';

  // הודעות SMS שמגיעות אוטומטית מסוננות לפי מילות מפתח; שיתוף ידני תמיד מטופל
  if (source === 'sms' && !matchesKeywords(text, KEYWORDS)) {
    return res.json({ queued: 0, skipped: 'no-keyword' });
  }

  const urls = extractUrls(text);
  if (urls.length === 0) return res.status(400).json({ error: 'לא נמצא לינק בהודעה' });

  const todo = force ? urls : urls.filter((u) => !wasSeen(u));
  const duplicates = urls.filter((u) => !todo.includes(u));
  const jobs = todo.map((u) => enqueue(() => processUrl(u, { sourceText: body.text || '', source })));

  if (wait) {
    const results = await Promise.all(jobs);
    return res.json({ results, duplicates });
  }
  res.status(202).json({ queued: todo.length, urls: todo, duplicates });
});

const server = app.listen(PORT, () => console.log(`invoice-collector מאזין על פורט ${PORT}`));

async function shutdown() {
  server.close();
  await chain;
  await closeBrowser();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
