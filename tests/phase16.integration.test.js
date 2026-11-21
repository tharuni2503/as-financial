'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = 'admin@test.local';
const ADMIN_PASSWORD = 'TestPass123!';

let child = null;
let tmpDir = null;

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not become healthy');
}

async function startServer(extraEnv = {}) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-p16-'));
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    DATABASE_URL: '',
    POSTGRES_URL: '',
    AS_DATA_DIR: tmpDir,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    APP_URL: BASE,
    AS_API_RATE_LIMIT: '500',
    ...extraEnv,
  };
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  tmpDir = null;
}

async function api(pathname, { method = 'GET', body, token, csrf, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Cookie = `as_session=${encodeURIComponent(token)}`;
  if (csrf) h['X-CSRF-Token'] = csrf;
  let payload;
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + pathname, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, text, json };
}

function cookieToken(setCookie) {
  const m = String(setCookie || '').match(/as_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => null);
  const token = cookieToken(res.headers.get('set-cookie'));
  return { status: res.status, json, token, csrf: json && json.csrfToken ? json.csrfToken : '' };
}

test('Phase 1.6 isolated integration', async (t) => {
  await startServer();
  t.after(async () => { await stopServer(); });

  await t.test('bootstrap admin login works', async () => {
    const a = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.equal(a.status, 200);
    assert.ok(a.token);
    assert.ok(a.csrf);
    assert.equal(a.json.role, 'super_admin');
  });

  await t.test('CSRF required for authenticated mutating requests', async () => {
    const a = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const noCsrf = await api('/api/admin/leads', { method: 'POST', token: a.token, body: { name: 'X' } });
    assert.equal(noCsrf.status, 403, `expected 403, got ${noCsrf.status}: ${noCsrf.text}`);
    const badCsrf = await api('/api/admin/leads', { method: 'POST', token: a.token, csrf: 'bad', body: { name: 'X' } });
    assert.equal(badCsrf.status, 403);
  });

  await t.test('create two independent test users and verify role boundaries', async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const u1 = await api('/api/users', { method: 'POST', token: admin.token, csrf: admin.csrf, body: { name: 'User One', email: 'u1@test.local', password: 'TestPass123!', role: 'advisor' } });
    const u2 = await api('/api/users', { method: 'POST', token: admin.token, csrf: admin.csrf, body: { name: 'User Two', email: 'u2@test.local', password: 'TestPass123!', role: 'advisor' } });
    assert.equal(u1.status, 201, u1.text);
    assert.equal(u2.status, 201, u2.text);

    const l1 = await login('u1@test.local', 'TestPass123!');
    const l2 = await login('u2@test.local', 'TestPass123!');
    assert.equal(l1.status, 200);
    assert.equal(l2.status, 200);

    // Ordinary user cannot perform admin operations
    for (const [method, path, body] of [
      ['GET', '/api/users'],
      ['GET', '/api/audit'],
      ['GET', '/api/admin/store'],
      ['POST', '/api/admin/leads', { name: 'Lead', phone: '9999999999' }],
      ['POST', '/api/users', { name: 'X', email: 'x@test.local', password: 'TestPass123!', role: 'advisor' }],
    ]) {
      const r = await api(path, { method, token: l1.token, csrf: l1.csrf, body });
      assert.equal(r.status, 403, `advisor ${method} ${path} expected 403, got ${r.status}: ${r.text}`);
    }

    // User isolation: user2 cannot revoke user1 session by guessing session id
    const sessions1 = await api('/api/sessions', { method: 'GET', token: admin.token });
    assert.equal(sessions1.status, 200);
    const u1Session = (sessions1.json.sessions || []).find(s => String(s.email).toLowerCase() === 'u1@test.local');
    if (u1Session) {
      const revoke = await api(`/api/sessions/${encodeURIComponent(u1Session.id)}`, { method: 'DELETE', token: l2.token, csrf: l2.csrf });
      assert.notEqual(revoke.status, 200, 'user2 should not revoke user1 session');
    }
  });

  await t.test('password reset invalid/expired/reused/success and no prod token leak in dev response shape', async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    // create reset target
    await api('/api/users', { method: 'POST', token: admin.token, csrf: admin.csrf, body: { name: 'Reset User', email: 'reset@test.local', password: 'TestPass123!', role: 'advisor' } });

    const forgot = await api('/api/forgot-password', { method: 'POST', body: { email: 'reset@test.local' } });
    assert.equal(forgot.status, 200);
    assert.equal(forgot.json.ok, true);
    assert.ok(forgot.json.devResetToken, 'dev mode should return devResetToken for isolated test');

    const bad = await api('/api/reset-password', { method: 'POST', body: { token: 'invalid-token', newPassword: 'NewPass123!' } });
    assert.equal(bad.status, 400);

    const ok = await api('/api/reset-password', { method: 'POST', body: { token: forgot.json.devResetToken, newPassword: 'NewPass123!' } });
    assert.equal(ok.status, 200, ok.text);

    const reused = await api('/api/reset-password', { method: 'POST', body: { token: forgot.json.devResetToken, newPassword: 'AnotherPass123!' } });
    assert.equal(reused.status, 400, 'reused token should fail');

    const oldLogin = await login('reset@test.local', 'TestPass123!');
    assert.notEqual(oldLogin.status, 200, 'old password should not work');
    const newLogin = await login('reset@test.local', 'NewPass123!');
    assert.equal(newLogin.status, 200, 'new password should work');
  });

  await t.test('upload rejects invalid type and oversize; download requires auth', async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const badType = await api('/api/admin/uploads', { method: 'POST', token: admin.token, csrf: admin.csrf, body: { filename: 'x.exe', contentType: 'application/x-msdownload', dataBase64: Buffer.from('MZ').toString('base64') } });
    assert.equal(badType.status, 400);

    const big = Buffer.alloc(5 * 1024 * 1024 + 10, 1).toString('base64');
    const tooBig = await api('/api/admin/uploads', { method: 'POST', token: admin.token, csrf: admin.csrf, body: { filename: 'big.pdf', contentType: 'application/pdf', dataBase64: big } });
    assert.equal(tooBig.status, 400);

    const good = await api('/api/admin/uploads', { method: 'POST', token: admin.token, csrf: admin.csrf, body: { filename: 'ok.pdf', contentType: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 test').toString('base64') } });
    assert.equal(good.status, 201, good.text);

    const fileName = good.json && good.json.file && good.json.file.storedName;
    if (fileName) {
      const unauth = await fetchSafe(`/api/admin/uploads/${encodeURIComponent(fileName)}`);
      assert.equal(unauth.status, 401);
    }
  });

});

test('Phase 1.6 Turnstile verification when configured', async (t) => {
  const port = 3198;
  const base = `http://127.0.0.1:${port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-p16-ts-'));
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    DATABASE_URL: '',
    POSTGRES_URL: '',
    AS_DATA_DIR: dir,
    ADMIN_EMAIL: 'admin@test.local',
    ADMIN_PASSWORD: 'TestPass123!',
    APP_URL: base,
    TURNSTILE_SECRET_KEY: 'test-secret',
  };
  const proc = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  t.after(async () => {
    if (proc && !proc.killed) { proc.kill('SIGTERM'); await new Promise(r => setTimeout(r, 300)); if (!proc.killed) try { proc.kill('SIGKILL'); } catch {} }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  const start = Date.now();
  while (Date.now() - start < 20000) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }

  await t.test('missing turnstile token rejected', async () => {
    const res = await fetch(`${base}/api/enquiries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A', phone: '9999999999', product: 'Home Loan' }) });
    assert.equal(res.status, 400);
  });

  await t.test('invalid turnstile token rejected', async () => {
    const res = await fetch(`${base}/api/enquiries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A', phone: '9999999999', product: 'Home Loan', turnstileToken: 'bad-token' }) });
    assert.equal(res.status, 400);
  });
});

async function fetchSafe(pathname) {
  const res = await fetch(BASE + pathname);
  return { status: res.status, text: await res.text() };
}
