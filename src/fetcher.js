'use strict';

const { chromium } = require('playwright');
const urls = require('./urls');
// דרך האובייקט, כדי שבדיקות יוכלו להחליף את הבדיקה
const assertPublicUrl = (u) => urls.assertPublicUrl(u);

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const BUTTON_TEXT = /הורד|הורדה|להורדה|הורדת|pdf|download|הדפס|print/i;

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    const opts = { args: ['--no-sandbox'] };
    if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    if (proxy) opts.proxy = { server: proxy };
    browserPromise = chromium.launch(opts).catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  return browserPromise;
}

async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    if (b) await b.close();
  }
}

const isPdf = (buf) => buf && buf.length > 4 && buf.subarray(0, 5).toString('latin1') === '%PDF-';

function filenameFromHeaders(headers, fallback) {
  const cd = headers['content-disposition'] || '';
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/"/g, ''));
    } catch { /* ignore */ }
  }
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : fallback;
}

function baseName(url) {
  const u = new URL(url);
  const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  if (/\.pdf$/i.test(last)) return last;
  const date = new Date().toISOString().slice(0, 10);
  return `invoice-${u.hostname.replace(/^www\./, '')}-${date}.pdf`;
}

// שלב 1: ניסיון הורדה ישירה – אם הלינק מחזיר PDF, אין צורך בדפדפן
async function tryDirect(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA } });
    await assertPublicUrl(res.url);
    const type = res.headers.get('content-type') || '';
    if (!res.ok) return null;
    if (!/pdf|octet-stream/i.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!isPdf(buf)) return null;
    const headers = Object.fromEntries(res.headers.entries());
    return { buffer: buf, filename: filenameFromHeaders(headers, baseName(res.url)), method: 'direct' };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// שלב 2: פתיחת הדף בדפדפן, חיפוש PDF אמיתי, ואם אין – הדפסת הדף ל-PDF
async function viaBrowser(url) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent: UA,
    locale: 'he-IL',
    viewport: { width: 1200, height: 1600 },
  });
  const page = await context.newPage();
  let captured = null;

  // חסימת בקשות לכתובות פנימיות מתוך הדף
  await context.route('**/*', async (route) => {
    try {
      await assertPublicUrl(route.request().url());
      await route.continue();
    } catch {
      await route.abort();
    }
  });

  page.on('response', async (res) => {
    if (captured) return;
    const type = res.headers()['content-type'] || '';
    if (!/application\/pdf/i.test(type)) return;
    try {
      const buf = await res.body();
      if (isPdf(buf)) captured = { buffer: buf, filename: filenameFromHeaders(res.headers(), baseName(res.url())), method: 'pdf-response' };
    } catch { /* ignore */ }
  });

  const fromDownload = async (dl) => {
    const stream = await dl.createReadStream();
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buf = Buffer.concat(chunks);
    return isPdf(buf) ? { buffer: buf, filename: dl.suggestedFilename() || baseName(url), method: 'download' } : null;
  };

  const downloadWait = page.waitForEvent('download', { timeout: 45000 }).catch(() => null);

  try {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (e) {
      // לינק שמוריד קובץ ישירות זורק "Download is starting"
      if (/download is starting/i.test(e.message)) {
        const dl = await downloadWait;
        const r = dl && (await fromDownload(dl));
        if (r) return r;
      } else if (!/timeout/i.test(e.message)) {
        throw e;
      }
    }
    await page.waitForTimeout(2000);
    if (captured) return captured;

    // לינקים / iframes שנראים כמו PDF
    const candidates = await page.evaluate(() => {
      const out = [];
      const push = (u) => { if (u && !out.includes(u)) out.push(u); };
      document.querySelectorAll('iframe[src],embed[src],object[data]').forEach((el) => push(el.src || el.data));
      document.querySelectorAll('a[href]').forEach((a) => {
        const txt = (a.textContent || '') + ' ' + a.href;
        if (/\.pdf\b|pdf|download|הורד/i.test(txt)) push(a.href);
      });
      return out.filter((u) => /^https?:/i.test(u)).slice(0, 5);
    });
    for (const c of candidates) {
      try {
        await assertPublicUrl(c);
        const res = await page.request.get(c, { timeout: 30000 });
        const buf = await res.body();
        if (isPdf(buf)) return { buffer: buf, filename: filenameFromHeaders(res.headers(), baseName(c)), method: 'pdf-link' };
      } catch { /* נסה את הבא */ }
    }

    // כפתור "הורד PDF"
    const buttons = page.locator('button, a, [role=button], input[type=button], input[type=submit]').filter({ hasText: BUTTON_TEXT });
    const count = Math.min(await buttons.count(), 3);
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      if (!(await btn.isVisible().catch(() => false))) continue;
      const dlPromise = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
      await btn.click({ timeout: 5000 }).catch(() => {});
      const dl = await dlPromise;
      if (dl) {
        const r = await fromDownload(dl);
        if (r) return r;
      }
      await page.waitForTimeout(1500);
      if (captured) return captured;
    }

    // אין PDF מקורי – מדפיסים את הדף עצמו
    await page.emulateMedia({ media: 'print' });
    const buf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' } });
    return { buffer: buf, filename: baseName(page.url() || url), method: 'page-print' };
  } finally {
    await context.close().catch(() => {});
  }
}

async function fetchInvoicePdf(url) {
  await assertPublicUrl(url);
  return (await tryDirect(url)) || (await viaBrowser(url));
}

module.exports = { fetchInvoicePdf, closeBrowser, isPdf };
