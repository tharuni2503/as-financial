'use strict';

/*
 * Tiny JSON datastore.
 * All data lives in data/db.json (a backup of the previous version is kept in
 * data/db.backup.json). Writes are synchronous and atomic: a temp file is
 * written first, then renamed over the live file.
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
const MAX_ENQUIRIES = 2000;

function emptyContent() {
  return { testimonials: [], gallery: [], posts: [], images: {} };
}

function emptyDb() {
  return { version: 1, updatedAt: null, content: emptyContent(), enquiries: [] };
}

let db = emptyDb();

function normalise(parsed) {
  const source = (parsed && parsed.content) || {};
  const content = emptyContent();

  SECTIONS.forEach((key) => {
    if (Array.isArray(source[key])) content[key] = source[key];
  });
  if (source.images && typeof source.images === 'object' && !Array.isArray(source.images)) {
    content.images = source.images;
  }

  return {
    version: 1,
    updatedAt: parsed && typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    content,
    enquiries: parsed && Array.isArray(parsed.enquiries) ? parsed.enquiries : []
  };
}

function load() {
  try {
    db = normalise(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[store] could not read db.json, starting with empty content:', error.message);
    }
    db = emptyDb();
  }
  return db;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db.updatedAt = new Date().toISOString();
  fs.writeFileSync(TMP_FILE, JSON.stringify(db, null, 2), 'utf8');
  if (fs.existsSync(DB_FILE)) {
    try {
      fs.copyFileSync(DB_FILE, BACKUP_FILE);
    } catch (error) {
      console.warn('[store] backup failed:', error.message);
    }
  }
  fs.renameSync(TMP_FILE, DB_FILE);
}

function content() {
  return db.content;
}

function setSection(section, value) {
  if (!SECTIONS.includes(section) && section !== 'images') {
    throw new Error('Unknown content section: ' + section);
  }
  db.content[section] = value;
  save();
  return db.content[section];
}

function addEnquiry(enquiry) {
  db.enquiries.unshift(enquiry);
  if (db.enquiries.length > MAX_ENQUIRIES) db.enquiries.length = MAX_ENQUIRIES;
  save();
  return enquiry;
}

function listEnquiries() {
  return db.enquiries;
}

function findEnquiry(id) {
  return db.enquiries.find((item) => item && item.id === id) || null;
}

function updateEnquiry(id, patch) {
  const enquiry = findEnquiry(id);
  if (!enquiry) return null;
  Object.assign(enquiry, patch);
  save();
  return enquiry;
}

function removeEnquiry(id) {
  const index = db.enquiries.findIndex((item) => item && item.id === id);
  if (index === -1) return false;
  db.enquiries.splice(index, 1);
  save();
  return true;
}

function stats() {
  const publishedTestimonials = db.content.testimonials.filter((item) => item && item.published).length;
  return {
    testimonials: db.content.testimonials.length,
    publishedTestimonials,
    gallery: db.content.gallery.length,
    posts: db.content.posts.length,
    images: Object.keys(db.content.images).length,
    enquiries: db.enquiries.length,
    unreadEnquiries: db.enquiries.filter((item) => item && !item.handled).length,
    updatedAt: db.updatedAt
  };
}

module.exports = {
  DATA_DIR,
  load,
  save,
  content,
  setSection,
  addEnquiry,
  listEnquiries,
  findEnquiry,
  updateEnquiry,
  removeEnquiry,
  stats
};
