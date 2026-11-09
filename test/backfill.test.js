'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { zipSync, strToU8 } = require('fflate');
const { filesToTexts, collectLinks, parseDate } = require('../src/backfill');

const WA_IOS = `‎[15.12.2023, 9:01:02] חברת חשמל: החשבונית שלך https://old.example.com/a
[3.1.2024, 10:15:32] חברת חשמל: ‎החשבונית לחודש דצמבר מוכנה:
https://iec.example.co.il/inv/123
[7.2.2024, 11:00:00] חברת חשמל: תזכורת לתשלום, לצפייה בחשבונית https://iec.example.co.il/inv/456
[8.2.2024, 11:00:00] חברת חשמל: מבצע! https://promo.example.com`;
const WA_ANDROID = `1/3/24, 10:15 - Bezeq: קבלה על תשלום https://bezeq.example/r/1`;
const CSV = `"Chat Session","Message Date","Text"\n"Cellcom","2024-05-01 08:00:00","חשבונית מס: https://cellcom.example/i/9"`;

test('parses common date formats', () => {
  assert.strictEqual(parseDate('[3.1.2024, 10:15]').toISOString().slice(0, 10), '2024-01-03');
  assert.strictEqual(parseDate('2024-05-01 08:00').toISOString().slice(0, 10), '2024-05-01');
  assert.strictEqual(parseDate('12/31/24, 10:15').toISOString().slice(0, 10), '2024-12-31');
});

test('collects invoice links from a WhatsApp zip since a date, with keyword filter', () => {
  const zip = Buffer.from(zipSync({ '_chat.txt': strToU8(WA_IOS) }));
  const texts = filesToTexts('chat.zip', zip);
  const { links } = collectLinks(texts, { from: new Date('2024-01-01'), keywords: ['חשבונית', 'קבלה'], keywordsOnly: true });
  assert.deepStrictEqual(links.map((l) => l.url), ['https://iec.example.co.il/inv/123', 'https://iec.example.co.il/inv/456']);
});

test('without keyword filter includes every link after the date', () => {
  const { links } = collectLinks([{ text: WA_IOS }], { from: new Date('2024-01-01'), keywordsOnly: false });
  assert.strictEqual(links.length, 3);
});

test('android WhatsApp and SMS csv formats', () => {
  const { links } = collectLinks([{ text: WA_ANDROID }, { text: CSV }], { from: new Date('2024-01-01'), keywords: ['חשבונית', 'קבלה'], keywordsOnly: true });
  assert.deepStrictEqual(links.map((l) => l.url), ['https://bezeq.example/r/1', 'https://cellcom.example/i/9']);
});
