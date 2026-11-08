'use strict';
// בדיקת אינטגרציה: שרת מקומי שמדמה סוגים שונים של דפי חשבונית
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const urls = require('../src/urls');

delete process.env.HTTPS_PROXY;
delete process.env.https_proxy;
urls.assertPublicUrl = async () => {}; // השרת המקומי הוא localhost
const { fetchInvoicePdf, closeBrowser, isPdf } = require('../src/fetcher');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const html = (b) => `<!doctype html><html dir="rtl"><meta charset="utf-8"><body>${b}</body></html>`;

let base;
const server = http.createServer((req, res) => {
  const send = (type, body, extra = {}) => { res.writeHead(200, { 'content-type': type, ...extra }); res.end(body); };
  switch (req.url) {
    case '/file.pdf': return send('application/pdf', PDF, { 'content-disposition': 'attachment; filename="INV-77.pdf"' });
    case '/short': res.writeHead(302, { location: '/file.pdf' }); return res.end();
    case '/viewer': return send('text/html', html('<h1>חשבונית 77</h1><a href="/api/doc?id=77">הורדת PDF</a>'));
    case '/api/doc?id=77': return send('application/pdf', PDF);
    case '/button': return send('text/html', html(`<h1>קבלה</h1><button id="b">הורדת חשבונית</button><script>
        b.onclick = () => {
          const bytes = Uint8Array.from(atob('${PDF.toString('base64')}'), (c) => c.charCodeAt(0));
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
          a.download = 'kabala.pdf';
          a.click();
        };</script>`));
    case '/plain': return send('text/html', html('<h1>חשבונית מס 123</h1><p>סה״כ לתשלום: 100 ₪</p>'));
    default: res.writeHead(404); res.end();
  }
});

test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await closeBrowser(); server.close(); });

test('direct PDF link (with redirect)', async () => {
  const r = await fetchInvoicePdf(base + '/short');
  assert.strictEqual(r.method, 'direct');
  assert.strictEqual(r.filename, 'INV-77.pdf');
  assert.ok(isPdf(r.buffer));
});

test('page with a "download PDF" link', async () => {
  const r = await fetchInvoicePdf(base + '/viewer');
  assert.strictEqual(r.method, 'pdf-link');
  assert.ok(isPdf(r.buffer));
});

test('page where a download button must be clicked', async () => {
  const r = await fetchInvoicePdf(base + '/button');
  assert.strictEqual(r.method, 'download');
  assert.strictEqual(r.filename, 'kabala.pdf');
  assert.ok(isPdf(r.buffer));
});

test('plain HTML invoice is printed to PDF', async () => {
  const r = await fetchInvoicePdf(base + '/plain');
  assert.strictEqual(r.method, 'page-print');
  assert.ok(isPdf(r.buffer) && r.buffer.length > 1000);
});
