'use strict';

/*
 * PostgreSQL datastore backend.
 * Activated when DATABASE_URL (or POSTGRES_URL) is set.
 * Requires the `pg` package. Schema is auto-migrated on load.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SECTIONS = ['testimonials', 'gallery', 'posts', 'lenders'];
const ADMIN_COLLECTIONS = ['leads', 'applications', 'products', 'partners', 'tasks', 'customers', 'documents', 'notifications'];
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
  let connectionString = dbUrl || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const wantsSsl = /sslmode=(require|prefer|verify-ca|no-verify|allow)/i.test(connectionString)
    || /supabase\.(co|com)/i.test(connectionString)
    || /sslmode=/i.test(connectionString)
    || String(process.env.PGSSLMODE || '').length > 0
    || process.env.AS_PG_SSL === '1';
  const verify = /sslmode=verify-full/i.test(connectionString) || process.env.AS_PG_SSL_VERIFY === '1';
  if (wantsSsl && !verify) {
    // Avoid pg-connection-string / libpq sslmode parsing conflicts (common with Supabase cert chains).
    try {
      const u = new URL(connectionString);
      u.searchParams.delete('sslmode');
      u.searchParams.delete('uselibpqcompat');
      connectionString = u.toString();
    } catch (e) {
      connectionString = connectionString
        .replace(/([?&])sslmode=[^&]*/ig, '$1')
        .replace(/([?&])uselibpqcompat=[^&]*/ig, '$1')
        .replace(/[?&]$/, '');
    }
    // Keep encrypted TLS. Set PG_TLS_INSECURE=1 only when the environment requires relaxed verification.
  }
  const ssl = wantsSsl ? { rejectUnauthorized: !!verify } : undefined;
  pool = new pg.Pool({ connectionString, ssl });
  return pool;
}

async function migrate() {
  const dir = path.join(__dirname, 'migrations');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  } catch (e) {
    files = [];
  }
  if (!files.length) return;
  const pool = getPool();
  const client = await pool.connect();
  // Fixed advisory lock key for migration coordination across instances.
  const LOCK_KEY = 91427031;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const appliedRes = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedRes.rows.map((r) => r.filename));
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING', [file]);
      console.log('[migrate] applied', file);
    }
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

function emptyContent() {
  return { testimonials: [], gallery: [], posts: [], lenders: [], images: {} };
}

function emptyAdmin() {
  return { leads: [], applications: [], products: [], partners: [], tasks: [], customers: [], documents: [], notifications: [], settings: {} };
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

async function getSecurityState() {
  try {
    const res = await getPool().query('SELECT value FROM app_meta WHERE key = $1', ['security_state']);
    if (!res.rows[0] || !res.rows[0].value) return {};
    const parsed = JSON.parse(res.rows[0].value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    return {};
  }
}

async function setSecurityState(state) {
  const safe = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  await getPool().query(
    'INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    ['security_state', JSON.stringify(safe)]
  );
  return safe;
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
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return Object.assign({}, payload, {
    id: row.id,
    receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
    handled: Boolean(row.handled),
    status: row.status || payload.status || (row.handled ? 'Contacted' : 'New'),
    followUpDate: row.follow_up_date ? String(row.follow_up_date).slice(0, 10) : (payload.followUpDate || ''),
    followUpCompletedAt: row.follow_up_completed_at instanceof Date ? row.follow_up_completed_at.toISOString() : (row.follow_up_completed_at || payload.followUpCompletedAt || ''),
    followUpActivity: Array.isArray(row.follow_up_activity) ? row.follow_up_activity : (Array.isArray(payload.followUpActivity) ? payload.followUpActivity : []),
    consent: typeof row.consent === 'boolean' ? row.consent : Boolean(payload.consent),
    consentAt: row.consent_at instanceof Date ? row.consent_at.toISOString() : (row.consent_at || payload.consentAt || ''),
    submissionId: row.submission_id || payload.submissionId || '',
    internalNotes: Array.isArray(row.internal_notes) ? row.internal_notes : (Array.isArray(payload.internalNotes) ? payload.internalNotes : []),
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
  const payload = JSON.stringify(enquiry);
  const baseArgs = [
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
    payload
  ];
  const extArgs = baseArgs.concat([
    String(enquiry.status || (enquiry.handled ? 'Contacted' : 'New')),
    enquiry.followUpDate || null,
    Boolean(enquiry.consent),
    enquiry.consentAt || null,
    String(enquiry.submissionId || ''),
    JSON.stringify(Array.isArray(enquiry.internalNotes) ? enquiry.internalNotes : []),
    enquiry.followUpCompletedAt || null,
    JSON.stringify(Array.isArray(enquiry.followUpActivity) ? enquiry.followUpActivity : [])
  ]);
  try {
    await getPool().query(
      `INSERT INTO enquiries
        (id, received_at, handled, name, phone, email, product, amount, income, employment, city, source, message, note, payload, status, follow_up_date, consent, consent_at, submission_id, internal_notes, follow_up_completed_at, follow_up_activity, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21::jsonb,$22,$23::jsonb,NOW())
       ON CONFLICT (id) DO NOTHING`,
      extArgs
    );
  } catch (e) {
    if (!(e && e.code === '42703')) throw e;
    await getPool().query(
      `INSERT INTO enquiries
        (id, received_at, handled, name, phone, email, product, amount, income, employment, city, source, message, note, payload, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,NOW())
       ON CONFLICT (id) DO NOTHING`,
      baseArgs
    );
  }
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
  if (patch && patch.internalNote) {
    const notes = Array.isArray(next.internalNotes) ? next.internalNotes.slice() : [];
    notes.push(patch.internalNote);
    if (notes.length > 100) notes.splice(0, notes.length - 100);
    next.internalNotes = notes;
    delete next.internalNote;
  }
  if (patch && patch.followUpActivityEntry) {
    const activity = Array.isArray(next.followUpActivity) ? next.followUpActivity.slice() : [];
    const entry = patch.followUpActivityEntry;
    const dup = entry && entry.id ? activity.some(a => a && a.id === entry.id) : false;
    if (!dup) activity.push(entry);
    if (activity.length > 200) activity.splice(0, activity.length - 200);
    next.followUpActivity = activity;
    delete next.followUpActivityEntry;
  }
  if (next.status) next.handled = String(next.status) !== 'New';
  const payload = JSON.stringify(next);
  try {
    await getPool().query(
      `UPDATE enquiries
       SET handled=$2, note=$3, payload=$4::jsonb, status=$5, follow_up_date=$6, consent=$7, consent_at=$8, submission_id=$9, internal_notes=$10::jsonb, follow_up_completed_at=$11, follow_up_activity=$12::jsonb, updated_at=NOW()
       WHERE id=$1`,
      [
        id,
        Boolean(next.handled),
        String(next.note || ''),
        payload,
        String(next.status || (next.handled ? 'Contacted' : 'New')),
        next.followUpDate || null,
        Boolean(next.consent),
        next.consentAt || null,
        String(next.submissionId || ''),
        JSON.stringify(Array.isArray(next.internalNotes) ? next.internalNotes : []),
        next.followUpCompletedAt || null,
        JSON.stringify(Array.isArray(next.followUpActivity) ? next.followUpActivity : [])
      ]
    );
  } catch (e) {
    if (!(e && e.code === '42703')) throw e;
    await getPool().query(
      `UPDATE enquiries SET handled=$2, note=$3, payload=$4::jsonb, updated_at=NOW() WHERE id=$1`,
      [id, Boolean(next.handled), String(next.note || ''), payload]
    );
  }
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
  const raw = String(token);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const res = await getPool().query('SELECT * FROM users WHERE reset_token = $1 OR reset_token = $2 LIMIT 1', [hash, raw]);
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
    id: row.session_id || null,
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
    `INSERT INTO sessions (token, email, role, csrf_token, user_id, session_id, created_at, expires_at, last_seen_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),to_timestamp($8/1000.0),to_timestamp($9/1000.0),$10,$11)
     ON CONFLICT (token) DO UPDATE SET
       email=EXCLUDED.email, role=EXCLUDED.role, csrf_token=EXCLUDED.csrf_token, user_id=EXCLUDED.user_id, session_id=EXCLUDED.session_id,
       expires_at=EXCLUDED.expires_at, last_seen_at=EXCLUDED.last_seen_at, ip=EXCLUDED.ip, user_agent=EXCLUDED.user_agent`,
    [
      token,
      String(session.email || ''),
      String(session.role || 'admin'),
      String(session.csrfToken || ''),
      session.userId || null,
      session.id || null,
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

function publicSession(rowOrSession, currentToken) {
  if (!rowOrSession) return null;
  return {
    id: rowOrSession.id || null,
    email: rowOrSession.email || '',
    role: rowOrSession.role || '',
    userId: rowOrSession.userId || null,
    createdAt: rowOrSession.createdAt ? new Date(rowOrSession.createdAt).toISOString() : null,
    expiresAt: rowOrSession.expiresAt ? new Date(rowOrSession.expiresAt).toISOString() : null,
    lastSeenAt: rowOrSession.lastSeenAt ? new Date(rowOrSession.lastSeenAt).toISOString() : null,
    ip: rowOrSession.ip || '',
    userAgent: rowOrSession.userAgent || '',
    current: Boolean(currentToken && rowOrSession.token && rowOrSession.token === currentToken)
  };
}

async function listSessions(options) {
  const opts = options || {};
  const params = [];
  const where = ['expires_at > NOW()'];
  if (opts.email) { params.push(String(opts.email).toLowerCase()); where.push('LOWER(email) = $' + params.length); }
  if (opts.userId) { params.push(String(opts.userId)); where.push('user_id = $' + params.length); }
  const sql = 'SELECT * FROM sessions WHERE ' + where.join(' AND ') + ' ORDER BY last_seen_at DESC LIMIT 200';
  const res = await getPool().query(sql, params);
  return res.rows.map((row) => publicSession(rowToSession(row), opts.currentToken));
}

async function deleteSessionById(id) {
  if (!id) return false;
  const res = await getPool().query('DELETE FROM sessions WHERE session_id = $1', [String(id)]);
  return res.rowCount > 0;
}

async function deleteSessionsForEmail(email, exceptToken) {
  const needle = String(email || '').toLowerCase();
  if (!needle) return 0;
  if (exceptToken) {
    const res = await getPool().query('DELETE FROM sessions WHERE LOWER(email) = $1 AND token <> $2', [needle, exceptToken]);
    return res.rowCount || 0;
  }
  const res = await getPool().query('DELETE FROM sessions WHERE LOWER(email) = $1', [needle]);
  return res.rowCount || 0;
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
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
     ON CONFLICT (id) DO NOTHING`,
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

/* ------------------------------------------------------------- analytics */

function normalizeAnalyticsEvent(event) {
  const src = event && typeof event === 'object' ? event : {};
  const meta = src.meta && typeof src.meta === 'object' && !Array.isArray(src.meta) ? src.meta : {};
  return {
    id: String(src.id || ('AEV-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 7).toUpperCase())),
    eventId: String(src.eventId || src.event_id || ''),
    type: String(src.type || ''),
    page: String(src.page || '/').slice(0, 200),
    visitorId: String(src.visitorId || src.visitor_id || '').slice(0, 80),
    sessionId: String(src.sessionId || src.session_id || '').slice(0, 80),
    referrer: String(src.referrer || '').slice(0, 200),
    utmSource: String(src.utmSource || src.utm_source || meta.utm_source || '').slice(0, 80),
    utmMedium: String(src.utmMedium || src.utm_medium || meta.utm_medium || '').slice(0, 80),
    utmCampaign: String(src.utmCampaign || src.utm_campaign || meta.utm_campaign || '').slice(0, 120),
    deviceType: String(src.deviceType || src.device_type || '').slice(0, 40),
    ip: String(src.ip || src.ip_hash || '').slice(0, 128),
    ua: String(src.ua || '').slice(0, 200),
    meta,
    at: src.at || src.created_at || new Date().toISOString()
  };
}

async function addAnalyticsEvent(event) {
  const record = normalizeAnalyticsEvent(event);
  try {
    await getPool().query(
      `INSERT INTO analytics_events (id, event_id, type, page, visitor_id, session_id, referrer, utm_source, utm_medium, utm_campaign, device_type, ip_hash, meta, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (event_id) WHERE event_id IS NOT NULL AND event_id <> '' DO NOTHING`,
      [record.id, record.eventId || null, record.type, record.page, record.visitorId, record.sessionId, record.referrer, record.utmSource, record.utmMedium, record.utmCampaign, record.deviceType, record.ip, JSON.stringify(record.meta || {}), record.at]
    );
    return record;
  } catch (e) {
    // Fallback to legacy blob if table unavailable
    const MAX_ANALYTICS_EVENTS = 2000;
    const current = await getAnalyticsLegacyBlob();
    current.events.push(record);
    if (current.events.length > MAX_ANALYTICS_EVENTS) current.events = current.events.slice(-MAX_ANALYTICS_EVENTS);
    await getPool().query(
      'INSERT INTO app_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      ['analytics', JSON.stringify(current)]
    );
    return record;
  }
}

async function getAnalyticsLegacyBlob() {
  try {
    const res = await getPool().query('SELECT value FROM app_meta WHERE key = $1', ['analytics']);
    if (!res.rows[0] || !res.rows[0].value) return { events: [] };
    const parsed = JSON.parse(res.rows[0].value);
    const events = parsed && Array.isArray(parsed.events) ? parsed.events : [];
    return { events };
  } catch (e) {
    return { events: [] };
  }
}

async function getAnalytics() {
  try {
    const res = await getPool().query(
      `SELECT id, event_id, type, page, visitor_id, session_id, referrer, utm_source, utm_medium, utm_campaign, device_type, ip_hash, meta, created_at
       FROM analytics_events ORDER BY created_at DESC LIMIT 5000`
    );
    if (res.rows && res.rows.length) {
      const events = res.rows.map(r => ({
        id: r.id,
        eventId: r.event_id || '',
        type: r.type,
        page: r.page || '/',
        visitorId: r.visitor_id || '',
        sessionId: r.session_id || '',
        referrer: r.referrer || '',
        utmSource: r.utm_source || '',
        utmMedium: r.utm_medium || '',
        utmCampaign: r.utm_campaign || '',
        deviceType: r.device_type || '',
        ip: r.ip_hash || '',
        meta: r.meta && typeof r.meta === 'object' ? r.meta : {},
        at: r.created_at ? new Date(r.created_at).toISOString() : null
      })).reverse();
      return { events };
    }
  } catch (e) {
    // fall through to legacy blob
  }
  return getAnalyticsLegacyBlob();
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
    leads: (a.leads || []).length,
    applications: 0,
    customers: (a.customers || []).length,
    documents: (a.documents || []).length,
    notifications: (a.notifications || []).length,
    tasks: (a.tasks || []).length,
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


async function takeRateLimit(key, limit, windowMs) {
  const k = String(key || '').slice(0, 200);
  const lim = Math.max(1, Number(limit) || 1);
  const win = Math.max(1000, Number(windowMs) || 60000);
  const resetAt = new Date(Date.now() + win);
  const sql = `
    INSERT INTO rate_limits (key, count, reset_at)
    VALUES ($1, 1, $2)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.reset_at <= NOW() THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= NOW() THEN $2 ELSE rate_limits.reset_at END
    RETURNING count, reset_at`;
  const res = await getPool().query(sql, [k, resetAt.toISOString()]);
  const row = res.rows[0] || { count: 1, reset_at: resetAt };
  const count = Number(row.count) || 1;
  const ra = row.reset_at ? new Date(row.reset_at).getTime() : resetAt.getTime();
  return { allowed: count <= lim, count, limit: lim, resetAt: ra };
}
async function queryFollowUps(opts = {}) {
  const today = String(opts.today || '').slice(0, 10);
  const bucket = String(opts.bucket || 'all').toLowerCase();
  const status = String(opts.status || '').trim();
  const q = String(opts.q || '').trim().toLowerCase();
  const from = String(opts.from || '').slice(0, 10);
  const to = String(opts.to || '').slice(0, 10);
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(opts.pageSize) || 20));
  const offset = (page - 1) * pageSize;

  const where = ["(follow_up_date IS NOT NULL OR follow_up_completed_at IS NOT NULL)"];
  const params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$?', '$' + params.length)); };

  if (status) add('status = $?', status);
  if (q) { params.push('%' + q + '%'); const p = '$' + params.length; where.push('(LOWER(name) LIKE ' + p + ' OR LOWER(phone) LIKE ' + p + ' OR LOWER(email) LIKE ' + p + ' OR LOWER(id) LIKE ' + p + ' OR LOWER(product) LIKE ' + p + ')'); }
  if (from) add('follow_up_date >= $?::date', from);
  if (to) add('follow_up_date <= $?::date', to);

  if (bucket === 'completed') where.push('follow_up_completed_at IS NOT NULL');
  else if (bucket === 'overdue') { add('follow_up_date < $?::date', today); where.push('follow_up_completed_at IS NULL'); }
  else if (bucket === 'today') { add('follow_up_date = $?::date', today); where.push('follow_up_completed_at IS NULL'); }
  else if (bucket === 'tomorrow') { params.push(today); const p = '$' + params.length; where.push('follow_up_date = (' + p + '::date + INTERVAL \'1 day\')::date'); where.push('follow_up_completed_at IS NULL'); }
  else if (bucket === 'next7' || bucket === 'upcoming') { params.push(today); const p = '$' + params.length; where.push('follow_up_date > ' + p + '::date'); where.push('follow_up_date <= (' + p + '::date + INTERVAL \'7 day\')::date'); where.push('follow_up_completed_at IS NULL'); }
  else if (bucket === 'next30') { params.push(today); const p = '$' + params.length; where.push('follow_up_date > ' + p + '::date'); where.push('follow_up_date <= (' + p + '::date + INTERVAL \'30 day\')::date'); where.push('follow_up_completed_at IS NULL'); }
  else if (bucket === 'scheduled') where.push('follow_up_completed_at IS NULL');

  const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
  const countRes = await getPool().query('SELECT COUNT(*)::int AS total FROM enquiries ' + whereSql, params);
  const total = (countRes.rows[0] && countRes.rows[0].total) || 0;
  const listParams = params.concat([pageSize, offset]);
  const listRes = await getPool().query(
    'SELECT * FROM enquiries ' + whereSql + ' ORDER BY follow_up_date ASC NULLS LAST, received_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2),
    listParams
  );
  return { items: listRes.rows.map(rowToEnquiry), total, page, pageSize };
}

/* ------------------------------------------------- notifications table (optional) */
// Atomic, multi-instance-safe notification storage. Used only when the additive
// migration has been applied (see server/migrations-pending/007_notifications.sql).
// Falls back to the JSON app_admin collection when the table/columns are absent.
let _notificationsReady = null;
const REQUIRED_NOTIFICATION_COLUMNS = [
  'id', 'dedupe_key', 'type', 'title', 'message', 'target_type', 'target_id', 'state', 'read',
  'acknowledged_at', 'dismissed_at', 'meta', 'created_at', 'updated_at'
];
async function notificationsTableReady() {
  if (_notificationsReady !== null) return _notificationsReady;
  try {
    const res = await getPool().query(
      "SELECT to_regclass('public.notifications') AS t, " +
      "COALESCE((SELECT array_agg(column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='notifications'), '{}'::text[]) AS notification_cols, " +
      "(SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='enquiries' AND column_name IN ('follow_up_date','follow_up_completed_at')) AS cols"
    );
    const row = res.rows[0] || {};
    const cols = Array.isArray(row.notification_cols) ? row.notification_cols : [];
    _notificationsReady = !!(row.t && Number(row.cols) === 2 && REQUIRED_NOTIFICATION_COLUMNS.every(c => cols.includes(c)));
  } catch (e) {
    _notificationsReady = false;
  }
  return _notificationsReady;
}

function rowToNotification(row) {
  if (!row) return null;
  const state = String(row.state || 'pending');
  const acknowledged = state === 'acknowledged' || !!row.acknowledged_at;
  const dismissed = state === 'dismissed' || !!row.dismissed_at;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    targetType: row.target_type,
    targetId: row.target_id,
    read: !!row.read || acknowledged || dismissed,
    state,
    acknowledged,
    dismissed,
    superseded: state === 'superseded',
    acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at).toISOString() : '',
    dismissedAt: row.dismissed_at ? new Date(row.dismissed_at).toISOString() : '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
    meta: row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : {}
  };
}

async function syncFollowupReminders(opts = {}) {
  if (!(await notificationsTableReady())) return { ok: false, reason: 'table-missing' };
  const today = String(opts.today || '').slice(0, 10);
  const next7 = String(opts.next7 || '').slice(0, 10);
  if (!today || !next7) return { ok: false, reason: 'missing-dates' };
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('notifications-sync'))");
    await client.query(
      `INSERT INTO notifications
         (id, dedupe_key, type, title, message, target_type, target_id, state, read, meta, created_at, updated_at)
       SELECT
         'NTF-FU-' || e.id || '-' || (e.follow_up_date::date)::text,
         'followup:' || e.id || ':' || (e.follow_up_date::date)::text,
         'followup.reminder',
         CASE WHEN e.follow_up_date::date < $1::date THEN 'Overdue follow-up'
              WHEN e.follow_up_date::date = $1::date THEN 'Today''s follow-up'
              ELSE 'Upcoming follow-up' END,
         COALESCE(NULLIF(e.name, ''), 'Enquiry') || ' • ' || COALESCE(e.phone, '') || ' • ' || COALESCE(e.product, '') ||
           ' — follow-up ' || (e.follow_up_date::date)::text || '.',
         'enquiry', e.id, 'pending', FALSE,
         jsonb_build_object(
           'bucket', CASE WHEN e.follow_up_date::date < $1::date THEN 'overdue'
                          WHEN e.follow_up_date::date = $1::date THEN 'today'
                          ELSE 'upcoming' END,
           'followUpDate', (e.follow_up_date::date)::text,
           'enquiryStatus', COALESCE(e.status, ''),
           'reminderKey', 'followup:' || e.id || ':' || (e.follow_up_date::date)::text
         ),
         NOW(), NOW()
       FROM enquiries e
       WHERE e.follow_up_completed_at IS NULL
         AND e.follow_up_date IS NOT NULL
         AND e.follow_up_date::date <= $2::date
       ON CONFLICT (dedupe_key) DO UPDATE
         SET title = EXCLUDED.title,
             message = EXCLUDED.message,
             meta = EXCLUDED.meta,
             updated_at = NOW(),
             state = CASE WHEN notifications.state = 'superseded' THEN 'pending' ELSE notifications.state END,
             read = CASE WHEN notifications.state = 'superseded' THEN FALSE ELSE notifications.read END,
             acknowledged_at = CASE WHEN notifications.state = 'superseded' THEN NULL ELSE notifications.acknowledged_at END,
             dismissed_at = CASE WHEN notifications.state = 'superseded' THEN NULL ELSE notifications.dismissed_at END
         WHERE notifications.state IN ('pending', 'superseded')`,
      [today, next7]
    );
    await client.query(
      `UPDATE notifications n
         SET state = 'superseded', updated_at = NOW()
       WHERE n.type = 'followup.reminder'
         AND n.state = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM enquiries e
           WHERE e.id = n.target_id
             AND e.follow_up_completed_at IS NULL
             AND e.follow_up_date IS NOT NULL
             AND e.follow_up_date::date = NULLIF(n.meta->>'followUpDate', '')::date
             AND e.follow_up_date::date <= $1::date
         )`,
      [next7]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (e && (e.code === '42P01' || e.code === '42703' || e.code === '42710')) {
      _notificationsReady = false;
      return { ok: false, reason: 'schema-missing' };
    }
    throw e;
  } finally {
    client.release();
  }
}

async function listNotifications(opts = {}) {
  if (!(await notificationsTableReady())) return null;
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);
  const where = [];
  const params = [];
  if (opts.state) { params.push(String(opts.state)); where.push('state = $' + params.length); }
  if (opts.type) { params.push(String(opts.type)); where.push('type = $' + params.length); }
  if (opts.pending) where.push("state = 'pending'");
  if (opts.unread) where.push('read = FALSE');
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const countRes = await getPool().query('SELECT COUNT(*)::int AS total FROM notifications ' + whereSql, params);
  const counts = { overdue: 0, today: 0, upcoming: 0, completed: 0, pending: 0 };
  try {
    const bucketRes = await getPool().query(
      "SELECT COALESCE(meta->>'bucket', '') AS bucket, COUNT(*)::int AS c " +
      "FROM notifications WHERE type = 'followup.reminder' AND state = 'pending' GROUP BY 1"
    );
    bucketRes.rows.forEach((r) => { if (counts[r.bucket] !== undefined) counts[r.bucket] = Number(r.c) || 0; });
    const pendRes = await getPool().query(
      "SELECT COUNT(*)::int AS c FROM notifications WHERE type = 'followup.reminder' AND state = 'pending'"
    );
    counts.pending = (pendRes.rows[0] && Number(pendRes.rows[0].c)) || 0;
  } catch (e) { /* counts best effort */ }
  let stateCounts = { all: 0, pending: 0, unread: 0, acknowledged: 0, dismissed: 0, completed: 0, superseded: 0 };
  try {
    const stateRes = await getPool().query(
      "SELECT COUNT(*)::int AS all_count, " +
      "COUNT(*) FILTER (WHERE state = 'pending')::int AS pending, " +
      "COUNT(*) FILTER (WHERE state = 'pending' AND read = FALSE)::int AS unread, " +
      "COUNT(*) FILTER (WHERE state = 'acknowledged')::int AS acknowledged, " +
      "COUNT(*) FILTER (WHERE state = 'dismissed')::int AS dismissed, " +
      "COUNT(*) FILTER (WHERE state = 'completed')::int AS completed, " +
      "COUNT(*) FILTER (WHERE state = 'superseded')::int AS superseded " +
      "FROM notifications"
    );
    const row = (stateRes.rows && stateRes.rows[0]) || {};
    stateCounts = {
      all: Number(row.all_count) || 0,
      pending: Number(row.pending) || 0,
      unread: Number(row.unread) || 0,
      acknowledged: Number(row.acknowledged) || 0,
      dismissed: Number(row.dismissed) || 0,
      completed: Number(row.completed) || 0,
      superseded: Number(row.superseded) || 0
    };
  } catch (e) { /* state counts best effort */ }
  const listParams = params.concat([limit, offset]);
  const res = await getPool().query(
    'SELECT * FROM notifications ' + whereSql + ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) +
    ' OFFSET $' + (params.length + 2),
    listParams
  );
  return {
    items: res.rows.map(rowToNotification),
    total: (countRes.rows[0] && Number(countRes.rows[0].total)) || 0,
    counts,
    stateCounts,
    limit,
    offset
  };
}

async function insertNotificationIdempotent(n) {
  if (!(await notificationsTableReady())) return null;
  const id = String(n && n.id || '');
  const dedupeKey = String((n && (n.dedupeKey || n.id)) || '');
  if (!id || !dedupeKey) return null;
  const meta = Object.assign({}, n.meta && typeof n.meta === 'object' && !Array.isArray(n.meta) ? n.meta : {});
  const res = await getPool().query(
    `INSERT INTO notifications
       (id, dedupe_key, type, title, message, target_type, target_id, state, read, meta, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',FALSE,$8::jsonb,NOW(),NOW())
     ON CONFLICT (dedupe_key) DO UPDATE
       SET state = 'pending',
           read = FALSE,
           acknowledged_at = NULL,
           dismissed_at = NULL,
           title = EXCLUDED.title,
           message = EXCLUDED.message,
           meta = EXCLUDED.meta,
           updated_at = NOW()
       WHERE notifications.state = 'superseded'
     RETURNING *`,
    [id, dedupeKey, String(n.type || 'notification'), String(n.title || ''), String(n.message || ''),
      String(n.targetType || ''), String(n.targetId || ''), JSON.stringify(meta)]
  );
  if (res.rows[0]) return rowToNotification(res.rows[0]);
  // Benign conflict: the dedupe key already exists with a preserved history
  // state. Return that row so callers do not mistake it for a failed insert.
  const existing = await getPool().query('SELECT * FROM notifications WHERE dedupe_key = $1 LIMIT 1', [dedupeKey]);
  return existing.rows[0] ? rowToNotification(existing.rows[0]) : null;
}

async function getNotification(id) {
  if (!(await notificationsTableReady())) return null;
  const res = await getPool().query('SELECT * FROM notifications WHERE id = $1', [String(id)]);
  return res.rows[0] ? rowToNotification(res.rows[0]) : undefined;
}

async function updateNotificationState(id, patch = {}) {
  if (!(await notificationsTableReady())) return null;
  const state = patch.state || (patch.dismissed ? 'dismissed' : patch.acknowledged ? 'acknowledged' : null);
  const read = typeof patch.read === 'boolean' ? patch.read : null;
  const ack = !!patch.acknowledged || state === 'acknowledged';
  const dis = !!patch.dismissed || state === 'dismissed';
  const actor = JSON.stringify(patch.actor && typeof patch.actor === 'object' ? patch.actor : {});
  const res = await getPool().query(
    `UPDATE notifications
        SET state = COALESCE($2, state),
            read = CASE WHEN COALESCE($2, state) IN ('acknowledged', 'dismissed') THEN TRUE ELSE COALESCE($3, read) END,
            acknowledged_at = CASE WHEN $4 THEN COALESCE(acknowledged_at, NOW()) ELSE acknowledged_at END,
            dismissed_at = CASE WHEN $5 THEN COALESCE(dismissed_at, NOW()) ELSE dismissed_at END,
            meta = CASE WHEN $4 OR $5 THEN
              jsonb_set(
                jsonb_set(COALESCE(meta, '{}'::jsonb), '{acknowledgedBy}',
                  CASE WHEN $4 THEN $6::jsonb ELSE COALESCE(meta->'acknowledgedBy', 'null'::jsonb) END, true),
                '{dismissedBy}',
                  CASE WHEN $5 THEN $6::jsonb ELSE COALESCE(meta->'dismissedBy', 'null'::jsonb) END, true)
              ELSE meta END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [String(id), state, read, ack, dis, actor]
  );
  return res.rows[0] ? rowToNotification(res.rows[0]) : undefined;
}

async function deleteNotificationState(id, actor) {
  if (!(await notificationsTableReady())) return null;
  const actorJson = JSON.stringify(actor && typeof actor === 'object' ? actor : {});
  const upd = await getPool().query(
    `UPDATE notifications
        SET state = 'dismissed', read = TRUE, dismissed_at = COALESCE(dismissed_at, NOW()),
            meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{dismissedBy}', $2::jsonb, true),
            updated_at = NOW()
      WHERE id = $1 AND type = 'followup.reminder'
      RETURNING *`,
    [String(id), actorJson]
  );
  if (upd.rows[0]) return { item: rowToNotification(upd.rows[0]), dismissed: true };
  const del = await getPool().query('DELETE FROM notifications WHERE id = $1 RETURNING id', [String(id)]);
  return del.rows[0] ? { item: null, dismissed: false, deleted: true } : undefined;
}

async function supersedeSlaReminders(activeKeys) {
  if (!(await notificationsTableReady())) return null;
  const keys = Array.isArray(activeKeys) ? activeKeys.map(String) : [];
  const res = await getPool().query(
    `UPDATE notifications
        SET state = 'superseded', updated_at = NOW()
      WHERE type = 'lead.sla'
        AND state = 'pending'
        AND NOT (dedupe_key = ANY($1::text[]))`,
    [keys]
  );
  return Number(res.rowCount) || 0;
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
  listSessions,
  deleteSessionById,
  deleteSessionsForEmail,
  addAudit,
  listAudit,
  getSecurityState,
  setSecurityState,
  addAnalyticsEvent,
  getAnalytics,
  stats,
  describe,
  takeRateLimit,
  queryFollowUps,
  notificationsTableReady,
  syncFollowupReminders,
  listNotifications,
  getNotification,
  insertNotificationIdempotent,
  updateNotificationState,
  deleteNotificationState,
  supersedeSlaReminders
};
