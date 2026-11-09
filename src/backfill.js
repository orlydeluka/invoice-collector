'use strict';

// ייבוא היסטוריה: קבצי ייצוא של ווטסאפ (zip / txt) או ייצוא SMS (csv / txt)
const { unzipSync } = require('fflate');
const { extractUrls, matchesKeywords } = require('./urls');

const BIDI = /[‎‏‪-‮⁦-⁩﻿]/g;

function decode(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return new TextDecoder('utf-8').decode(buf);
}

// מחזיר את כל קבצי הטקסט מתוך הקובץ שהועלה (כולל מתוך zip)
function filesToTexts(name, buf) {
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (!isZip) return [{ name, text: decode(buf) }];
  const entries = unzipSync(new Uint8Array(buf), {
    filter: (f) => /\.(txt|csv)$/i.test(f.name) && !f.name.startsWith('__MACOSX') && f.originalSize < 100e6,
  });
  return Object.entries(entries).map(([n, data]) => ({ name: n, text: decode(Buffer.from(data)) }));
}

// תאריך בתחילת שורה: 2024-01-31 / 31.1.2024 / 31/01/24 / [31.1.2024, 10:00:00]
const DATE_RE = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/;

function parseDate(s) {
  const m = s.match(DATE_RE);
  if (!m) return null;
  let y, mo, d;
  if (m[1]) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else {
    [d, mo, y] = [+m[4], +m[5], +m[6]];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // פורמט אמריקאי
    if (y < 100) y += 2000;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return new Date(Date.UTC(y, mo - 1, d));
}

// מפרק טקסט להודעות: שורה שמתחילה בתאריך פותחת הודעה חדשה, שורות אחריה הן המשך שלה
function splitMessages(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(BIDI, '');
    const head = line.slice(0, 40);
    const date = DATE_RE.test(head) ? parseDate(head) : null;
    if (date) {
      cur = { date, text: line };
      out.push(cur);
    } else if (cur) {
      cur.text += '\n' + line;
    }
  }
  return out;
}

/**
 * מחזיר רשימת לינקים לעיבוד: [{ url, date, text }]
 * from – תאריך התחלה (Date), keywordsOnly – רק הודעות עם מילות מפתח
 */
function collectLinks(texts, { from, keywords, keywordsOnly }) {
  const seen = new Set();
  const out = [];
  let messages = 0;
  for (const { text } of texts) {
    for (const msg of splitMessages(text)) {
      messages++;
      if (from && msg.date < from) continue;
      if (keywordsOnly && !matchesKeywords(msg.text, keywords)) continue;
      for (const url of extractUrls(msg.text)) {
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ url, date: msg.date, text: msg.text.trim() });
      }
    }
  }
  out.sort((a, b) => a.date - b.date);
  return { links: out, messages };
}

module.exports = { filesToTexts, splitMessages, collectLinks, parseDate };
