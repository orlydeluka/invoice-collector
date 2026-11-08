'use strict';

const nodemailer = require('nodemailer');

let transport = null;
function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function sendInvoice({ url, pdf, sourceText, source }) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const via = source === 'whatsapp' ? 'ווטסאפ' : source === 'sms' ? 'SMS' : 'ידני';
  return getTransport().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO || 'orlyg@timlul.com',
    subject: `חשבונית מ-${host} (${new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })})`,
    html: `<div dir="rtl" style="font-family:Arial,sans-serif">
      <p>מצורפת חשבונית שהגיעה ב${via}.</p>
      <p><b>לינק מקורי:</b> <a href="${esc(url)}">${esc(url)}</a></p>
      ${pdf.method === 'page-print' ? '<p style="color:#a15c00">לא נמצא קובץ PDF מקורי, לכן צורפה הדפסה של דף החשבונית.</p>' : ''}
      ${sourceText ? `<p><b>תוכן ההודעה:</b></p><pre style="white-space:pre-wrap;background:#f4f4f4;padding:8px">${esc(sourceText)}</pre>` : ''}
    </div>`,
    attachments: [{ filename: pdf.filename, content: pdf.buffer, contentType: 'application/pdf' }],
  });
}

async function sendFailure({ url, error, sourceText }) {
  return getTransport().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO || 'orlyg@timlul.com',
    subject: `לא הצלחתי להוריד חשבונית מ-${new URL(url).hostname}`,
    html: `<div dir="rtl" style="font-family:Arial,sans-serif">
      <p>ניסיתי להוריד חשבונית ולא הצלחתי. אפשר לפתוח את הלינק ידנית:</p>
      <p><a href="${esc(url)}">${esc(url)}</a></p>
      <p style="color:#888">שגיאה: ${esc(error)}</p>
      ${sourceText ? `<pre style="white-space:pre-wrap;background:#f4f4f4;padding:8px">${esc(sourceText)}</pre>` : ''}
    </div>`,
  });
}

module.exports = { sendInvoice, sendFailure };
