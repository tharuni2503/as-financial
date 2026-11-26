'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('PostgreSQL notification path is idempotent and concurrency-safe', () => {
  const sql = read('server/store-pg.js');
  assert.ok(sql.includes("pg_advisory_xact_lock(hashtext('notifications-sync'))"), 'sync uses a transaction-scoped advisory lock');
  assert.ok(/ON CONFLICT \(dedupe_key\) DO UPDATE/.test(sql), 'inserts are idempotent by dedupe key');
  assert.ok(/WHERE notifications\.state = 'superseded'/.test(sql), 'benign conflicts preserve acknowledgement/dismissal state');
  assert.ok(/SELECT \* FROM notifications WHERE dedupe_key = \$1 LIMIT 1/.test(sql), 'benign conflict returns the existing row');
  assert.ok(sql.includes('REQUIRED_NOTIFICATION_COLUMNS'), 'table mode requires the expected schema');
  assert.ok(/LIMIT \$[\s\S]{0,40}OFFSET \$/.test(sql), 'list query uses SQL LIMIT/OFFSET');
  assert.ok(sql.includes("meta->'acknowledgedBy'") && sql.includes("meta->'dismissedBy'"), 'actor metadata is persisted');
});

test('Pending notification migration keeps dedupe, indexes, and independent history', () => {
  const sql = read('server/migrations-pending/007_notifications.sql');
  assert.ok(/dedupe_key\s+TEXT NOT NULL UNIQUE/.test(sql), 'dedupe key is unique');
  assert.ok(/CREATE INDEX IF NOT EXISTS idx_notifications_pending/.test(sql), 'pending index present');
  assert.ok(/CREATE INDEX IF NOT EXISTS idx_notifications_state/.test(sql), 'state index present');
  assert.ok(sql.includes('acknowledged_at, dismissed_at'), 'backfill populates both history timestamps');
  assert.ok(/state IN \([^)]*'completed'[^)]*'superseded'/.test(sql), 'migration accepts every notification state');
  assert.ok(/WHEN lower\(COALESCE\(item->>'state', ''\)\) = 'completed'/.test(sql), 'backfill preserves completed state');
  assert.ok(/meta\.acknowledgedBy \/ meta\.dismissedBy/.test(sql), 'migration documents actor metadata');
  assert.ok(!fs.existsSync(path.join(ROOT, 'server', 'migrations', '007_notifications.sql')), 'migration is not auto-applied');
});

test('Ownership checks and audit events are enforced on notification mutations', () => {
  const js = read('server/index.js');
  assert.ok(js.includes('async function authorizeNotificationAction('), 'ownership helper present');
  assert.ok(js.includes("type: 'notification.permission_denied'"), 'denials are audited');
  assert.ok(js.includes("const action = acknowledged ? 'notification.acknowledged' : dismissed ? 'notification.dismissed' : 'notification.updated'"), 'acknowledgement and dismissal audit types are mapped');
  assert.ok(js.includes('audit(req, { type: action,'), 'mutation action is audited');
  assert.ok(js.includes("type: 'notification.dismissed'"), 'dismissals are audited');
  assert.ok(/roleAtLeast\(role, 'admin'\)/.test(js), 'admin role bypass is explicit');
});

test('Legacy JSON fallback keeps acknowledgement and dismissal history', () => {
  const js = read('server/index.js');
  assert.ok(/existing\.acknowledged \|\| existing\.acknowledgedAt/.test(js), 'acknowledgement cannot be cleared');
  assert.ok(/existing\.dismissed \|\| existing\.dismissedAt/.test(js), 'dismissal cannot be cleared');
  const helper = read('server/notification-history.js');
  assert.ok(helper.includes('trimNotificationHistory'), 'retention helper present');
  assert.ok(helper.includes("const TERMINAL_STATES = ['acknowledged', 'dismissed', 'completed', 'superseded']"), 'terminal states are protected for every notification type');
  assert.ok(helper.includes('if (TERMINAL_STATES.includes(state)) return true;'), 'state-based history is retained');
  assert.ok(js.includes("if (collection === 'notifications') items = trimNotificationHistory(items);"), 'JSON writes use history retention');
});

test('Whole-collection notification writes cannot replace server history', () => {
  const js = read('server/index.js');
  assert.ok(js.includes("if (name === 'notifications') {"), 'notification store PUT is guarded');
  assert.ok(js.includes('res.status(409).json({ ok: false, error: \'Notification history is server-authoritative.'), 'guarded PUT returns 409');
  assert.ok(js.includes('const allowedStates = [\'pending\', \'acknowledged\', \'dismissed\', \'completed\', \'superseded\']'), 'PATCH accepts the completed state');
});

test('Notification state counts come from the server for every state', () => {
  const js = read('server/index.js');
  assert.ok(js.includes('function notificationStateCounts(items)'), 'JSON state-count helper present');
  assert.ok(js.includes('payload.stateCounts = notificationStateCountsOut || notificationStateCounts(items);'), 'JSON response includes stateCounts');
  assert.ok(js.includes("if (state === 'unread') {"), 'JSON unread filter excludes terminal states');
  assert.ok(js.includes('stateCounts: page.stateCounts'), 'PG response includes stateCounts');
  const pg = read('server/store-pg.js');
  assert.ok(pg.includes('if (opts.unread) where.push(\'read = FALSE\');'), 'PG unread filter includes read=false');
  assert.ok(pg.includes("COUNT(*) FILTER (WHERE state = 'pending' AND read = FALSE)::int AS unread"), 'PG computes unread counts');
});

test('Paginated notification client never replaces the server collection', () => {
  const sync = read('assets/js/admin-sync.js');
  assert.ok(sync.includes('var SERVER_AUTHORITATIVE = { notifications: true }'), 'notifications are server-authoritative');
  assert.ok(sync.includes("if (sectionType === 'admin' && SERVER_AUTHORITATIVE[name]) return;"), 'whole-collection notification PUT is skipped');
  assert.ok(sync.includes("api.request(path, { method: 'PUT', body: value })"), 'other admin collections still sync');
  const admin = read('assets/js/admin.js');
  assert.ok(admin.includes("api.request('api/admin/notifications/' + encodeURIComponent(id)"), 'individual notification mutations use dedicated endpoints');
});
