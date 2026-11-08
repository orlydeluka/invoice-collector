'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractUrls, matchesKeywords, isPrivateIp, assertPublicUrl } = require('../src/urls');

test('extracts links from a Hebrew SMS', () => {
  const sms = 'שלום, החשבונית שלך מוכנה: https://inv.example.co.il/d/AbC123. תודה!';
  assert.deepStrictEqual(extractUrls(sms), ['https://inv.example.co.il/d/AbC123']);
});

test('adds https to www links and dedupes', () => {
  assert.deepStrictEqual(extractUrls('www.a.com/x www.a.com/x (https://b.com/y)'), ['https://www.a.com/x', 'https://b.com/y']);
});

test('keyword filter', () => {
  assert.ok(matchesKeywords('לצפייה בחשבונית לחצו', ['חשבונית']));
  assert.ok(!matchesKeywords('קוד אימות 1234', ['חשבונית', 'invoice']));
  assert.ok(matchesKeywords('anything', []));
});

test('private ip detection', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', '::ffff:10.0.0.1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1']) assert.ok(!isPrivateIp(ip), ip);
});

test('blocks internal urls', async () => {
  await assert.rejects(assertPublicUrl('http://localhost:3000/'));
  await assert.rejects(assertPublicUrl('http://169.254.169.254/latest'));
  await assert.rejects(assertPublicUrl('file:///etc/passwd'));
});
