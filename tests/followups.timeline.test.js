'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 3198;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = 'admin@test.local';
const ADMIN_PASSWORD = 'TestPass123!';

let child = null;
let tmpDir = null;

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not become healthy');
}

async function startServer() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-fu-'));
  const env = { ...process.env, NODE_ENV: 'development', PORT: String(PORT), DATABASE_URL: '', POSTGRES_URL: '', AS_DATA_DIR: tmpDir, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, AS_API_RATE_LIMIT: '500' };
  child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  await waitForHealth();
}

async function stopServer() {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    if (!child.killed) try { child.kill('SIGKILL'); } catch {}
  }
  child = null;
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
  tmpDir = null;
}

function cookieToken(setCookie) { const m = String(setCookie || '').match(/as_session=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }

async function login(email, password) {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, token: cookieToken(res.headers.get('set-cookie')), csrf: json && json.csrfToken ? json.csrfToken : '' };
}

async function api(pathname, { method = 'GET', body, token, csrf } = {}) {
  const headers = {};
  if (token) headers.Cookie = `as_session=${encodeURIComponent(token)}`;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + pathname, { method, headers, body: payload });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

test('Follow-up timeline and activity', async (t) => {
  await startServer();
  t.after(async () => { await stopServer(); });

  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal(admin.status, 200);

  let enquiryId;
  await t.test('create enquiry', async () => {
    const res = await api('/api/enquiries', { method: 'POST', body: { name: 'Timeline Test', phone: '9876543210', email: 't@example.com', product: 'Home Loan', amount: '500000', city: 'Hyderabad', message: 'test', source: 'Website form', consent: true, submissionId: 'sub-tl-1' } });
    assert.equal(res.status, 201);
    enquiryId = res.json && res.json.id;
    assert.ok(enquiryId);
  });

  await t.test('schedule follow-up creates activity', async () => {
    const res = await api(`/api/enquiries/${enquiryId}`, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpDate: '2026-12-01', activityId: 'act-sched-1' } });
    assert.equal(res.status, 200);
    const acts = res.json.enquiry.followUpActivity || [];
    assert.ok(acts.some(a => a.type === 'follow_up_scheduled' && a.to === '2026-12-01'));
  });

  await t.test('reschedule records previous and new dates', async () => {
    const res = await api(`/api/enquiries/${enquiryId}`, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpDate: '2026-12-05', activityId: 'act-resched-1' } });
    assert.equal(res.status, 200);
    const acts = res.json.enquiry.followUpActivity || [];
    const r = acts.find(a => a.type === 'follow_up_rescheduled');
    assert.ok(r);
    assert.equal(r.from, '2026-12-01');
    assert.equal(r.to, '2026-12-05');
  });

  await t.test('duplicate activityId does not create duplicate', async () => {
    const before = await api(`/api/enquiries/${enquiryId}`, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpDate: '2026-12-05', activityId: 'act-resched-1' } });
    assert.equal(before.status, 200);
    const count = (before.json.enquiry.followUpActivity || []).filter(a => a.id === 'act-resched-1').length;
    assert.equal(count, 1);
  });

  await t.test('complete and reopen create activity', async () => {
    const done = await api(`/api/enquiries/${enquiryId}`, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpCompleted: true, activityId: 'act-done-1' } });
    assert.equal(done.status, 200);
    assert.ok(done.json.enquiry.followUpCompletedAt);
    assert.ok((done.json.enquiry.followUpActivity || []).some(a => a.type === 'follow_up_completed'));

    const reopen = await api(`/api/enquiries/${enquiryId}`, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpCompleted: false, activityId: 'act-reopen-1' } });
    assert.equal(reopen.status, 200);
    assert.ok(!reopen.json.enquiry.followUpCompletedAt);
    assert.ok((reopen.json.enquiry.followUpActivity || []).some(a => a.type === 'follow_up_reopened'));
  });

  await t.test('follow-up summary endpoint returns counts', async () => {
    const res = await api('/api/follow-ups/summary', { token: admin.token });
    assert.equal(res.status, 200);
    assert.ok(res.json.counts);
    assert.equal(typeof res.json.counts.total, 'number');
  });

  await t.test('internal note is stored', async () => {
    const res = await api(`/api/enquiries/${enquiryId}`, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { internalNote: 'Timeline note' } });
    assert.equal(res.status, 200);
    const notes = res.json.enquiry.internalNotes || [];
    assert.ok(notes.some(n => n.text === 'Timeline note'));
  });
});
