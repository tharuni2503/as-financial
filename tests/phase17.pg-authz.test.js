'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 3196;
const BASE = `http://127.0.0.1:${PORT}`;

function mustTestDb(url) {
  const raw = String(url || '').trim();
  if (!raw) throw new Error('TEST_DATABASE_URL is required. Refusing to run.');
  if (process.env.I_UNDERSTAND_THIS_IS_A_TEST_DB !== 'yes') {
    throw new Error('Set I_UNDERSTAND_THIS_IS_A_TEST_DB=yes to confirm this is an isolated test database.');
  }
  let u;
  try { u = new URL(raw); } catch { throw new Error('TEST_DATABASE_URL is not a valid URL.'); }
  const db = (u.pathname || '').replace(/^\//, '').toLowerCase();
  const host = (u.hostname || '').toLowerCase();
  const bad = ['prod', 'production', 'live', 'customer'];
  if (bad.some(b => db.includes(b) || host.includes(b))) throw new Error('Refusing: database identity looks production-like.');
  if (!/(test|staging|dev|local|ci)/.test(db + ' ' + host)) {
    throw new Error('Refusing: database identity must explicitly include test/staging/dev/local/ci.');
  }
  return raw;
}

async function verifyDbIdentity(testDbUrl) {
  const { Client } = require('pg');
  const c = new Client({ connectionString: testDbUrl, ssl: process.env.AS_PG_SSL_VERIFY === '1' ? { rejectUnauthorized: true } : { rejectUnauthorized: false } });
  await c.connect();
  try {
    const r = await c.query("SELECT current_database() db, current_user usr, inet_server_addr()::text host, version() ver");
    const row = r.rows[0] || {};
    const db = String(row.db || '');
    const host = String(row.host || '');
    const bad = ['prod', 'production', 'live', 'customer'];
    if (bad.some(b => db.toLowerCase().includes(b) || host.toLowerCase().includes(b))) throw new Error('Refusing: connected DB looks production-like.');
    return row;
  } finally {
    await c.end();
  }
}

async function waitForHealth(timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return await r.json().catch(()=>null); } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not become healthy');
}

function cookieToken(setCookie) { const m = String(setCookie || '').match(/as_session=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
async function login(email, password) {
  const res = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, token: cookieToken(res.headers.get('set-cookie')), csrf: (json && json.csrfToken) || '' };
}
async function api(pathname, { method = 'GET', body, token, csrf } = {}) {
  const h = {};
  if (token) h.Cookie = `as_session=${encodeURIComponent(token)}`;
  if (csrf) h['X-CSRF-Token'] = csrf;
  let payload;
  if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + pathname, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

test('Phase 1.7 PostgreSQL authorization verification (isolated TEST DB only)', async (t) => {
  const testDbUrl = mustTestDb(process.env.TEST_DATABASE_URL);
  const identity = await verifyDbIdentity(testDbUrl);
  t.diagnostic(`DB identity: db=${identity.db} host=${identity.host || 'n/a'} user=${identity.usr}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-p17-'));
  const env = { ...process.env, NODE_ENV: 'development', PORT: String(PORT), DATABASE_URL: testDbUrl, POSTGRES_URL: testDbUrl, AS_DATA_DIR: tmpDir, ADMIN_EMAIL: 'phase17-admin@test.local', ADMIN_PASSWORD: 'TestPass123!', APP_URL: BASE, AS_API_RATE_LIMIT: '2000' };
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  t.after(async () => { if (child && !child.killed) { child.kill('SIGTERM'); await new Promise(r=>setTimeout(r,300)); if(!child.killed) try{child.kill('SIGKILL')}catch{} } try{fs.rmSync(tmpDir,{recursive:true,force:true})}catch{} });

  const health = await waitForHealth();
  assert.equal(health && health.backend, 'postgres', 'server must be using postgres backend');

  let sa, admin, adv1, adv2;
  await t.test('setup test users', async () => {
    sa = await login('phase17-admin@test.local', 'TestPass123!');
    assert.equal(sa.status, 200);
    const mk = async (name,email,role) => {
      const r = await api('/api/users', { method:'POST', token:sa.token, csrf:sa.csrf, body:{name,email,password:'TestPass123!',role}});
      assert.ok([201,409,400].includes(r.status), r.text); // 409 if rerun
      const l = await login(email,'TestPass123!');
      assert.equal(l.status,200);
      const id = r.json && r.json.user ? r.json.user.id : (l.json && l.json.id);
      return { ...l, email, role, id };
    };
    admin = await mk('P17 Admin','phase17-admin2@test.local','admin');
    adv1 = await mk('P17 Adv1','phase17-adv1@test.local','advisor');
    adv2 = await mk('P17 Adv2','phase17-adv2@test.local','advisor');
  });

  await t.test('role matrix: advisor blocked from admin endpoints', async () => {
    for (const [m,p,b] of [['GET','/api/users'],['GET','/api/audit'],['GET','/api/sessions'],['GET','/api/admin/store'],['GET','/api/admin/export'],['POST','/api/users',{name:'x',email:'x@t.local',password:'TestPass123!',role:'advisor'}]]) {
      const r = await api(p,{method:m,token:adv1.token,csrf:adv1.csrf,body:b});
      assert.ok([401,403].includes(r.status), `${m} ${p} got ${r.status}`);
    }
  });

  await t.test('ID tampering / cross-user session revocation blocked', async () => {
    const all = await api('/api/sessions?scope=all', { token: sa.token });
    assert.equal(all.status, 200);
    const adv2Sess = (all.json.sessions||[]).find(s => s.email === adv2.email && !s.current);
    if (adv2Sess) {
      const r = await api('/api/sessions/'+adv2Sess.id, { method:'DELETE', token:adv1.token, csrf:adv1.csrf });
      assert.equal(r.status, 403);
    }
  });

  await t.test('CSRF invalid rejected', async () => {
    const r = await api('/api/sessions/revoke-others', { method:'POST', token:adv1.token, csrf:'bad', body:{} });
    assert.equal(r.status, 403);
  });

  await t.test('invalid session rejected', async () => {
    const r = await api('/api/admin/store', { token:'bogus' });
    assert.equal(r.status, 401);
  });

  await t.test('admin cannot do super_admin-only actions', async () => {
    const r = await api('/api/admin/export', { token: admin.token });
    assert.equal(r.status, 403);
  });
});
