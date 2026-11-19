'use strict';

/*
 * Import JSON datastore data (data/db.json) or an /api/admin/export snapshot
 * into PostgreSQL when DATABASE_URL/POSTGRES_URL is configured.
 *
 * Usage:
 *   node server/migrate-json-to-pg.js                 # imports data/db.json
 *   node server/migrate-json-to-pg.js path/to/file.json
 *   node server/migrate-json-to-pg.js --dry-run      # parse & report only
 *
 * Notes:
 * - Requires pg and a reachable DATABASE_URL/POSTGRES_URL (unless --dry-run).
 * - Exports from GET /api/admin/export are sanitized (no password hashes/salts,
 *   reset tokens, sessions, or security state), so user credentials/sessions
 *   cannot be restored from an export; use data/db.json for a full migration.
 * - Safe to re-run for most entities (upserts / conflict-ignore where applicable).
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DB = path.join(ROOT, 'data', 'db.json');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}

const DRY_RUN = process.argv.includes('--dry-run');
const sourceArg = process.argv.slice(2).find((a) => a && a !== '--dry-run' && a !== '--source' && process.argv[process.argv.indexOf(a) - 1] !== '--source') || argValue('--source') || DEFAULT_DB;
const SOURCE = path.isAbsolute(sourceArg) ? sourceArg : path.join(process.cwd(), sourceArg);

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function asArray(v) { return Array.isArray(v) ? v : []; }
function asObject(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

function detectFormat(data) {
  if (data && data.exportedAt && data.content && data.admin && !data.sessions && !data.security) return 'export';
  if (data && (data.content || data.enquiries || data.admin || data.users || data.sessions || data.audit)) return 'db';
  return 'unknown';
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('[migrate] source not found:', SOURCE);
    process.exit(1);
  }

  const data = readJson(SOURCE);
  const format = detectFormat(data);
  const content = asObject(data.content);
  const admin = asObject(data.admin);
  const enquiries = asArray(data.enquiries);
  const users = asArray(data.users);
  const audit = asArray(data.audit);
  const sessions = asObject(data.sessions); // db.json: { token: session }
  const security = asObject(data.security);

  const summary = {
    source: SOURCE,
    format,
    content: {
      testimonials: asArray(content.testimonials).length,
      gallery: asArray(content.gallery).length,
      posts: asArray(content.posts).length,
      images: Object.keys(asObject(content.images)).length
    },
    admin: {
      leads: asArray(admin.leads).length,
      applications: asArray(admin.applications).length,
      products: asArray(admin.products).length,
      partners: asArray(admin.partners).length,
      tasks: asArray(admin.tasks).length,
      settings: Object.keys(asObject(admin.settings)).length
    },
    enquiries: enquiries.length,
    users: users.length,
    usersWithCredentials: users.filter((u) => u && u.hash && u.salt).length,
    sessions: Object.keys(sessions).length,
    audit: audit.length,
    securityKeys: Object.keys(security).length
  };

  console.log('[migrate] source summary:', JSON.stringify(summary, null, 2));
  if (format === 'export') {
    console.warn('[migrate] WARNING: export snapshots do not include password hashes/salts, reset tokens, sessions, or security state. Use data/db.json for a full migration.');
  }

  if (DRY_RUN) {
    console.log('[migrate] dry-run complete (no changes made).');
    return;
  }

  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  if (!dbUrl) {
    console.error('[migrate] DATABASE_URL/POSTGRES_URL is not set. Set it to a PostgreSQL connection string, or use --dry-run.');
    process.exit(1);
  }

  const store = require('./store-pg');
  await store.load(dbUrl);
  console.log('[migrate] connected and migrated schema.');

  const counts = { content: 0, admin: 0, enquiries: 0, users: 0, usersSkipped: 0, sessions: 0, audit: 0, security: 0 };

  // Content
  for (const key of ['testimonials', 'gallery', 'posts']) {
    if (Array.isArray(content[key])) { await store.setSection(key, content[key]); counts.content += 1; }
  }
  if (content.images && typeof content.images === 'object' && !Array.isArray(content.images)) {
    await store.setSection('images', content.images); counts.content += 1;
  }

  // Admin collections + settings
  for (const key of ['leads', 'applications', 'products', 'partners', 'tasks']) {
    if (Array.isArray(admin[key])) { await store.setAdminCollection(key, admin[key]); counts.admin += 1; }
  }
  if (admin.settings && typeof admin.settings === 'object' && !Array.isArray(admin.settings)) {
    await store.setAdminCollection('settings', admin.settings); counts.admin += 1;
  }

  // Enquiries (oldest first so newest end up first in desc ordering naturally; addEnquiry unshifts in json but PG insert is fine either way)
  for (const e of enquiries.slice().reverse()) {
    if (!e || !e.id) continue;
    try { await store.addEnquiry(e); counts.enquiries += 1; } catch (err) { console.warn('[migrate] enquiry skipped', e.id, err.message); }
  }

  // Users (require credentials for real accounts; skip sanitized export users)
  for (const u of users) {
    if (!u || !u.id) continue;
    if (!u.hash || !u.salt) { counts.usersSkipped += 1; continue; }
    try { await store.upsertUser(u); counts.users += 1; } catch (err) { console.warn('[migrate] user skipped', u.id || u.email, err.message); }
  }

  // Sessions (db.json stores as { token: session })
  for (const token of Object.keys(sessions)) {
    const s = sessions[token];
    if (!token || !s) continue;
    try { await store.saveSession(token, Object.assign({ token }, s)); counts.sessions += 1; } catch (err) { console.warn('[migrate] session skipped', token.slice(0, 8), err.message); }
  }

  // Audit
  for (const a of audit.slice().reverse()) {
    if (!a) continue;
    try { await store.addAudit(a); counts.audit += 1; } catch (err) { console.warn('[migrate] audit skipped', a.id, err.message); }
  }

  // Security state
  if (Object.keys(security).length) {
    try { await store.setSecurityState(security); counts.security = 1; } catch (err) { console.warn('[migrate] security state skipped', err.message); }
  }

  // Preserve updatedAt marker if present
  if (data.updatedAt && store.save) {
    try { await store.save(); } catch (e) { /* ignore */ }
  }

  const finalStats = await store.stats();
  console.log('[migrate] import complete:', JSON.stringify({ counts, finalStats }, null, 2));
  console.log('[migrate] done. Verify with GET /api/health (backend should be "postgres").');

  // Close pool if exposed via pg internals (best-effort)
  try {
    const pg = require('pg');
    // no direct pool access; allow process to exit naturally
  } catch (e) { /* ignore */ }
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate] failed:', err && err.message ? err.message : err);
  process.exit(1);
});
