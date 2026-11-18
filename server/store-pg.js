'use strict';

/*
 * PostgreSQL datastore backend.
 * Activated when DATABASE_URL (or POSTGRES_URL) is set.
 * Requires the `pg` package. Schema is auto-migrated on load.
 */

const fs = require('node:fs');
const path = require('node:path');

const SECTIONS = ['testimonials', 'gallery', 'posts'];
const ADMIN_COLLECTIONS = ['leads', 'applications', 'products', 'partners', 'tasks'];
const MAX_ENQUIRIES = 2000;
const MAX_AUDIT = 2000;

let pool = null;
let dbUrl = null;

function getPool() {
  if (pool) return pool;
  let pg;
  try {
    pg = require('pg');
  } catch (error) {
    throw new Error('PostgreSQL backend requires the "pg" package. Run: npm install pg');
  }
  const connectionString = dbUrl || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  pool = new pg.Pool({
    connectionString,
    ssl: /sslmode=require/i.test(connectionString) || process.env.PGSSLMODE === 'require'
      ? { rejectUnauthorized: false }
      : undefined
  });
  return pool;
}

async function migrate() {
  const dir = path.join(__dirname, 'migrations');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  } catch (e) {
    files = ['001_init.sql'];
  }
  if (!files.length) files = ['001_init.sql'];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await getPool().query(sql);
  }
}

function emptyContent() {
  return { testimonials: [], gallery: [], posts: [], images: {} };
}

function emptyAdmin() {
  return { leads: [], applications: [], products: [], partners: [], tasks: [], settings: {} };
}

async function getMetaUpdatedAt() {
  const res = await getPool().query('SELECT value FROM app_meta WHERE key = $1', ['updated_at']);
  return res.rows[0] ? res.rows[0].value : null;
}

async function touchUpdatedAt() {
  const now = new Date().toISOString();
  await getPool().query(
    'INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    ['updated_at', now]
  );
  return now;
}

async function load(url) {
  if (url) dbUrl = url;
  getPool();
  await migrate();
  return { backend: 'postgres' };
}

async function save() {
  await touchUpdatedAt();
}

async function content() {
  const res = await getPool().query('SELECT key, value FROM app_content');
  const out = emptyContent();
  res.rows.forEach((row) => {
    if (row.key === 'images' && row.value && typeof row.value === 'object' && !Array.isArray(row.value)) {
      out.images = row.value;
    } else if (SECTIONS.includes(row.key) && Array.isArray(row.value)) {
      out[row.key] = row.value;
    }
  });
  return out;
}

async function setSection(section, value) {
  if (!SECTIONS.includes(section) && section !== 'images') {
    throw new Error('Unknown content section: ' + section);
  }
  await getPool().query(
    'INSERT INTO app_content (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [section, JSON.stringify(value)]
  );
  await touchUpdatedAt();
  return value;
}

function rowToEnquiry(row) {
  return Object.assign({}, row.payload || {}, {
    id: row.id,
    receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
    handled: Boolean(row.handled),
    name: row.name || '',
    phone: row.phone || '',
    email: row.email || '',
    product: row.product || '',
    amount: row.amount || '',
    income: row.income || '',
    employment: row.employment || '',
    city: row.city || '',
    source: row.source || '',
    message: row.message || '',
    note: row.note || ''
  });
}

async function addEnquiry(enquiry) {
  await getPool().query(
    `INSERT INTO enquiries
      (id, received_at, handled, name, phone, email, product, amount, income, employment, city, source, message, note, payload, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,NOW())
     ON CONFLICT (id) DO NOTHING`,
    [
      enquiry.id,
      enquiry.receivedAt || new Date().toISOString(),
      Boolean(enquiry.handled),
      String(enquiry.name || ''),
      String(enquiry.phone || ''),
      String(enquiry.email || ''),
      String(enquiry.product || ''),
      String(enquiry.amount || ''),
      String(enquiry.income || ''),
      String(enquiry.employment || ''),
      String(enquiry.city || ''),
      String(enquiry.source || ''),
      String(enquiry.message || ''),
      String(enquiry.note || ''),
      JSON.stringify(enquiry)
    ]
  );
  // Trim to max
  await getPool().query(
    `DELETE FROM enquiries WHERE id IN (
       SELECT id FROM enquiries ORDER BY received_at DESC OFFSET $1
     )`,
    [MAX_ENQUIRIES]
  );
  await touchUpdatedAt();
  return enquiry;
}

async function listEnquiries() {
  const res = await getPool().query('SELECT * FROM enquiries ORDER BY received_at DESC LIMIT $1', [MAX_ENQUIRIES]);
  return res.rows.map(rowToEnquiry);
}

async function findEnquiry(id) {
  const res = await getPool().query('SELECT * FROM enquiries WHERE id = $1', [id]);
  return res.rows[0] ? rowToEnquiry(res.rows[0]) : null;
}

async function updateEnquiry(id, patch) {
  const current = await findEnquiry(id);
  if (!current) return null;
  const next = Object.assign({}, current, patch || {});
  await getPool().query(
    `UPDATE enquiries SET handled=$2, note=$3, payload=$4::jsonb, updated_at=NOW() WHERE id=$1`,
    [id, Boolean(next.handled), String(next.note || ''), JSON.stringify(next)]
  );
  await touchUpdatedAt();
  return next;
}

async function removeEnquiry(id) {
  const res = await getPool().query('DELETE FROM enquiries WHERE id = $1', [id]);
  if (res.rowCount > 0) await touchUpdatedAt();
  return res.rowCount > 0;
}

async function adminData() {
  const res = await getPool().query('SELECT key, value FROM app_admin');
  const out = emptyAdmin();
  res.rows.forEach((row) => {
    if (row.key === 'settings' && row.value && typeof row.value === 'object' && !Array.isArray(row.value)) {
      out.settings = row.value;
    } else if (ADMIN_COLLECTIONS.includes(row.key) && Array.isArray(row.value)) {
      out[row.key] = row.value;
    }
  });
  return out;
}

async function setAdminCollection(name, value) {
  if (!ADMIN_COLLECTIONS.includes(name) && name !== 'settings') {
    throw new Error('Unknown admin collection: ' + name);
  }
  await getPool().query(
    'INSERT INTO app_admin (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [name, JSON.stringify(value)]
  );
  await touchUpdatedAt();
  return value;
}

/* ---------------------------------------------------------------- users */

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name || '',
    role: row.role || 'advisor',
    salt: row.salt,
    hash: row.hash,
    active: row.active !== false,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    lastLoginAt: row.last_login_at instanceof Date ? row.last_login_at.toISOString() : (row.last_login_at || null),
    resetToken: row.reset_token || null,
    resetExpiresAt: row.reset_expires_at instanceof Date ? row.reset_expires_at.toISOString() : (row.reset_expires_at || null),
    passwordChangedAt: row.password_changed_at instanceof Date ? row.password_changed_at.toISOString() : (row.password_changed_at || null)
  };
}

async function listUsers() {
  const res = await getPool().query('SELECT * FROM users ORDER BY created_at ASC');
  return res.rows.map(rowToUser);
}

async function findUserByEmail(email) {
  const res = await getPool().query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [String(email || '')]);
  return res.rows[0] ? rowToUser(res.rows[0]) : null;
}

async function findUserById(id) {
  const res = await getPool().query('SELECT * FROM users WHERE id = $1', [id]);
  return res.rows[0] ? rowToUser(res.rows[0]) : null;
}

async function findUserByResetToken(token) {
  if (!token) return null;
  const res = await getPool().query('SELECT * FROM users WHERE reset_token = $1 LIMIT 1', [token]);
  return res.rows[0] ? rowToUser(res.rows[0]) : null;
}

async function upsertUser(user) {
  if (!user || !user.id) throw new Error('User must have an id.');
  const now = new Date();
  await getPool().query(
    `INSERT INTO users (id, email, name, role, salt, hash, active, created_at, updated_at, last_login_at, reset_token, reset_expires_at, password_changed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,NOW()),NOW(),$9::timestamptz,$10,$11::timestamptz,$12::timestamptz)
     ON CONFLICT (id) DO UPDATE SET
       email=EXCLUDED.email, name=EXCLUDED.name, role=EXCLUDED.role, salt=EXCLUDED.salt, hash=EXCLUDED.hash,
       active=EXCLUDED.active, updated_at=NOW(), last_login_at=EXCLUDED.last_login_at,
       reset_token=EXCLUDED.reset_token, reset_expires_at=EXCLUDED.reset_expires_at, password_changed_at=EXCLUDED.password_changed_at`,
    [
      user.id, String(user.email || '').toLowerCase(), String(user.name || ''), String(user.role || 'advisor'),
      String(user.salt || ''), String(user.hash || ''), user.active !== false,
      user.createdAt || null, user.lastLoginAt || null, user.resetToken || null, user.resetExpiresAt || null, user.passwordChangedAt || null
    ]
  );
  await touchUpdatedAt();
  return findUserById(user.id);
}

async function deleteUser(id) {
  const res = await getPool().query('DELETE FROM users WHERE id = $1', [id]);
  if (res.rowCount > 0) await touchUpdatedAt();
  return res.rowCount > 0;
}

/* ------------------------------------------------------------- sessions */

function rowToSession(row) {
  if (!row) return null;
  return {
    token: row.token,
    email: row.email,
    role: row.role || 'admin',
    csrfToken: row.csrf_token || '',
    userId: row.user_id || null,
    createdAt: row.created_at instanceof Date ? row.created_at.getTime() : Date.parse(row.created_at),
    expiresAt: row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(row.expires_at),
    lastSeenAt: row.last_seen_at instanceof Date ? row.last_seen_at.getTime() : Date.parse(row.last_seen_at),
    ip: row.ip || '',
    userAgent: row.user_agent || ''
  };
}

async function getSession(token) {
  if (!token) return null;
  const res = await getPool().query('SELECT * FROM sessions WHERE token = $1', [token]);
  return res.rows[0] ? rowToSession(res.rows[0]) : null;
}

async function allSessions() {
  const res = await getPool().query('SELECT * FROM sessions WHERE expires_at > NOW()');
  const out = {};
  res.rows.forEach((row) => { out[row.token] = rowToSession(row); });
  return out;
}

async function saveSession(token, session) {
  if (!token || !session) return;
  await getPool().query(
    `INSERT INTO sessions (token, email, role, csrf_token, user_id, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0),to_timestamp($7/1000.0),to_timestamp($8/1000.0),$9,$10)
     ON CONFLICT (token) DO UPDATE SET
       email=EXCLUDED.email, role=EXCLUDED.role, csrf_token=EXCLUDED.csrf_token, user_id=EXCLUDED.user_id,
       expires_at=EXCLUDED.expires_at, last_seen_at=EXCLUDED.last_seen_at, ip=EXCLUDED.ip, user_agent=EXCLUDED.user_agent`,
    [
      token,
      String(session.email || ''),
      String(session.role || 'admin'),
      String(session.csrfToken || ''),
      session.userId || null,
      Number(session.createdAt || Date.now()),
      Number(session.expiresAt || Date.now()),
      Number(session.lastSeenAt || Date.now()),
      String(session.ip || '').slice(0, 120),
      String(session.userAgent || '').slice(0, 400)
    ]
  );
}

async function deleteSession(token) {
  if (!token) return false;
  const res = await getPool().query('DELETE FROM sessions WHERE token = $1', [token]);
  return res.rowCount > 0;
}

async function deleteExpiredSessions() {
  const res = await getPool().query('DELETE FROM sessions WHERE expires_at <= NOW()');
  return res.rowCount > 0;
}

/* ---------------------------------------------------------------- audit */

async function addAudit(entry) {
  if (!entry) return null;
  const record = {
    id: entry.id || ('AUD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase()),
    at: entry.at || new Date().toISOString(),
    type: String(entry.type || 'event'),
    actorEmail: String(entry.actorEmail || ''),
    actorUserId: entry.actorUserId || null,
    actorRole: String(entry.actorRole || ''),
    ip: String(entry.ip || '').slice(0, 120),
    targetType: String(entry.targetType || ''),
    targetId: String(entry.targetId || ''),
    summary: String(entry.summary || '').slice(0, 500),
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {}
  };
  await getPool().query(
    `INSERT INTO audit_logs (id, at, type, actor_email, actor_user_id, actor_role, ip, target_type, target_id, summary, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [record.id, record.at, record.type, record.actorEmail, record.actorUserId, record.actorRole, record.ip, record.targetType, record.targetId, record.summary, JSON.stringify(record.meta)]
  );
  await getPool().query(
    `DELETE FROM audit_logs WHERE id IN (
       SELECT id FROM audit_logs ORDER BY at DESC OFFSET $1
     )`, [MAX_AUDIT]
  );
  return record;
}

async function listAudit(options) {
  const opts = options || {};
  const limit = Math.max(1, Math.min(Number(opts.limit) || 100, 500));
  const params = [];
  const where = [];
  if (opts.type) { params.push(String(opts.type)); where.push('type = $' + params.length); }
  if (opts.actorEmail) { params.push(String(opts.actorEmail).toLowerCase()); where.push('LOWER(actor_email) = $' + params.length); }
  params.push(limit);
  const sql = 'SELECT * FROM audit_logs' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY at DESC LIMIT $' + params.length;
  const res = await getPool().query(sql, params);
  return res.rows.map((row) => ({
    id: row.id,
    at: row.at instanceof Date ? row.at.toISOString() : row.at,
    type: row.type,
    actorEmail: row.actor_email || '',
    actorUserId: row.actor_user_id || null,
    actorRole: row.actor_role || '',
    ip: row.ip || '',
    targetType: row.target_type || '',
    targetId: row.target_id || '',
    summary: row.summary || '',
    meta: row.meta || {}
  }));
}

async function stats() {
  const c = await content();
  const a = await adminData();
  const eq = await getPool().query(
    'SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE NOT handled)::int AS unread FROM enquiries'
  );
  let userCount = 0;
  try {
    const ur = await getPool().query('SELECT COUNT(*)::int AS n FROM users');
    userCount = (ur.rows[0] && ur.rows[0].n) || 0;
  } catch (e) { /* table may not exist yet in old db */ }
  let auditCount = 0;
  try {
    const ar = await getPool().query('SELECT COUNT(*)::int AS n FROM audit_logs');
    auditCount = (ar.rows[0] && ar.rows[0].n) || 0;
  } catch (e) { /* table may not exist yet */ }
  const publishedTestimonials = c.testimonials.filter((item) => item && item.published).length;
  const row = eq.rows[0] || { total: 0, unread: 0 };
  return {
    testimonials: c.testimonials.length,
    publishedTestimonials,
    gallery: c.gallery.length,
    posts: c.posts.length,
    images: Object.keys(c.images || {}).length,
    enquiries: row.total || 0,
    unreadEnquiries: row.unread || 0,
    leads: a.leads.length,
    applications: a.applications.length,
    users: userCount,
    audit: auditCount,
    updatedAt: await getMetaUpdatedAt()
  };
}

function describe() {
  return {
    backend: 'postgres',
    location: dbUrl ? dbUrl.replace(/:\/\/[^@]*@/, '://***@') : 'DATABASE_URL'
  };
}

module.exports = {
  DATA_DIR: process.env.AS_DATA_DIR ? path.resolve(process.env.AS_DATA_DIR) : path.join(__dirname, '..', 'data'),
  ADMIN_COLLECTIONS,
  load,
  save,
  content,
  setSection,
  adminData,
  setAdminCollection,
  addEnquiry,
  listEnquiries,
  findEnquiry,
  updateEnquiry,
  removeEnquiry,
  listUsers,
  findUserByEmail,
  findUserById,
  findUserByResetToken,
  upsertUser,
  deleteUser,
  getSession,
  allSessions,
  saveSession,
  deleteSession,
  deleteExpiredSessions,
  addAudit,
  listAudit,
  stats,
  describe
};
