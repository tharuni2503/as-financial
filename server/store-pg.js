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
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '001_init.sql'), 'utf8');
  await getPool().query(sql);
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

async function stats() {
  const c = await content();
  const a = await adminData();
  const eq = await getPool().query(
    'SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE NOT handled)::int AS unread FROM enquiries'
  );
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
  stats,
  describe
};
