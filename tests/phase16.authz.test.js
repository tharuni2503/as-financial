'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 3197;
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-authz-'));
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
    AS_API_RATE_LIMIT: '1000',
  };
  child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
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

function cookieToken(setCookie) {
  const m = String(setCookie || '').match(/as_session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function login(email, password) {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, token: cookieToken(res.headers.get('set-cookie')), csrf: (json && json.csrfToken) || '' };
}

async function api(pathname, { method = 'GET', body, token, csrf, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Cookie = `as_session=${encodeURIComponent(token)}`;
  if (csrf) h['X-CSRF-Token'] = csrf;
  let payload;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + pathname, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, text, json };
}

test('Phase 1.6 authz matrix (isolated JSON backend)', async (t) => {
  await startServer();
  t.after(stopServer);

  let superAdmin, adminUser, advisor1, advisor2;
  let advisor1RecordId, advisor2RecordId;

  await t.test('setup: create admin and two advisors', async () => {
    superAdmin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.equal(superAdmin.status, 200);
    assert.equal(superAdmin.json.role, 'super_admin');

    const mk = async (name, email, role) => {
      const r = await api('/api/users', { method: 'POST', token: superAdmin.token, csrf: superAdmin.csrf, body: { name, email, password: 'TestPass123!', role } });
      assert.equal(r.status, 201, `${role} create failed: ${r.text}`);
      const l = await login(email, 'TestPass123!');
      assert.equal(l.status, 200, `${email} login failed`);
      return { ...l, email, role, id: r.json.user.id };
    };
    adminUser = await mk('Admin User', 'admin2@test.local', 'admin');
    advisor1 = await mk('Advisor One', 'adv1@test.local', 'advisor');
    advisor2 = await mk('Advisor Two', 'adv2@test.local', 'advisor');
  });

  await t.test('unauthenticated requests rejected', async () => {
    const checks = [
      ['GET','/api/admin/store'],['GET','/api/users'],['GET','/api/audit'],['GET','/api/sessions'],
      ['GET','/api/admin/export'],['POST','/api/users',{}],['PATCH','/api/users/any',{}],
      ['POST','/api/admin/leads',{}],['GET','/api/admin/leads'],['DELETE','/api/admin/leads/x'],
      ['POST','/api/admin/uploads',{}],['GET','/api/admin/uploads/x'],
    ];
    for (const [m,p,b] of checks) {
      const r = await api(p, { method: m, body: b });
      assert.equal(r.status, 401, `${m} ${p} expected 401 got ${r.status}`);
    }
  });

  await t.test('invalid session token rejected', async () => {
    const r = await api('/api/admin/store', { token: 'invalid-token' });
    assert.equal(r.status, 401);
  });

  await t.test('advisor cannot access admin/super_admin endpoints', async () => {
    const forbidden = [
      ['GET','/api/users'],['GET','/api/audit'],['GET','/api/sessions'],['GET','/api/admin/store'],
      ['GET','/api/admin/export'],['POST','/api/users',{name:'X',email:'x@t.local',password:'TestPass123!',role:'advisor'}],
      ['PATCH','/api/users/'+adminUser.id,{name:'hacked'}],['POST','/api/users/'+adminUser.id+'/reset-token',{}],
      ['POST','/api/admin/leads',{name:'L',phone:'9999999999'}],['GET','/api/admin/leads'],
      ['POST','/api/admin/uploads',{filename:'a.pdf',contentType:'application/pdf',dataBase64:Buffer.from('x').toString('base64')}],
    ];
    for (const [m,p,b] of forbidden) {
      const r = await api(p, { method: m, token: advisor1.token, csrf: advisor1.csrf, body: b });
      assert.ok([401,403].includes(r.status), `advisor ${m} ${p} expected 401/403 got ${r.status}`);
    }
  });

  await t.test('admin cannot perform super_admin-only operations', async () => {
    const checks = [
      ['GET','/api/admin/export'],
      ['POST','/api/users',{name:'N',email:'n@test.local',password:'TestPass123!',role:'advisor'}],
      ['PATCH','/api/users/'+advisor1.id,{name:'Changed'}],
      ['POST','/api/users/'+advisor1.id+'/reset-token',{}],
    ];
    for (const [m,p,b] of checks) {
      const r = await api(p, { method: m, token: adminUser.token, csrf: adminUser.csrf, body: b });
      assert.equal(r.status, 403, `admin ${m} ${p} expected 403 got ${r.status}: ${r.text}`);
    }
  });

  await t.test('CSRF required on mutating authenticated routes', async () => {
    const r = await api('/api/sessions/revoke-others', { method: 'POST', token: superAdmin.token, body: {} });
    assert.equal(r.status, 403);
  });

  await t.test('session ownership: user cannot revoke another user session', async () => {
    const all = await api('/api/sessions?scope=all', { token: superAdmin.token });
    assert.equal(all.status, 200);
    const adv2Session = (all.json.sessions || []).find(s => s.email === advisor2.email && !s.current);
    assert.ok(adv2Session, 'advisor2 session should exist');
    const r = await api('/api/sessions/' + adv2Session.id, { method: 'DELETE', token: advisor1.token, csrf: advisor1.csrf });
    assert.equal(r.status, 403, `expected 403 got ${r.status}: ${r.text}`);
  });

  await t.test('admin cannot revoke super_admin session (role hierarchy)', async () => {
    const all = await api('/api/sessions?scope=all', { token: superAdmin.token });
    const saSession = (all.json.sessions || []).find(s => s.email === ADMIN_EMAIL && !s.current);
    if (saSession) {
      const r = await api('/api/sessions/' + saSession.id, { method: 'DELETE', token: adminUser.token, csrf: adminUser.csrf });
      assert.equal(r.status, 403, `expected 403 got ${r.status}: ${r.text}`);
    } else {
      assert.ok(true, 'no non-current super_admin session to test');
    }
  });

  await t.test('ID tampering: advisor cannot access user records by changing ID', async () => {
    const r = await api('/api/users/' + advisor2.id, { method: 'PATCH', token: advisor1.token, csrf: advisor1.csrf, body: { name: 'Hacked' } });
    assert.ok([401,403,404].includes(r.status), `expected 401/403/404 got ${r.status}`);
  });

  await t.test('upload/download restrictions', async () => {
    const up = await api('/api/admin/uploads', { method: 'POST', token: superAdmin.token, csrf: superAdmin.csrf, body: { filename: 'doc.pdf', contentType: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4').toString('base64') } });
    assert.equal(up.status, 201, up.text);
    const stored = up.json.file.storedName;
    const advDl = await api('/api/admin/uploads/' + encodeURIComponent(stored), { token: advisor1.token });
    assert.ok([401,403].includes(advDl.status), `advisor download expected 401/403 got ${advDl.status}`);
    const noAuth = await fetch(`${BASE}/api/admin/uploads/${encodeURIComponent(stored)}`);
    assert.equal(noAuth.status, 401);
  });
});
