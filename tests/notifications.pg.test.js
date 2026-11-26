'use strict';

// PostgreSQL notification integration + concurrency checks.
// This test never applies migrations. It only runs against an explicitly
// confirmed isolated test database that already has the optional schema.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = 3197;
const BASE = `http://127.0.0.1:${PORT}`;

function kolkataTodayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = {};
  parts.forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });
  return map.year + '-' + map.month + '-' + map.day;
}
function addDaysISO(iso, days) {
  const p = String(iso).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + days)).toISOString().slice(0, 10);
}
function testDbUrl() {
  const raw = String(process.env.TEST_DATABASE_URL || '').trim();
  if (!raw) return '';
  if (process.env.I_UNDERSTAND_THIS_IS_A_TEST_DB !== 'yes') return '';
  let u;
  try { u = new URL(raw); } catch { return ''; }
  const identity = (u.pathname + ' ' + u.hostname).toLowerCase();
  if (/prod|production|live|customer/.test(identity)) return '';
  if (!/(test|staging|dev|local|ci)/.test(identity)) return '';
  return raw;
}
async function waitForHealth(timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return await r.json(); } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not become healthy');
}
function cookieToken(setCookie) { const m = String(setCookie || '').match(/as_session=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
async function login(email, password) {
  const r = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const json = await r.json().catch(() => null);
  return { status: r.status, json, token: cookieToken(r.headers.get('set-cookie')), csrf: json && json.csrfToken ? json.csrfToken : '' };
}
async function api(pathname, { method = 'GET', body, token, csrf } = {}) {
  const headers = {};
  if (token) headers.Cookie = `as_session=${encodeURIComponent(token)}`;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + pathname, { method, headers, body: payload });
  return { status: r.status, json: await r.json().catch(() => null), headers: r.headers };
}

test('PostgreSQL notification persistence and concurrency (isolated TEST DB only)', async (t) => {
  const url = testDbUrl();
  if (!url) {
    t.skip('Set TEST_DATABASE_URL and I_UNDERSTAND_THIS_IS_A_TEST_DB=yes for an isolated test database.');
    return;
  }
  const { Pool } = require('pg');
  const probe = new Pool({ connectionString: url, ssl: process.env.AS_PG_SSL === '1' ? { rejectUnauthorized: false } : undefined });
  let child = null;
  let tmpDir = null;
  const createdEnquiryIds = [];
  const createdNotificationIds = [];
  try {
    const identity = await probe.query('SELECT current_database() db, inet_server_addr()::text host');
    const row = identity.rows[0] || {};
    if (/prod|production|live|customer/.test(String(row.db || '') + String(row.host || ''))) {
      throw new Error('Refusing: connected database looks production-like.');
    }
    t.diagnostic(`DB identity: db=${row.db} host=${row.host || 'n/a'}`);

    const schema = await probe.query(
      "SELECT to_regclass('public.notifications') AS t, " +
      "(SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='enquiries' AND column_name IN ('follow_up_date','follow_up_completed_at')) AS cols"
    );
    const s = schema.rows[0] || {};
    if (!s.t || Number(s.cols) !== 2) {
      t.skip('Optional notifications schema is not present; this test does not apply migrations.');
      return;
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-npg-'));
    const env = {
      ...process.env,
      NODE_ENV: 'development', PORT: String(PORT), DATABASE_URL: url, POSTGRES_URL: url,
      AS_DATA_DIR: tmpDir, ADMIN_EMAIL: 'pg-notify-admin@test.local', ADMIN_PASSWORD: 'TestPass123!',
      APP_URL: BASE, AS_API_RATE_LIMIT: '2000'
    };
    child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
    const health = await waitForHealth();
    assert.equal(health.backend, 'postgres');

    const admin = await login('pg-notify-admin@test.local', 'TestPass123!');
    assert.equal(admin.status, 200);
    const today = kolkataTodayISO();

    await t.test('concurrent list requests produce no duplicate follow-up reminders', async () => {
      const dates = [addDaysISO(today, -1), today, addDaysISO(today, 2)];
      for (let i = 0; i < dates.length; i++) {
        const created = await api('/api/enquiries', { method: 'POST', body: {
          name: 'PG QA Lead ' + i, phone: '90000000' + String(10 + i), email: 'pgqa' + i + '@test.local',
          product: 'Home Loan', amount: '500000', city: 'Hyderabad', message: 'synthetic', source: 'Website form',
          consent: true, submissionId: 'pg-notify-' + i
        } });
        assert.equal(created.status, 201);
        createdEnquiryIds.push(created.json.id);
        const patched = await api('/api/enquiries/' + created.json.id, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpDate: dates[i] } });
        assert.equal(patched.status, 200);
      }
      await api('/api/admin/notifications?limit=50&refresh=1', { token: admin.token });
      const pages = await Promise.all(Array.from({ length: 8 }, () => api('/api/admin/notifications?limit=50', { token: admin.token })));
      pages.forEach((p) => assert.equal(p.status, 200));
      const reminders = (pages[0].json.items || []).filter(n => n.type === 'followup.reminder');
      const ids = reminders.map(n => String(n.id));
      assert.equal(new Set(ids).size, ids.length, 'no duplicate reminder IDs');
      for (const date of dates) {
        assert.ok(reminders.some(n => n.meta && n.meta.followUpDate === date), 'reminder generated for ' + date);
      }
    });

    await t.test('server-side pagination is stable in PostgreSQL mode', async () => {
      const p1 = await api('/api/admin/notifications?limit=2&offset=0', { token: admin.token });
      const p2 = await api('/api/admin/notifications?limit=2&offset=2', { token: admin.token });
      assert.equal(p1.status, 200);
      assert.equal(p2.status, 200);
      assert.equal((p1.json.items || []).length, 2);
      assert.equal((p2.json.items || []).length, 2);
      assert.ok(Number(p1.json.total) >= 4);
      assert.ok(p1.json.counts && Number.isFinite(Number(p1.json.counts.pending)));
      const all = (p1.json.items || []).concat(p2.json.items || []).map(n => n.id);
      assert.equal(new Set(all).size, all.length, 'pages do not overlap');
    });

    await t.test('concurrent idempotent inserts keep one row per dedupe key', async () => {
      const dedupeKey = 'testpg-concurrent:' + Date.now();
      const inserts = [];
      for (let i = 0; i < 12; i++) {
        const id = 'TESTPG-CONC-' + Date.now() + '-' + i;
        createdNotificationIds.push(id);
        inserts.push(probe.query(
          `INSERT INTO notifications (id, dedupe_key, type, title, target_type, target_id, state, read, meta)
           VALUES ($1,$2,'notification','Concurrency fixture','','', 'pending', FALSE,'{}'::jsonb)
           ON CONFLICT (dedupe_key) DO NOTHING`,
          [id, dedupeKey]
        ));
      }
      await Promise.all(inserts);
      const count = await probe.query('SELECT COUNT(*)::int AS n FROM notifications WHERE dedupe_key = $1', [dedupeKey]);
      assert.equal(count.rows[0].n, 1, 'unique dedupe key wins under concurrency');
    });

    await t.test('acknowledgement history survives in PostgreSQL table mode', async () => {
      const made = await api('/api/admin/notifications', {
        method: 'POST', token: admin.token, csrf: admin.csrf,
        body: { title: 'PG QA history', type: 'notification', message: 'synthetic', read: false }
      });
      assert.equal(made.status, 201);
      createdNotificationIds.push(made.json.item.id);
      const ack = await api('/api/admin/notifications/' + encodeURIComponent(made.json.item.id), {
        method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { acknowledged: true, read: true }
      });
      assert.equal(ack.status, 200);
      assert.equal(ack.json.item.acknowledged, true);
      assert.ok(ack.json.item.acknowledgedAt);
      const dismissed = await api('/api/admin/notifications/' + encodeURIComponent(made.json.item.id), {
        method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { dismissed: true }
      });
      assert.equal(dismissed.status, 200);
      assert.equal(dismissed.json.item.dismissed, true);
      assert.equal(dismissed.json.item.acknowledged, true, 'acknowledgement history retained after dismissal');
    });
  } finally {
    if (child && !child.killed) {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (!child.killed) { try { child.kill('SIGKILL'); } catch {} }
    }
    try {
      if (createdEnquiryIds.length) await probe.query('DELETE FROM notifications WHERE target_type = $1 AND target_id = ANY($2::text[])', ['enquiry', createdEnquiryIds]);
      if (createdNotificationIds.length) await probe.query('DELETE FROM notifications WHERE id = ANY($1::text[])', [createdNotificationIds]);
      if (createdEnquiryIds.length) await probe.query('DELETE FROM enquiries WHERE id = ANY($1::text[])', [createdEnquiryIds]);
    } catch (e) {
      t.diagnostic('cleanup failed: ' + (e && e.message ? e.message : e));
    }
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
    await probe.end();
  }
});
