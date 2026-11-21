'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('critical public files exist', () => {
  const files = [
    'index.html', 'loans.html', 'contact.html', 'about.html', 'guides.html',
    'emi-calculator.html', 'balance-transfer-calculator.html', 'tenure-calculator.html',
    'prepayment-calculator.html', 'buy-vs-rent-calculator.html', 'home-loan-tax-saving-calculator.html',
    'privacy-policy.html', 'terms-of-use.html', '404.html', 'admin.html',
    'robots.txt', 'sitemap.xml'
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(root, f)), `missing ${f}`);
  }
});

test('sitemap includes calculator pages', () => {
  const xml = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  for (const page of ['emi-calculator.html','balance-transfer-calculator.html','tenure-calculator.html','prepayment-calculator.html','buy-vs-rent-calculator.html','home-loan-tax-saving-calculator.html']) {
    assert.ok(xml.includes(page), `sitemap missing ${page}`);
  }
});

test('validate module exposes expected API', () => {
  const v = require(path.join(root, 'server', 'validate.js'));
  assert.equal(typeof v.content, 'function');
  assert.equal(typeof v.enquiry, 'function');
  assert.equal(typeof v.adminCollection, 'function');
  assert.equal(typeof v.adminItem, 'function');
  assert.equal(typeof v.HttpError, 'function');
  const err = new v.HttpError(400, 'bad');
  assert.equal(err.status, 400);
  assert.equal(err.message, 'bad');
});

test('auth module exposes expected API', () => {
  const auth = require(path.join(root, 'server', 'auth.js'));
  for (const k of ['createCredential','verifyPassword','issue','read','revoke','tokenFrom','cookieHeader','clearCookieHeader']) {
    assert.equal(typeof auth[k], 'function', `auth.${k} missing`);
  }
  const cred = auth.createCredential('admin@example.com', 'secret123');
  assert.ok(auth.verifyPassword(cred, 'secret123'));
  assert.ok(!auth.verifyPassword(cred, 'wrong'));
});

test('store-pg does not set NODE_TLS_REJECT_UNAUTHORIZED globally', () => {
  const src = fs.readFileSync(path.join(root, 'server', 'store-pg.js'), 'utf8');
  assert.ok(!src.includes("NODE_TLS_REJECT_UNAUTHORIZED = '0'"), 'global TLS bypass should not be present');
  assert.ok(src.includes('rejectUnauthorized'), 'ssl config should be present');
});

test('mailer does not build reset URLs from request Host headers', () => {
  const mailer = require(path.join(root, 'server', 'mailer.js'));
  const src = fs.readFileSync(path.join(root, 'server', 'mailer.js'), 'utf8');
  assert.ok(!src.includes('req.headers.host'), 'Host header fallback should not be present');
  assert.ok(!src.includes("x-forwarded-host"), 'forwarded host fallback should not be present');
  assert.equal(mailer.absoluteResetUrl('/admin.html?reset=x', { headers: { host: 'evil.example' } }), '');
});

test('auth hashes reset tokens and does not expose raw hash helper as plain token', () => {
  const auth = require(path.join(root, 'server', 'auth.js'));
  assert.equal(typeof auth.hashResetToken, 'function');
  const rt = auth.makeResetToken();
  assert.equal(typeof rt.token, 'string');
  assert.equal(typeof rt.tokenHash, 'string');
  assert.notEqual(rt.token, rt.tokenHash);
  assert.equal(auth.hashResetToken(rt.token), rt.tokenHash);
});
