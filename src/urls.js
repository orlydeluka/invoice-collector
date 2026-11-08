'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

// תופס לינקים גם כשהם בלי http (למשל "www.example.com/inv/123")
const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"'`]+)/gi;
// תווים שנדבקים לסוף לינק בהודעות טקסט ולא שייכים לו
const TRAILING = /[).,;:!?\]}־׃"'׳״>]+$/u;

function extractUrls(text) {
  if (!text) return [];
  const found = new Set();
  for (const m of String(text).matchAll(URL_RE)) {
    let u = m[1].replace(TRAILING, '');
    if (/^www\./i.test(u)) u = 'https://' + u;
    try {
      const parsed = new URL(u);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') found.add(parsed.toString());
    } catch {
      /* לא לינק תקין */
    }
  }
  return [...found];
}

function matchesKeywords(text, keywords) {
  if (!keywords || keywords.length === 0) return true;
  const lower = String(text || '').toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

// מונע מהשרת לגשת לכתובות פנימיות (הגנה בסיסית מ-SSRF)
async function assertPublicUrl(url) {
  const { hostname, protocol } = new URL(url);
  if (protocol !== 'http:' && protocol !== 'https:') throw new Error('רק לינקים מסוג http/https נתמכים');
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('כתובת פנימית חסומה');
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('כתובת פנימית חסומה');
}

module.exports = { extractUrls, matchesKeywords, isPrivateIp, assertPublicUrl };
