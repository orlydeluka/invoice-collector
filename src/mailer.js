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

const ymd = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // 2024-01-31

async function sendInvoice({ url, pdf, sourceText, source, date }) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const via = { whatsapp: 'ווטסאפ', sms: 'SMS', history: 'הודעה ישנה (ייבוא היסטוריה)' }[source] || 'שליחה ידנית';
  const when = date || new Date();
  // שם קובץ שמתחיל בתאריך, כדי שיהיה קל למיין
  const filename = /^\d{4}-\d{2}-\d{2}_/.test(pdf.filename) ? pdf.filename : `${ymd(when)}_${pdf.filename}`;
  return getTransport().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO || 'orlyg@timlul.com',
    subject: `חשבונית מ-${host} (${new Date(when).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' })})`,
    html: `<div dir="rtl" style="font-family:Arial,sans-serif">
      <p>מצורפת חשבונית. מקור: ${via}.</p>
      <p><b>לינק מקורי:</b> <a href="${esc(url)}">${esc(url)}</a></p>
      ${pdf.method === 'page-print' ? '<p style="color:#a15c00">לא נמצא קובץ PDF מקורי, לכן צורפה הדפסה של דף החשבונית.</p>' : ''}
      ${sourceText ? `<p><b>תוכן ההודעה:</b></p><pre style="white-space:pre-wrap;background:#f4f4f4;padding:8px">${esc(sourceText)}</pre>` : ''}
    </div>`,
    attachments: [{ filename, content: pdf.buffer, contentType: 'application/pdf' }],
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

async function sendSummary(job) {
  const rows = job.failed
    .map((f) => `<tr><td>${esc(f.date)}</td><td><a href="${esc(f.url)}">${esc(f.url)}</a></td><td style="color:#888">${esc(f.error)}</td></tr>`)
    .join('');
  return getTransport().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO || 'orlyg@timlul.com',
    subject: `סיכום ייבוא חשבוניות: ${job.ok} נשלחו, ${job.failed.length} נכשלו`,
    html: `<div dir="rtl" style="font-family:Arial,sans-serif">
      <p>ייבוא החשבוניות מההיסטוריה הסתיים.</p>
      <ul>
        <li>הודעות שנסרקו: ${job.messages}</li>
        <li>חשבוניות שנשלחו: ${job.ok}</li>
        <li>כבר נשלחו בעבר (דילגתי): ${job.alreadySent}</li>
        <li>נכשלו: ${job.failed.length}</li>
      </ul>
      ${rows ? `<p>לינקים שלא הצלחתי להוריד (לרוב לינקים ישנים שפג תוקפם, או אתרים שדורשים קוד אימות):</p>
      <table border="1" cellpadding="4" style="border-collapse:collapse;font-size:13px">${rows}</table>` : ''}
    </div>`,
  });
}

module.exports = { sendInvoice, sendFailure, sendSummary };
