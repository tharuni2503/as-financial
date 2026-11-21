'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:3000';

async function fetchSafe(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...opts });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { res, text, json };
}

test('protected endpoints reject unauthenticated requests', async () => {
  const checks = [
    ['GET', '/api/admin/store'],
    ['GET', '/api/enquiries'],
    ['GET', '/api/users'],
    ['GET', '/api/audit'],
    ['GET', '/api/sessions'],
    ['GET', '/api/admin/export'],
    ['GET', '/api/admin/uploads/test.txt'],
    ['POST', '/api/admin/leads'],
    ['PATCH', '/api/admin/leads/1'],
    ['DELETE', '/api/admin/leads/1'],
    ['PUT', '/api/content/posts'],
    ['POST', '/api/change-password'],
    ['POST', '/api/users'],
    ['POST', '/api/sessions/revoke-others'],
    ['DELETE', '/api/sessions/abc'],
  ];
  for (const [method, path] of checks) {
    const opts = { method };
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = '{}';
    }
    const { res } = await fetchSafe(path, opts);
    assert.equal(res.status, 401, `${method} ${path} expected 401, got ${res.status}`);
  }
});

test('sensitive static paths are blocked', async () => {
  const paths = ['/IMPLEMENTATION_PLAN.md', '/README.md', '/package.json', '/.env', '/server/index.js', '/data/db.json'];
  for (const p of paths) {
    const { res } = await fetchSafe(p);
    assert.equal(res.status, 404, `${p} expected 404, got ${res.status}`);
  }
});

test('security headers are present on HTML and API responses', async () => {
  const { res: html } = await fetchSafe('/');
  assert.equal(html.status, 200);
  assert.ok(html.headers.get('content-security-policy'));
  assert.equal(html.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(html.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(html.headers.get('x-frame-options'), 'SAMEORIGIN');

  const { res: admin } = await fetchSafe('/admin.html');
  assert.equal(admin.headers.get('x-robots-tag'), 'noindex, nofollow');

  const { res: api } = await fetchSafe('/api/health');
  assert.equal(api.headers.get('cache-control'), 'no-store');
});

test('unknown API route returns 404 JSON error', async () => {
  const { res, json, text } = await fetchSafe('/api/unknown-route');
  assert.equal(res.status, 404);
  assert.ok(json && typeof json.error === 'string', `expected JSON error, got: ${text}`);
});

test('malformed JSON does not leak stack trace', async () => {
  const { res, text } = await fetchSafe('/api/enquiries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad json'
  });
  assert.equal(res.status, 400);
  assert.ok(!/stack|at\s+\w+\s+\(/i.test(text), 'response should not contain stack trace');
});
