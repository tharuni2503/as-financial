'use strict';

/*
 * JSON file datastore (default backend).
 * Data lives in data/db.json with a backup copy. Writes are atomic.
 * All public methods are async to match the store interface.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.AS_DATA_DIR
  ? path.resolve(process.env.AS_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = path.join(DATA_DIR, 'db.tmp.json');
const BACKUP_FILE = path.join(DATA_DIR, 'db.backup.json');

const SECTIONS = ['testimonials', 'gallery', 'posts'];
const ADMIN_COLLECTIONS = ['leads', 'products', 'partners', 'tasks', 'customers', 'documents', 'notifications'];
const MAX_ENQUIRIES = 2000;
const MAX_AUDIT = 2000;
const MAX_ANALYTICS_EVENTS = 5000;

function emptyContent() {
  return { testimonials: [], gallery: [], posts: [], images: {} };
}

function emptyAdmin() {
  return {
    leads: [],
    // applications removed
    products: [],
    partners: [],
    tasks: [],
    customers: [],
    documents: [],
    notifications: [],
    settings: {}
  };
}

function emptyAnalytics() {
  return { events: [] };
}

function emptyDb() {
  return { version: 5, updatedAt: null, content: emptyContent(), enquiries: [], admin: emptyAdmin(), users: [], sessions: {}, audit: [], security: {}, analytics: emptyAnalytics() };
}

let db = emptyDb();

function normalise(parsed) {
  const source = (parsed && parsed.content) || {};
  const adminSrc = (parsed && parsed.admin) || {};
  const content = emptyContent();
  const admin = emptyAdmin();

  SECTIONS.forEach((key) => {
    if (Array.isArray(source[key])) content[key] = source[key];
  });
  if (source.images && typeof source.images === 'object' && !Array.isArray(source.images)) {
    content.images = source.images;
  }

  ADMIN_COLLECTIONS.forEach((key) => {
    if (Array.isArray(adminSrc[key])) admin[key] = adminSrc[key];
  });
  if (adminSrc.settings && typeof adminSrc.settings === 'object' && !Array.isArray(adminSrc.settings)) {
    admin.settings = adminSrc.settings;
  }

  const sessions = parsed && parsed.sessions && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions)
    ? parsed.sessions : {};
  const security = parsed && parsed.security && typeof parsed.security === 'object' && !Array.isArray(parsed.security)
    ? parsed.security : {};
  const analyticsSrc = parsed && parsed.analytics && typeof parsed.analytics === 'object' && !Array.isArray(parsed.analytics)
    ? parsed.analytics : {};
  const analytics = {
    events: Array.isArray(analyticsSrc.events) ? analyticsSrc.events.slice(-MAX_ANALYTICS_EVENTS) : []
  };

  return {
    version: 5,
    updatedAt: parsed && typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    content,
    enquiries: parsed && Array.isArray(parsed.enquiries) ? parsed.enquiries : [],
    admin,
    users: parsed && Array.isArray(parsed.users) ? parsed.users : [],
    sessions,
    audit: parsed && Array.isArray(parsed.audit) ? parsed.audit.slice(0, MAX_AUDIT) : [],
    security,
    analytics
  };
}

async function load() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8').replace(/^\uFEFF/, '');
    db = normalise(JSON.parse(raw));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[store:json] could not read db.json, starting with empty content:', error.message);
    }
    db = emptyDb();
  }
  return db;
}

let persistWarningLogged = false;
async function save() {
  db.updatedAt = new Date().toISOString();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TMP_FILE, JSON.stringify(db, null, 2), 'utf8');
    if (fs.existsSync(DB_FILE)) {
      try { fs.copyFileSync(DB_FILE, BACKUP_FILE); } catch (error) { console.warn('[store:json] backup failed:', error.message); }
    }
    fs.renameSync(TMP_FILE, DB_FILE);
  } catch (error) {
    if (['EROFS', 'EACCES', 'EPERM', 'READONLY'].includes(error.code) || /read-?only/i.test(String(error.message || ''))) {
      if (!persistWarningLogged) {
        persistWarningLogged = true;
        console.warn('[store:json] persistence unavailable, running in-memory only:', error.message);
      }
      return;
    }
    throw error;
  }
}

async function content() {
  return db.content;
}

async function setSection(section, value) {
  if (!SECTIONS.includes(section) && section !== 'images') {
    throw new Error('Unknown content section: ' + section);
  }
  db.content[section] = value;
  await save();
  return db.content[section];
}

async function addEnquiry(enquiry) {
  db.enquiries.unshift(enquiry);
  if (db.enquiries.length > MAX_ENQUIRIES) db.enquiries.length = MAX_ENQUIRIES;
  await save();
  return enquiry;
}

async function listEnquiries() {
  return db.enquiries;
}

async function findEnquiry(id) {
  return db.enquiries.find((item) => item && item.id === id) || null;
}

async function updateEnquiry(id, patch) {
  const enquiry = await findEnquiry(id);
  if (!enquiry) return null;
  Object.assign(enquiry, patch);
  await save();
  return enquiry;
}

async function removeEnquiry(id) {
  const index = db.enquiries.findIndex((item) => item && item.id === id);
  if (index === -1) return false;
  db.enquiries.splice(index, 1);
  await save();
  return true;
}

async function adminData() {
  return db.admin;
}

async function setAdminCollection(name, value) {
  if (!ADMIN_COLLECTIONS.includes(name) && name !== 'settings') {
    throw new Error('Unknown admin collection: ' + name);
  }
  db.admin[name] = value;
  await save();
  return db.admin[name];
}

/* ---------------------------------------------------------------- users */

async function listUsers() {
  return db.users.slice();
}

async function findUserByEmail(email) {
  const needle = String(email || '').toLowerCase();
  return db.users.find((u) => u && String(u.email || '').toLowerCase() === needle) || null;
}

async function findUserById(id) {
  return db.users.find((u) => u && u.id === id) || null;
}

async function findUserByResetToken(token) {
  if (!token) return null;
  const raw = String(token);
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return db.users.find((u) => u && (u.resetToken === hash || u.resetToken === raw)) || null;
}

async function upsertUser(user) {
  if (!user || !user.id) throw new Error('User must have an id.');
  const index = db.users.findIndex((u) => u && u.id === user.id);
  const now = new Date().toISOString();
  const next = Object.assign({}, user, { updatedAt: now });
  if (!next.createdAt) next.createdAt = now;
  if (index === -1) db.users.push(next); else db.users[index] = Object.assign({}, db.users[index], next);
  await save();
  return db.users[index === -1 ? db.users.length - 1 : index];
}

async function deleteUser(id) {
  const index = db.users.findIndex((u) => u && u.id === id);
  if (index === -1) return false;
  db.users.splice(index, 1);
  await save();
  return true;
}

/* ------------------------------------------------------------- sessions */

async function getSession(token) {
  if (!token) return null;
  const session = db.sessions[token];
  return session || null;
}

async function allSessions() {
  return Object.assign({}, db.sessions);
}

async function saveSession(token, session) {
  if (!token || !session) return;
  db.sessions[token] = session;
  await save();
}

async function deleteSession(token) {
  if (!token) return false;
  if (!db.sessions[token]) return false;
  delete db.sessions[token];
  await save();
  return true;
}

async function deleteExpiredSessions() {
  const now = Date.now();
  let changed = false;
  Object.keys(db.sessions).forEach((token) => {
    const s = db.sessions[token];
    const exp = s && s.expiresAt ? (typeof s.expiresAt === 'number' ? s.expiresAt : Date.parse(s.expiresAt)) : 0;
    if (!exp || exp <= now) {
      delete db.sessions[token];
      changed = true;
    }
  });
  if (changed) await save();
  return changed;
}

function publicSession(session, token, currentToken) {
  if (!session) return null;
  const createdAt = typeof session.createdAt === 'number' ? session.createdAt : Date.parse(session.createdAt);
  const expiresAt = typeof session.expiresAt === 'number' ? session.expiresAt : Date.parse(session.expiresAt);
  const lastSeenAt = typeof session.lastSeenAt === 'number' ? session.lastSeenAt : Date.parse(session.lastSeenAt);
  return {
    id: session.id || null,
    email: session.email || '',
    role: session.role || '',
    userId: session.userId || null,
    createdAt: createdAt ? new Date(createdAt).toISOString() : null,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
    ip: session.ip || '',
    userAgent: session.userAgent || '',
    current: Boolean(currentToken && token && token === currentToken)
  };
}

async function listSessions(options) {
  const opts = options || {};
  const now = Date.now();
  const items = [];
  Object.keys(db.sessions).forEach((token) => {
    const s = db.sessions[token];
    if (!s) return;
    const exp = typeof s.expiresAt === 'number' ? s.expiresAt : Date.parse(s.expiresAt);
    if (!exp || exp <= now) return;
    if (opts.email && String(s.email || '').toLowerCase() !== String(opts.email).toLowerCase()) return;
    if (opts.userId && String(s.userId || '') !== String(opts.userId)) return;
    items.push(publicSession(s, token, opts.currentToken));
  });
  items.sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
  return items.slice(0, 200);
}

async function deleteSessionById(id) {
  if (!id) return false;
  const token = Object.keys(db.sessions).find((t) => db.sessions[t] && db.sessions[t].id === id);
  if (!token) return false;
  delete db.sessions[token];
  await save();
  return true;
}

async function deleteSessionsForEmail(email, exceptToken) {
  const needle = String(email || '').toLowerCase();
  if (!needle) return 0;
  let count = 0;
  Object.keys(db.sessions).forEach((token) => {
    const s = db.sessions[token];
    if (!s) return;
    if (String(s.email || '').toLowerCase() !== needle) return;
    if (exceptToken && token === exceptToken) return;
    delete db.sessions[token];
    count += 1;
  });
  if (count) await save();
  return count;
}

/* ---------------------------------------------------------------- audit */

async function addAudit(entry) {
  if (!entry) return null;
  const record = Object.assign({
    id: entry.id || ('AUD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase()),
    at: entry.at || new Date().toISOString(),
    type: String(entry.type || 'event'),
    actorEmail: String(entry.actorEmail || ''),
    actorUserId: entry.actorUserId || null,
    actorRole: String(entry.actorRole || ''),
    ip: String(entry.ip || ''),
    targetType: String(entry.targetType || ''),
    targetId: String(entry.targetId || ''),
    summary: String(entry.summary || ''),
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {}
  }, entry.id ? { id: entry.id } : {});
  db.audit.unshift(record);
  if (db.audit.length > MAX_AUDIT) db.audit.length = MAX_AUDIT;
  await save();
  return record;
}

async function listAudit(options) {
  const opts = options || {};
  let items = db.audit.slice();
  if (opts.type) items = items.filter((a) => a && a.type === opts.type);
  if (opts.actorEmail) items = items.filter((a) => a && String(a.actorEmail || '').toLowerCase() === String(opts.actorEmail).toLowerCase());
  const limit = Math.max(1, Math.min(Number(opts.limit) || 100, 500));
  return items.slice(0, limit);
}

/* ------------------------------------------------------------- security */

async function getSecurityState() {
  return db.security && typeof db.security === 'object' ? db.security : {};
}

async function setSecurityState(state) {
  db.security = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  await save();
  return db.security;
}

/* ------------------------------------------------------------- analytics */

function normalizeAnalyticsEvent(event) {
  const src = event && typeof event === 'object' ? event : {};
  const meta = src.meta && typeof src.meta === 'object' && !Array.isArray(src.meta) ? src.meta : {};
  return {
    id: String(src.id || ('AEV-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 7).toUpperCase())),
    eventId: String(src.eventId || src.event_id || '').slice(0, 120),
    at: src.at || new Date().toISOString(),
    type: String(src.type || '').slice(0, 40),
    page: String(src.page || '/').slice(0, 200),
    visitorId: String(src.visitorId || src.visitor_id || '').slice(0, 80),
    sessionId: String(src.sessionId || src.session_id || '').slice(0, 80),
    referrer: String(src.referrer || '').slice(0, 200),
    utmSource: String(src.utmSource || src.utm_source || meta.utm_source || '').slice(0, 80),
    utmMedium: String(src.utmMedium || src.utm_medium || meta.utm_medium || '').slice(0, 80),
    utmCampaign: String(src.utmCampaign || src.utm_campaign || meta.utm_campaign || '').slice(0, 120),
    deviceType: String(src.deviceType || src.device_type || '').slice(0, 40),
    ip: String(src.ip || '').slice(0, 128),
    ua: String(src.ua || '').slice(0, 200),
    meta
  };
}

async function addAnalyticsEvent(event) {
  if (!db.analytics || !Array.isArray(db.analytics.events)) db.analytics = emptyAnalytics();
  const record = normalizeAnalyticsEvent(event);
  if (record.eventId && db.analytics.events.some(e => e && e.eventId === record.eventId)) {
    return db.analytics.events.find(e => e && e.eventId === record.eventId);
  }
  db.analytics.events.push(record);
  if (db.analytics.events.length > MAX_ANALYTICS_EVENTS) {
    db.analytics.events = db.analytics.events.slice(-MAX_ANALYTICS_EVENTS);
  }
  await save();
  return record;
}

async function getAnalytics() {
  if (!db.analytics || !Array.isArray(db.analytics.events)) db.analytics = emptyAnalytics();
  return db.analytics;
}

async function stats() {
  const publishedTestimonials = db.content.testimonials.filter((item) => item && item.published).length;
  return {
    testimonials: db.content.testimonials.length,
    publishedTestimonials,
    gallery: db.content.gallery.length,
    posts: db.content.posts.length,
    images: Object.keys(db.content.images).length,
    enquiries: db.enquiries.length,
    unreadEnquiries: db.enquiries.filter((item) => item && !item.handled).length,
    leads: db.admin.leads.length,
    applications: 0,
    customers: Array.isArray(db.admin.customers) ? db.admin.customers.length : 0,
    documents: Array.isArray(db.admin.documents) ? db.admin.documents.length : 0,
    notifications: Array.isArray(db.admin.notifications) ? db.admin.notifications.length : 0,
    tasks: Array.isArray(db.admin.tasks) ? db.admin.tasks.length : 0,
    users: db.users.length,
    audit: db.audit.length,
    updatedAt: db.updatedAt
  };
}

function describe() {
  return {
    backend: 'json',
    location: path.join(DATA_DIR, 'db.json')
  };
}

module.exports = {
  DATA_DIR,
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
  describe
};
