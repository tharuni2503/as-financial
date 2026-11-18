'use strict';

/*
 * JSON file datastore (default backend).
 * Data lives in data/db.json with a backup copy. Writes are atomic.
 * All public methods are async to match the store interface.
 */

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.AS_DATA_DIR
  ? path.resolve(process.env.AS_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = path.join(DATA_DIR, 'db.tmp.json');
const BACKUP_FILE = path.join(DATA_DIR, 'db.backup.json');

const SECTIONS = ['testimonials', 'gallery', 'posts'];
const ADMIN_COLLECTIONS = ['leads', 'applications', 'products', 'partners', 'tasks'];
const MAX_ENQUIRIES = 2000;

function emptyContent() {
  return { testimonials: [], gallery: [], posts: [], images: {} };
}

function emptyAdmin() {
  return {
    leads: [],
    applications: [],
    products: [],
    partners: [],
    tasks: [],
    settings: {}
  };
}

function emptyDb() {
  return { version: 3, updatedAt: null, content: emptyContent(), enquiries: [], admin: emptyAdmin(), users: [], sessions: {} };
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

  return {
    version: 3,
    updatedAt: parsed && typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    content,
    enquiries: parsed && Array.isArray(parsed.enquiries) ? parsed.enquiries : [],
    admin,
    users: parsed && Array.isArray(parsed.users) ? parsed.users : [],
    sessions
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

async function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db.updatedAt = new Date().toISOString();
  fs.writeFileSync(TMP_FILE, JSON.stringify(db, null, 2), 'utf8');
  if (fs.existsSync(DB_FILE)) {
    try {
      fs.copyFileSync(DB_FILE, BACKUP_FILE);
    } catch (error) {
      console.warn('[store:json] backup failed:', error.message);
    }
  }
  fs.renameSync(TMP_FILE, DB_FILE);
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
  return db.users.find((u) => u && u.resetToken === token) || null;
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
    const exp = s && s.expiresAt ? Date.parse(s.expiresAt) : 0;
    if (!exp || exp <= now) {
      delete db.sessions[token];
      changed = true;
    }
  });
  if (changed) await save();
  return changed;
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
    applications: db.admin.applications.length,
    users: db.users.length,
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
  stats,
  describe
};
