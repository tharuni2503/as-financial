"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../server/auth');
const validate = require('../server/validate');
const mailer = require('../server/mailer');

test('password credentials use a salted hash and verify safely', () => {
  const credential = auth.createCredential('admin@example.com', 'StrongPassword!42');
  assert.notEqual(credential.hash, 'StrongPassword!42');
  assert.equal(auth.verifyPassword(credential, 'StrongPassword!42'), true);
  assert.equal(auth.verifyPassword(credential, 'wrong-password'), false);
});

test('session cookies are HttpOnly and SameSite protected', () => {
  const cookie = auth.cookieHeader('test-token', { secure: true, maxAgeMs: 60_000 });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=60/);
});

test('password reset tokens are random and expire within the configured TTL', () => {
  const first = auth.makeResetToken();
  const second = auth.makeResetToken();
  assert.notEqual(first.token, second.token);
  assert.ok(Date.parse(first.expiresAt) > Date.now());
  assert.ok(Date.parse(first.expiresAt) <= Date.now() + auth.RESET_TTL_MS + 1000);
});

test('public enquiries require explicit contact consent', () => {
  const payload = { name: 'Test User', phone: '9876543210', email: 'test@example.com' };
  assert.throws(() => validate.enquiry(payload), /accept the consent note/i);
  assert.equal(validate.enquiry({ ...payload, consent: true }).name, 'Test User');
  assert.equal(validate.enquiry({ ...payload, consent: 'true' }).name, 'Test User');
});

test('enquiry validation rejects malformed phone numbers and email addresses', () => {
  assert.throws(() => validate.enquiry({ name: 'Test User', phone: '123', consent: true }), /valid 10-digit mobile/i);
  assert.throws(() => validate.enquiry({ name: 'Test User', phone: '9876543210', email: 'not-an-email', consent: true }), /valid email/i);
});

test('admin data sanitizer drops prototype-pollution keys', () => {
  const input = JSON.parse('{"safe":"value","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true}}');
  const clean = validate.sanitize(input, 0, 100);
  assert.equal(clean.safe, 'value');
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.hasOwn(clean, '__proto__'), false);
  assert.equal(Object.hasOwn(clean, 'constructor'), false);
  assert.equal(Object.hasOwn(clean, 'prototype'), false);
});

test('password reset email escapes HTML and only accepts HTTP(S) URLs', () => {
  const message = mailer.buildResetEmail({
    name: '<img src=x onerror=alert(1)>',
    resetUrl: 'https://asfinancial.example/admin.html?reset=abc&next=home',
    expiresAt: '2026-11-22T10:00:00.000Z'
  });
  assert.doesNotMatch(message.html, /<img/);
  assert.match(message.html, /&lt;img/);
  assert.match(message.html, /&amp;next=home/);
  assert.equal(mailer.safeHttpUrl('javascript:alert(1)'), '');
  assert.throws(() => mailer.buildResetEmail({ name: 'Admin', resetUrl: 'javascript:alert(1)' }), /valid absolute HTTP/i);
});

test('production password reset URLs do not trust request Host headers', () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(mailer.absoluteResetUrl('/admin.html?reset=secret', {
      protocol: 'https', headers: { host: 'attacker.example', 'x-forwarded-proto': 'https' }
    }), '');
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
