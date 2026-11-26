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

function kolkataTodayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = {}; parts.forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });
  return map.year + '-' + map.month + '-' + map.day;
}
function addDaysISO(iso, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso||''));
  if (!m) throw new Error('bad iso: ' + iso);
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return dt.toISOString().slice(0, 10);
}

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not become healthy');
}
async function startServer() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-fur-'));
  const env = { ...process.env, NODE_ENV: 'development', PORT: String(PORT), DATABASE_URL: '', POSTGRES_URL: '', AS_DATA_DIR: tmpDir, ADMIN_EMAIL, ADMIN_PASSWORD, APP_URL: BASE, AS_API_RATE_LIMIT: '500' };
  child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  await waitForHealth();
}
async function stopServer() {
  if (child && !child.killed) { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); if (!child.killed) try { child.kill('SIGKILL'); } catch {} }
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
  return { status: res.status, json, headers: res.headers };
}

async function waitForAuditEntry(adminSession, type, predicate) {
  for (let i = 0; i < 30; i++) {
    const r = await api('/api/audit?type=' + encodeURIComponent(type) + '&limit=100', { token: adminSession.token });
    const found = ((r.json && r.json.entries) || []).find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

test('Follow-up reminder system', async (t) => {
  await startServer();
  t.after(async () => { await stopServer(); });

  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal(admin.status, 200);
  const today = kolkataTodayISO();
  const overdue = addDaysISO(today, -2);
  const upcoming = addDaysISO(today, 3);
  const far = addDaysISO(today, 10);
  let eOverdue, eToday, eUpcoming;

  await t.test('create enquiries with follow-up dates', async () => {
    const phones = { o: '9876543210', t: '9876543211', u: '9876543212' };
    for (const [name, date, key] of [['Overdue Lead', overdue, 'o'], ['Today Lead', today, 't'], ['Upcoming Lead', upcoming, 'u']]) {
      const res = await api('/api/enquiries', { method: 'POST', body: { name, phone: phones[key], email: key + '@example.com', product: 'Home Loan', amount: '500000', city: 'Hyderabad', message: 'test', source: 'Website form', consent: true, submissionId: 'sub-rem-' + key } });
      assert.ok(res.status === 201 || res.status === 200);
      const id = res.json.id;
      const p = await api('/api/enquiries/' + id, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpDate: date } });
      assert.equal(p.status, 200);
      if (key === 'o') eOverdue = id; if (key === 't') eToday = id; if (key === 'u') eUpcoming = id;
    }
  });

  await t.test('notifications endpoint generates overdue/today/upcoming reminders', async () => {
    const res = await api('/api/admin/notifications?limit=200', { token: admin.token });
    assert.equal(res.status, 200);
    const items = Array.isArray(res.json.items) ? res.json.items : [];
    const fu = items.filter(n => n.type === 'followup.reminder');
    assert.ok(fu.some(n => n.targetId === eOverdue && n.meta && n.meta.bucket === 'overdue'));
    assert.ok(fu.some(n => n.targetId === eToday && n.meta && n.meta.bucket === 'today'));
    assert.ok(fu.some(n => n.targetId === eUpcoming && n.meta && n.meta.bucket === 'upcoming'));
  });

  await t.test('duplicate reminder prevention is idempotent', async () => {
    const r1 = await api('/api/admin/notifications?limit=200', { token: admin.token });
    const r2 = await api('/api/admin/notifications?limit=200', { token: admin.token });
    const ids1 = (r1.json.items || []).filter(n => n.type === 'followup.reminder').map(n => n.id).sort();
    const ids2 = (r2.json.items || []).filter(n => n.type === 'followup.reminder').map(n => n.id).sort();
    assert.deepEqual(ids1, ids2);
  });

  await t.test('H1: refresh does not rescan unless data is dirty or explicitly refreshed', async () => {
    const forced = await api('/api/admin/notifications?limit=50&refresh=1', { token: admin.token });
    assert.equal(forced.status, 200);
    assert.equal(forced.headers.get('x-notification-sync'), 'forced');
    const cached = await api('/api/admin/notifications?limit=50', { token: admin.token });
    assert.equal(cached.headers.get('x-notification-sync'), 'skipped');

    const created = await api('/api/enquiries', { method: 'POST', body: { name: 'Gate Lead', phone: '9876543201', email: 'gate@example.com', product: 'Home Loan', amount: '500000', city: 'Hyderabad', message: 'test', source: 'Website form', consent: true, submissionId: 'sub-rem-gate' } });
    assert.equal(created.status, 201);
    await api('/api/enquiries/' + created.json.id, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpDate: today } });
    const afterWrite = await api('/api/admin/notifications?limit=50', { token: admin.token });
    assert.equal(afterWrite.headers.get('x-notification-sync'), 'ran');
    const cachedAgain = await api('/api/admin/notifications?limit=50', { token: admin.token });
    assert.equal(cachedAgain.headers.get('x-notification-sync'), 'skipped');
  });

  await t.test('H2: notification list is paginated on the server', async () => {
    for (let i = 0; i < 12; i++) {
      const made = await api('/api/admin/notifications', {
        method: 'POST', token: admin.token, csrf: admin.csrf,
        body: { title: 'QA page item ' + i, type: 'notification', message: 'synthetic pagination fixture', read: false }
      });
      assert.equal(made.status, 201);
    }
    const p1 = await api('/api/admin/notifications?limit=5&offset=0', { token: admin.token });
    const p2 = await api('/api/admin/notifications?limit=5&offset=5', { token: admin.token });
    assert.equal(p1.status, 200);
    assert.equal(p2.status, 200);
    assert.equal((p1.json.items || []).length, 5);
    assert.equal((p2.json.items || []).length, 5);
    assert.equal(p1.json.limit, 5);
    assert.equal(p1.json.offset, 0);
    assert.equal(p2.json.offset, 5);
    assert.ok(Number(p1.json.total) >= 12, 'server reports total independently of page size');
    assert.ok(p1.json.counts && Number.isFinite(Number(p1.json.counts.pending)), 'server returns pending counts');
    const ids1 = (p1.json.items || []).map(n => n.id);
    const ids2 = (p2.json.items || []).map(n => n.id);
    assert.equal(new Set(ids1.concat(ids2)).size, 10, 'pages do not overlap');
  });

  await t.test('H4: ownership-aware acknowledgement and dismissal are audited', async () => {
    const makeStaff = async (local) => {
      const email = local + '@test.local';
      const created = await api('/api/users', { method: 'POST', token: admin.token, csrf: admin.csrf, body: { name: local, email, password: 'TestPass123!', role: 'staff' } });
      assert.ok([201, 409].includes(created.status), JSON.stringify(created.json));
      const session = await login(email, 'TestPass123!');
      assert.equal(session.status, 200);
      return session;
    };
    const owner = await makeStaff('h4owner');
    const outsider = await makeStaff('h4other');

    const createNotification = async (title, ownerName) => {
      const made = await api('/api/admin/notifications', { method: 'POST', token: admin.token, csrf: admin.csrf, body: { title, type: 'notification', message: 'synthetic ownership fixture', owner: ownerName, read: false } });
      assert.equal(made.status, 201);
      return made.json.item;
    };
    const owned = await createNotification('H4 owned', 'h4owner');
    // Owner is a third identity so neither staff session can claim this record.
    const denied = await createNotification('H4 other owner', 'h4-third-party');

    const deniedAck = await api('/api/admin/notifications/' + encodeURIComponent(denied.id), { method: 'PATCH', token: outsider.token, csrf: outsider.csrf, body: { acknowledged: true } });
    assert.equal(deniedAck.status, 403);
    const deniedAudit = await waitForAuditEntry(admin, 'notification.permission_denied', (e) => e.targetId === denied.id && e.actorEmail === outsider.json.email);
    assert.ok(deniedAudit, 'denied action is audited with actor identity');

    const ack = await api('/api/admin/notifications/' + encodeURIComponent(owned.id), { method: 'PATCH', token: owner.token, csrf: owner.csrf, body: { acknowledged: true, read: true } });
    assert.equal(ack.status, 200);
    assert.equal(ack.json.item.acknowledged, true);
    assert.ok(ack.json.item.meta && ack.json.item.meta.acknowledgedBy && ack.json.item.meta.acknowledgedBy.email === owner.json.email);
    const ackAudit = await waitForAuditEntry(admin, 'notification.acknowledged', (e) => e.targetId === owned.id && e.actorEmail === owner.json.email);
    assert.ok(ackAudit, 'allowed acknowledgement is audited');

    const dismissal = await api('/api/admin/notifications/' + encodeURIComponent(owned.id), {
      method: 'PATCH', token: owner.token, csrf: owner.csrf, body: { dismissed: true, read: true }
    });
    assert.equal(dismissal.status, 200);
    assert.equal(dismissal.json.item.dismissed, true);
    const after = await api('/api/admin/notifications?limit=500', { token: admin.token });
    const persisted = (after.json.items || []).find(n => n.id === owned.id);
    assert.ok(persisted, 'dismissed notification remains in history');
    assert.equal(persisted.acknowledged, true, 'acknowledgement history survives dismissal');
    assert.equal(persisted.dismissed, true);
  });

  await t.test('acknowledge reminder persists and does not complete follow-up', async () => {
    const list = await api('/api/admin/notifications?limit=200', { token: admin.token });
    const n = (list.json.items || []).find(x => x.targetId === eToday && x.type === 'followup.reminder');
    assert.ok(n);
    let ack = await api('/api/admin/notifications/' + encodeURIComponent(n.id), { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { acknowledged: true, read: true } });
    if (ack.status === 404) {
      const list2 = await api('/api/admin/notifications?limit=200', { token: admin.token });
      const n2 = (list2.json.items || []).find(x => x.targetId === eToday && x.type === 'followup.reminder' && !x.acknowledged);
      if (n2) ack = await api('/api/admin/notifications/' + encodeURIComponent(n2.id), { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { acknowledged: true, read: true } });
    }
    if (ack.status !== 200) {
      const list3 = await api('/api/admin/notifications?limit=200', { token: admin.token });
      const rel = (list3.json.items||[]).filter(x=>x.targetId===eToday);
      throw new Error('ack failed ' + ack.status + ' body=' + JSON.stringify(ack.json) + ' related=' + JSON.stringify(rel.map(x=>({id:x.id,type:x.type,ack:x.acknowledged,dis:x.dismissed}))));
    }
    const enqList = await api('/api/enquiries', { token: admin.token });
    const enq = (enqList.json.enquiries || []).find(e => e.id === eToday);
    assert.ok(enq);
    assert.ok(!enq.followUpCompletedAt);
  });

  await t.test('dismissed reminder does not immediately reappear for same event', async () => {
    const list = await api('/api/admin/notifications?limit=200', { token: admin.token });
    const n = (list.json.items || []).find(x => x.targetId === eUpcoming && x.type === 'followup.reminder' && !x.dismissed);
    assert.ok(n);
    const d = await api('/api/admin/notifications/' + encodeURIComponent(n.id), { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { dismissed: true, read: true } });
    assert.equal(d.status, 200);
    const after = await api('/api/admin/notifications?limit=200', { token: admin.token });
    const same = (after.json.items || []).find(x => x.id === n.id);
    assert.ok(same);
    assert.equal(same.dismissed, true);
  });

  await t.test('reschedule creates new reminder event and stale pending removed', async () => {
    const before = await api('/api/admin/notifications?limit=200', { token: admin.token });
    const old = (before.json.items || []).find(x => x.targetId === eOverdue && x.type === 'followup.reminder' && !x.dismissed && !x.acknowledged);
    assert.ok(old);
    const p = await api('/api/enquiries/' + eOverdue, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpDate: far } });
    assert.equal(p.status, 200);
    const after = await api('/api/admin/notifications?limit=200', { token: admin.token });
    const items = after.json.items || [];
    assert.ok(!items.some(x => x.id === old.id && !x.dismissed && !x.acknowledged));
    // far is outside 7 days, so no new pending reminder expected
    assert.ok(!items.some(x => x.targetId === eOverdue && x.type === 'followup.reminder' && !x.dismissed && !x.acknowledged));
  });

  await t.test('completion removes pending reminder', async () => {
    // create a fresh one
    const res = await api('/api/enquiries', { method: 'POST', body: { name: 'Complete Lead', phone: '9876543210', email: 'c@example.com', product: 'Home Loan', amount: '500000', city: 'Hyderabad', message: 'test', source: 'Website form', consent: true, submissionId: 'sub-rem-c' } });
    const id = res.json.id;
    await api('/api/enquiries/' + id, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpDate: today } });
    await api('/api/admin/notifications?limit=200', { token: admin.token });
    const done = await api('/api/enquiries/' + id, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpCompleted: true } });
    assert.equal(done.status, 200);
    const after = await api('/api/admin/notifications?limit=200', { token: admin.token });
    assert.ok(!(after.json.items || []).some(x => x.targetId === id && x.type === 'followup.reminder' && !x.dismissed && !x.acknowledged));
  });

  await t.test('reschedule into window creates new reminder and old pending disappears', async () => {
    const res = await api('/api/enquiries', { method: 'POST', body: { name: 'Reschedule Lead', phone: '9876543299', email: 'r@example.com', product: 'Home Loan', amount: '500000', city: 'Hyderabad', message: 'test', source: 'Website form', consent: true, submissionId: 'sub-rem-r' } });
    assert.ok(res.status === 201 || res.status === 200);
    const id = res.json.id;
    const d1 = addDaysISO(today, 1);
    const d2 = addDaysISO(today, 2);
    await api('/api/enquiries/' + id, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpDate: d1 } });
    const first = await api('/api/admin/notifications?limit=200', { token: admin.token });
    const n1 = (first.json.items || []).find(x => x.targetId === id && x.type === 'followup.reminder' && !x.dismissed && !x.acknowledged);
    assert.ok(n1);
    assert.equal(n1.meta.followUpDate, d1);
    await api('/api/enquiries/' + id, { method: 'PATCH', token: admin.token, csrf: admin.csrf, body: { followUpDate: d2 } });
    const second = await api('/api/admin/notifications?limit=200', { token: admin.token });
    const items = second.json.items || [];
    assert.ok(!items.some(x => x.id === n1.id && !x.dismissed && !x.acknowledged));
    assert.ok(items.some(x => x.targetId === id && x.type === 'followup.reminder' && !x.dismissed && !x.acknowledged && x.meta && x.meta.followUpDate === d2));
  });

  await t.test('parallel notification fetches do not create duplicate reminders', async () => {
    const [a, b, c2] = await Promise.all([
      api('/api/admin/notifications?limit=200', { token: admin.token }),
      api('/api/admin/notifications?limit=200', { token: admin.token }),
      api('/api/admin/notifications?limit=200', { token: admin.token })
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(c2.status, 200);
    const ids = (a.json.items || []).map(x => x.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length);
  });

  await t.test('unauthorized access rejected', async () => {
    const res = await api('/api/admin/notifications?limit=20');
    assert.equal(res.status, 401);
  });
});


test('Follow-up reminder date boundary math (Asia/Kolkata, server-independent)', async (t) => {
  function kolkataDateISO(d) {
    const dt = d instanceof Date ? d : new Date(d);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(dt);
    const map = {}; parts.forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });
    return map.year + '-' + map.month + '-' + map.day;
  }
  function addDaysISO(iso, days) {
    const p = String(iso||'').split('-').map(Number);
    const dt = new Date(Date.UTC(p[0], p[1]-1, p[2]+days));
    return dt.toISOString().slice(0,10);
  }
  await t.test('month boundary', async () => {
    assert.equal(addDaysISO('2026-02-28', 1), '2026-03-01');
    assert.equal(addDaysISO('2026-04-30', 1), '2026-05-01');
  });
  await t.test('year boundary', async () => {
    assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01');
    assert.equal(addDaysISO('2027-01-01', -1), '2026-12-31');
  });
  await t.test('IST midnight boundary does not depend on server local timezone', async () => {
    // 2026-11-25 18:30:00Z is 2026-11-26 00:00:00 in Asia/Kolkata
    assert.equal(kolkataDateISO(new Date('2026-11-25T18:30:00Z')), '2026-11-26');
    // 2026-11-25 18:29:59Z is still 2026-11-25 in Asia/Kolkata
    assert.equal(kolkataDateISO(new Date('2026-11-25T18:29:59Z')), '2026-11-25');
  });
});

test('Notification retention preserves terminal-state history for every type', async (t) => {
  const { trimNotificationHistory } = require('../server/notification-history');

  const mk = (i, extra = {}) => Object.assign({
    id: 'N' + i,
    type: 'enquiry.new',
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()
  }, extra);

  await t.test('under the cap keeps every entry', async () => {
    const list = Array.from({ length: 10 }, (_, i) => mk(i));
    const out = trimNotificationHistory(list, 50);
    assert.equal(out.length, 10);
  });

  await t.test('over the cap drops the oldest non-history entries', async () => {
    const list = Array.from({ length: 20 }, (_, i) => mk(i));
    const out = trimNotificationHistory(list, 10);
    assert.equal(out.length, 10);
    // newest 10 kept
    assert.ok(out.some((n) => n.id === 'N19'));
    assert.ok(!out.some((n) => n.id === 'N0'));
  });

  await t.test('acknowledged and dismissed reminders survive trimming even when oldest', async () => {
    const history = [
      mk(0, { type: 'followup.reminder', acknowledged: true }),
      mk(1, { type: 'followup.reminder', dismissed: true }),
      mk(2, { type: 'followup.reminder', state: 'superseded' })
    ];
    const bulk = Array.from({ length: 30 }, (_, i) => mk(10 + i));
    const out = trimNotificationHistory(history.concat(bulk), 12);
    assert.equal(out.length, 12);
    assert.ok(out.some((n) => n.id === 'N0'), 'acknowledged reminder kept');
    assert.ok(out.some((n) => n.id === 'N1'), 'dismissed reminder kept');
    assert.ok(out.some((n) => n.id === 'N2'), 'superseded reminder kept');
    // Newest bulk entries kept, oldest dropped.
    assert.ok(out.some((n) => n.id === 'N39'));
    assert.ok(!out.some((n) => n.id === 'N10'));
  });

  await t.test('completed non-reminder notifications survive trimming', async () => {
    const history = [
      mk(0, { state: 'completed' }),
      mk(1, { state: 'superseded' })
    ];
    const bulk = Array.from({ length: 30 }, (_, i) => mk(10 + i));
    const out = trimNotificationHistory(history.concat(bulk), 12);
    assert.equal(out.length, 12);
    assert.ok(out.some((n) => n.id === 'N0'), 'completed notification kept');
    assert.ok(out.some((n) => n.id === 'N1'), 'superseded notification kept');
  });

  await t.test('history is never truncated below the cap, even if it alone exceeds it', async () => {
    const history = Array.from({ length: 15 }, (_, i) => mk(i, { type: 'followup.reminder', dismissed: true }));
    const out = trimNotificationHistory(history, 5);
    assert.equal(out.length, 15);
    const ids = new Set(out.map((n) => n.id));
    history.forEach((n) => assert.ok(ids.has(n.id)));
  });
});

test('Admin client requests one server-paginated notification page', () => {
  const fs = require('node:fs');
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  assert.ok(js.includes("api/admin/notifications?limit=' + notificationPageSize + '&offset='"), 'client supplies limit and offset');
  assert.ok(js.includes('data-action="notification-page"'), 'client renders a notification pager');
  assert.ok(!js.includes('api/admin/notifications?limit=500'), 'old full-page fetch removed');
  assert.ok(!js.includes('api/admin/notifications?limit=200'), 'old 200-item cap removed');
});

test('Notification generation is gated and reports sync status', () => {
  const fs = require('node:fs');
  const js = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  assert.ok(js.includes('function refreshNotificationData('), 'generation gate present');
  assert.ok(js.includes('res.setHeader(\'X-Notification-Sync\''), 'sync status is observable');
  assert.ok(js.includes('markNotificationDataDirty('), 'writes invalidate the gate');
  assert.ok(!/app\.get\('\/api\/admin\/:collection'[\s\S]{0,4000}await store\.syncFollowupReminders\(\{ today, next7 \}\)/.test(js), 'list route does not sync inline');
});

test('Notification navigation calls the defined setView helper', () => {
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  assert.ok(!/\bshowView\s*\(/.test(js), 'no call to undefined showView()');
  const go = /if \(action === 'go-notifications'\) \{[\s\S]*?\n\s*\}/.exec(js);
  assert.ok(go, 'go-notifications action present');
  assert.ok(/setView\('notifications'\)/.test(go[0]), 'View all notifications opens the notifications view');
  const openStart = js.indexOf("if (action === 'open-notification') {");
  const openEnd = js.indexOf("if (action === 'refresh-notifications')", openStart);
  assert.ok(openStart > -1 && openEnd > openStart, 'open-notification action present');
  assert.ok(/setView\('notifications'\)/.test(js.slice(openStart, openEnd)), 'notification fallback opens the notifications view');
});

test('Notifications view does not re-enter syncNotifications from renderAll', () => {
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'admin.js'), 'utf8');
  const renderStart = js.indexOf('function renderView(view) {');
  const renderEnd = js.indexOf('function syncSlaNotifications()', renderStart);
  assert.ok(renderStart > -1 && renderEnd > renderStart, 'renderView present');
  const renderBody = js.slice(renderStart, renderEnd);
  assert.ok(/view === 'notifications'\) renderNotifications\(\)/.test(renderBody), 'renderView only renders the notifications view');
  assert.ok(!/syncNotifications\(\)/.test(renderBody), 'renderView must not trigger a server fetch');

  const setStart = js.indexOf('function setView(view, skipHash) {');
  const setEnd = js.indexOf('function syncChartRefs()', setStart);
  assert.ok(setStart > -1 && setEnd > setStart, 'setView present');
  assert.ok(/if \(view === 'notifications'\) syncNotifications\(\)/.test(js.slice(setStart, setEnd)), 'navigation fetches notifications once');
});

