'use strict';

/*
 * AS Financial Services and Solutions - site + content API.
 *
 * Serves the static site from the project root and exposes a small JSON API:
 *   GET    /api/health                 liveness probe
 *   POST   /api/login                  { email, password } -> session cookie + csrf
 *   POST   /api/logout                 revoke session (auth + csrf)
 *   GET    /api/session                who is signed in
 *   GET    /api/content[?scope=admin]  published content (admin scope needs auth)
 *   PUT    /api/content/:section       replace testimonials | gallery | posts | images (auth + csrf)
 *   GET    /api/admin/store            all admin collections (auth)
 *   PUT    /api/admin/store/:name      replace leads|applications|products|partners|tasks|settings (auth + csrf)
 *   GET    /api/admin/:collection      list/search collection items (auth)
 *   POST   /api/admin/:collection      create collection item (auth + csrf)
 *   GET    /api/admin/:collection/:id  get collection item (auth)
 *   PATCH  /api/admin/:collection/:id  update collection item (auth + csrf)
 *   DELETE /api/admin/:collection/:id  delete collection item (auth + csrf)
 *   POST   /api/admin/uploads          upload document file (base64 JSON, auth + csrf)
 *   GET    /api/admin/uploads/:file    download uploaded file (auth)
 *   POST   /api/enquiries              website enquiry (public, rate limited)
 *   GET    /api/enquiries              list enquiries (auth)
 *   PATCH  /api/enquiries/:id          mark handled / add a note (auth + csrf)
 *   DELETE /api/enquiries/:id          remove an enquiry (auth + csrf)
 *
 * Storage: PostgreSQL when DATABASE_URL/POSTGRES_URL is set, otherwise JSON file (data/db.json).
 */

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');

// Load environment variables from project root .env
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const store = require('./store');
const auth = require('./auth');
const validate = require('./validate');
const mailer = require('./mailer');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@asfinancial.in').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AS@2026';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
let BOOT_FATAL = null;

if (!process.env.ADMIN_PASSWORD) {
  if (IS_PRODUCTION) {
    BOOT_FATAL = '[auth] ADMIN_PASSWORD must be set when NODE_ENV=production. Refusing to start with the default demo password.';
    console.error(BOOT_FATAL);
  } else {
    console.warn('[auth] Using the default demo admin password. Set ADMIN_PASSWORD before going live.');
  }
}

async function ensureBootstrapUser() {
  if (typeof store.listUsers !== 'function') return;
  const users = await store.listUsers();
  if (users.length > 0) return;
  const user = {
    id: auth.randomId('USR'),
    email: ADMIN_EMAIL,
    name: 'Admin',
    role: 'super_admin',
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: null,
    resetToken: null,
    resetExpiresAt: null,
    passwordChangedAt: null
  };
  auth.setPassword(user, ADMIN_PASSWORD);
  await store.upsertUser(user);
  console.log('[auth] Bootstrapped super_admin user:', ADMIN_EMAIL);
}

function cookieSecure(req) {
  return Boolean(req.secure || (req.headers && req.headers['x-forwarded-proto'] === 'https') || IS_PRODUCTION);
}

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (cookieSecure(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json({ limit: '10mb' }));

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const started = Date.now();
  res.on('finish', () => {
    console.log('[api]', req.method, req.originalUrl, res.statusCode, (Date.now() - started) + 'ms');
  });
  next();
});

const enquiriesByIp = new Map();
const ENQUIRY_LIMIT = 6;
const ENQUIRY_WINDOW_MS = 10 * 60 * 1000;

function enquiryRateLimited(ip) {
  const now = Date.now();
  const hits = (enquiriesByIp.get(ip) || []).filter((time) => now - time < ENQUIRY_WINDOW_MS);
  hits.push(now);
  enquiriesByIp.set(ip, hits);
  if (enquiriesByIp.size > 5000) enquiriesByIp.clear();
  scheduleSecurityPersist(false);
  return hits.length > ENQUIRY_LIMIT;
}

async function requireSession(req, res, next) {
  try {
    const session = await auth.read(auth.tokenFrom(req));
    if (!session) {
      res.status(401).json({ error: 'Please sign in again.' });
      return;
    }
    req.session = session;
    req.authToken = auth.tokenFrom(req);
    next();
  } catch (err) {
    next(err);
  }
}

function requireCsrf(req, res, next) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const session = req.session;
  if (!session) {
    res.status(401).json({ error: 'Please sign in again.' });
    return;
  }
  const header = req.get('x-csrf-token') || req.get('x-xsrf-token') || '';
  if (!header || header !== session.csrfToken) {
    res.status(403).json({ error: 'Security check failed. Please refresh and sign in again.' });
    return;
  }
  next();
}

const ROLE_RANK = { advisor: 1, staff: 2, admin: 3, super_admin: 4 };

function roleAtLeast(role, minRole) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[minRole] || 99);
}

function requireRole(...roles) {
  const allowed = roles && roles.length ? roles : ['staff', 'admin', 'super_admin'];
  return (req, res, next) => {
    if (!req.session) {
      res.status(401).json({ error: 'Please sign in again.' });
      return;
    }
    const role = req.session.role || 'advisor';
    const ok = allowed.some((r) => role === r || roleAtLeast(role, r));
    if (!ok) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }
    next();
  };
}

let securitySaveTimer = null;

function pruneBucketMap(map, windowMs) {
  const now = Date.now();
  const w = windowMs || 15 * 60 * 1000;
  let changed = false;
  map.forEach((rec, key) => {
    const hits = Array.isArray(rec && rec.hits) ? rec.hits.filter((t) => now - Number(t) < w) : [];
    if (hits.length) { rec.hits = hits; } else { map.delete(key); changed = true; }
  });
  if (map.size > 5000) { map.clear(); changed = true; }
  return changed;
}

function serializeBucketMap(map, windowMs) {
  const now = Date.now();
  const w = windowMs || 15 * 60 * 1000;
  const out = {};
  map.forEach((rec, key) => {
    const hits = Array.isArray(rec && rec.hits) ? rec.hits.filter((t) => now - Number(t) < w).slice(-100) : [];
    if (hits.length) out[key] = { hits };
  });
  return out;
}

function loadBucketsFromState(state) {
  const sec = state && typeof state === 'object' ? state : {};
  const pw = sec.pwBuckets && typeof sec.pwBuckets === 'object' ? sec.pwBuckets : {};
  const enq = sec.enquiryBuckets && typeof sec.enquiryBuckets === 'object' ? sec.enquiryBuckets : {};
  Object.keys(pw).forEach((k) => { const hits = Array.isArray(pw[k] && pw[k].hits) ? pw[k].hits : []; if (hits.length) pwAttemptsByIp.set(k, { hits: hits.slice() }); });
  Object.keys(enq).forEach((k) => { const hits = Array.isArray(enq[k] && enq[k].hits) ? enq[k].hits : []; if (hits.length) enquiriesByIp.set(k, hits.slice()); });
  pruneBucketMap(pwAttemptsByIp, 15 * 60 * 1000);
  pruneBucketMap(enquiriesByIp, ENQUIRY_WINDOW_MS);
}

async function persistSecurityNow() {
  if (!store || typeof store.getSecurityState !== 'function' || typeof store.setSecurityState !== 'function') return;
  try {
    pruneBucketMap(pwAttemptsByIp, 15 * 60 * 1000);
    pruneBucketMap(enquiriesByIp, ENQUIRY_WINDOW_MS);
    const state = await store.getSecurityState() || {};
    state.pwBuckets = serializeBucketMap(pwAttemptsByIp, 15 * 60 * 1000);
    state.enquiryBuckets = serializeBucketMap(enquiriesByIp, ENQUIRY_WINDOW_MS);
    state.savedAt = Date.now();
    await store.setSecurityState(state);
  } catch (err) {
    console.warn('[security] persist failed:', err && err.message ? err.message : err);
  }
}

function scheduleSecurityPersist(immediate) {
  if (!store || typeof store.setSecurityState !== 'function') return;
  if (immediate) {
    if (securitySaveTimer) { clearTimeout(securitySaveTimer); securitySaveTimer = null; }
    Promise.resolve(persistSecurityNow()).catch(() => {});
    return;
  }
  if (securitySaveTimer) return;
  securitySaveTimer = setTimeout(() => {
    securitySaveTimer = null;
    Promise.resolve(persistSecurityNow()).catch(() => {});
  }, 3000);
  if (securitySaveTimer.unref) securitySaveTimer.unref();
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function audit(req, entry) {
  if (!store || typeof store.addAudit !== 'function') return;
  const session = req && req.session ? req.session : null;
  const payload = Object.assign({
    at: new Date().toISOString(),
    actorEmail: session ? (session.email || '') : '',
    actorUserId: session ? (session.userId || null) : null,
    actorRole: session ? (session.role || '') : '',
    ip: req && req.ip ? String(req.ip) : '',
    targetType: '',
    targetId: '',
    summary: '',
    meta: {}
  }, entry || {});
  Promise.resolve(store.addAudit(payload)).catch((err) => {
    console.warn('[audit] failed:', err && err.message ? err.message : err);
  });
}

/* ------------------------------------------------------------------ api */

app.get('/api/health', (req, res) => {
  const desc = typeof store.describe === 'function' ? store.describe() : { backend: store.BACKEND || 'unknown' };
  res.json({ ok: true, service: 'as-financial', backend: desc.backend, time: new Date().toISOString() });
});

app.post('/api/login', asyncRoute(async (req, res) => {
  const ip = req.ip || 'unknown';
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const acctKey = email ? ('acct:' + email) : '';
  if (auth.tooManyAttempts(ip) || (acctKey && auth.tooManyAttempts(acctKey))) {
    audit(req, { type: 'auth.login_rate_limited', actorEmail: email, summary: 'Login rate limited', meta: { ip } });
    res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
    return;
  }

  const password = String((req.body && req.body.password) || '');

  let user = null;
  if (store.findUserByEmail) user = await store.findUserByEmail(email);

  // Backward compat: if store has no user but env bootstrap would match (edge case before bootstrap ran)
  if (!user && email === ADMIN_EMAIL && auth.verifyPassword(auth.createCredential(ADMIN_EMAIL, ADMIN_PASSWORD), password)) {
    // ensure bootstrap exists
    await ensureBootstrapUser();
    user = await store.findUserByEmail(email);
  }

  const ok = user && user.active !== false && auth.verifyPassword(user, password);
  if (!ok) {
    auth.noteFailedAttempt(ip);
    if (acctKey) auth.noteFailedAttempt(acctKey);
    audit(req, { type: 'auth.login_failed', actorEmail: email, summary: 'Login failed', meta: { reason: user ? (user.active === false ? 'inactive' : 'bad_password') : 'unknown_user' } });
    res.status(401).json({ error: 'Those details do not match our records.' });
    return;
  }

  auth.clearAttempts(ip);
  if (acctKey) auth.clearAttempts(acctKey);
  user.lastLoginAt = new Date().toISOString();
  if (store.upsertUser) await store.upsertUser(user);

  const issued = await auth.issue(user.email, user.role || 'admin', {
    userId: user.id,
    ip,
    userAgent: req.get('user-agent') || ''
  });
  audit(req, { type: 'auth.login', actorEmail: user.email, actorUserId: user.id, actorRole: user.role || 'admin', summary: 'User signed in', targetType: 'user', targetId: user.id });
  res.setHeader('Set-Cookie', auth.cookieHeader(issued.token, { maxAgeMs: auth.SESSION_TTL_MS, secure: cookieSecure(req) }));
  const pub = auth.publicUser ? auth.publicUser(user) : { email: user.email, role: user.role };
  res.json(Object.assign({ ok: true, csrfToken: issued.csrfToken, expiresIn: auth.SESSION_TTL_MS }, pub));
}));

app.post('/api/logout', requireSession, requireCsrf, asyncRoute(async (req, res) => {
  audit(req, { type: 'auth.logout', summary: 'User signed out', targetType: 'user', targetId: req.session.userId || '' });
  await auth.revoke(auth.tokenFrom(req));
  res.setHeader('Set-Cookie', auth.clearCookieHeader(cookieSecure(req)));
  res.json({ ok: true });
}));

app.get('/api/session', asyncRoute(async (req, res) => {
  const session = await auth.read(auth.tokenFrom(req));
  if (!session) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  let user = null;
  if (session.userId && store.findUserById) user = await store.findUserById(session.userId);
  if (!user && store.findUserByEmail) user = await store.findUserByEmail(session.email);
  res.json({
    sessionId: session.id || null,
    email: session.email,
    role: session.role || 'admin',
    userId: session.userId || (user && user.id) || null,
    name: user ? (user.name || '') : '',
    csrfToken: session.csrfToken || '',
    expiresAt: new Date(session.expiresAt).toISOString()
  });
}));

function partnerCategory(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('public')) return 'psu';
  if (t.includes('private')) return 'private';
  return 'nbfc';
}

function partnerToLender(p) {
  const name = String((p && p.name) || '').trim();
  if (!name) return null;
  const rateNum = Number(p && p.rate);
  const displayRate = String((p && p.interestRate) || '').trim() || (Number.isFinite(rateNum) && rateNum > 0 ? (rateNum.toFixed(2).replace(/\.00$/, '') + '% p.a. onwards*') : 'Indicative*');
  return {
    n: name,
    c: partnerCategory(p && p.type),
    logo: String((p && p.logo) || '').trim(),
    r: displayRate,
    t: String((p && p.tenure) || '').trim() || 'As per lender*',
    amt: String((p && p.amount) || '').trim() || 'As per profile & product*',
    fee: String((p && p.fee) || '').trim() || 'As per lender schedule*',
    b: Array.isArray(p && p.benefits) ? p.benefits.filter(Boolean).slice(0, 8) : [],
    p: Array.isArray(p && p.products) ? p.products.filter(Boolean).slice(0, 12) : [],
    active: p ? p.active !== false : true,
    published: true,
    source: 'partner'
  };
}

function mergeLendersWithPartners(contentLenders, adminPartners, includeInactive) {
  const out = [];
  const seen = new Set();
  const push = (item) => {
    if (!item) return;
    const name = String(item.n || item.name || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };
  (Array.isArray(contentLenders) ? contentLenders : []).forEach((l) => {
    if (!includeInactive && (l.active === false || l.published === false)) return;
    push(l);
  });
  (Array.isArray(adminPartners) ? adminPartners : []).forEach((p) => {
    if (!includeInactive && p && p.active === false) return;
    push(partnerToLender(p));
  });
  return out;
}

app.get('/api/content', asyncRoute(async (req, res) => {
  const session = await auth.read(auth.tokenFrom(req));
  const wantsAdmin = req.query.scope === 'admin';
  const canViewAdmin = Boolean(session) && roleAtLeast(session.role || 'advisor', 'staff');
  const admin = wantsAdmin && canViewAdmin;
  const content = await store.content();
  const stats = await store.stats();
  const adminData = await store.adminData();
  const lenders = mergeLendersWithPartners(content.lenders || [], adminData.partners || [], admin);

  res.json({
    scope: admin ? 'admin' : 'public',
    updatedAt: stats.updatedAt,
    testimonials: admin ? content.testimonials : content.testimonials.filter((item) => item && item.published),
    gallery: content.gallery,
    posts: admin ? content.posts : content.posts.filter((item) => item && item.published),
    lenders,
    images: content.images
  });
}));

app.put('/api/content/:section', requireSession, requireRole('staff', 'admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const section = String(req.params.section || '').toLowerCase();
  const value = validate.content(section, req.body);
  await store.setSection(section, value);
  const stats = await store.stats();
  const count = Array.isArray(value) ? value.length : Object.keys(value).length;
  audit(req, { type: 'content.published', summary: 'Published content: ' + section, targetType: 'content', targetId: section, meta: { section, count } });
  res.json({ ok: true, section, count, updatedAt: stats.updatedAt });
}));

app.post('/api/enquiries', asyncRoute(async (req, res) => {
  const ip = req.ip || 'unknown';
  if (enquiryRateLimited(ip)) {
    res.status(429).json({ error: 'Too many enquiries from this connection. Please call us instead.' });
    return;
  }

  const data = validate.enquiry(req.body);
  if (!data) {
    res.status(201).json({ ok: true, id: null });
    return;
  }

  const enquiry = Object.assign(
    {
      id: 'ENQ-' + Date.now().toString(36).toUpperCase(),
      receivedAt: new Date().toISOString(),
      handled: false
    },
    data
  );

  await store.addEnquiry(enquiry);
  console.log('[enquiry]', enquiry.id, enquiry.name, enquiry.phone, enquiry.product);
  audit(req, { type: 'enquiry.created', actorEmail: '', summary: 'Website enquiry received: ' + (enquiry.product || 'General'), targetType: 'enquiry', targetId: enquiry.id, meta: { product: enquiry.product || '', source: enquiry.source || '', city: enquiry.city || '' } });

  // Create an in-app notification for staff (best-effort).
  try {
    if (store.adminData && store.setAdminCollection) {
      const admin = await store.adminData();
      const notifications = Array.isArray(admin.notifications) ? admin.notifications.slice() : [];
      notifications.unshift({
        id: 'NTF-' + Date.now().toString(36).toUpperCase(),
        type: 'enquiry.new',
        title: 'New enquiry received',
        message: [enquiry.name, enquiry.phone, enquiry.product].filter(Boolean).join(' • ').slice(0, 240),
        targetType: 'enquiry',
        targetId: enquiry.id,
        read: false,
        createdAt: enquiry.receivedAt
      });
      if (notifications.length > 500) notifications.length = 500;
      await store.setAdminCollection('notifications', notifications);
    }
  } catch (e) {
    console.warn('[notify] failed to create enquiry notification:', e && e.message ? e.message : e);
  }

  res.status(201).json({ ok: true, id: enquiry.id });
}));

app.get('/api/enquiries', requireSession, requireRole('advisor', 'staff', 'admin', 'super_admin'), asyncRoute(async (req, res) => {
  let enquiries = await store.listEnquiries();
  const stats = await store.stats();

  const q = validate.text(req.query.q, 120).toLowerCase();
  const handled = typeof req.query.handled === 'string' ? req.query.handled.toLowerCase() : '';
  if (handled === 'true' || handled === 'false') {
    const want = handled === 'true';
    enquiries = enquiries.filter((e) => Boolean(e && e.handled) === want);
  }
  if (q) {
    enquiries = enquiries.filter((e) => {
      const hay = [e && e.id, e && e.name, e && e.phone, e && e.email, e && e.product, e && e.city, e && e.message, e && e.source]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  const total = enquiries.length;
  const hasLimit = req.query.limit !== undefined || req.query.offset !== undefined || req.query.page !== undefined;
  let limit = Number(req.query.limit);
  if (!Number.isFinite(limit) || limit <= 0) limit = hasLimit ? 50 : total || 0;
  limit = Math.max(1, Math.min(limit, 500));
  let offset = Number(req.query.offset);
  if (!Number.isFinite(offset) || offset < 0) {
    const page = Number(req.query.page);
    offset = Number.isFinite(page) && page > 0 ? Math.floor((page - 1) * limit) : 0;
  }
  offset = Math.max(0, Math.floor(offset));
  const paged = hasLimit ? enquiries.slice(offset, offset + limit) : enquiries;

  res.json({ enquiries: paged, total, count: paged.length, limit: hasLimit ? limit : total, offset: hasLimit ? offset : 0, stats });
}));

app.patch('/api/enquiries/:id', requireSession, requireRole('advisor', 'staff', 'admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const patch = {};
  const allowedStatus = new Set(['New', 'Contacted', 'Accepted', 'Qualified', 'Documents', 'Sanctioned', 'Disbursed', 'Declined', 'Lost']);
  if (req.body && typeof req.body.status === 'string') {
    const status = String(req.body.status).trim();
    if (allowedStatus.has(status)) {
      patch.status = status;
      patch.handled = status !== 'New';
    }
  }
  if (req.body && typeof req.body.handled === 'boolean') patch.handled = req.body.handled;
  if (req.body && typeof req.body.note === 'string') patch.note = validate.text(req.body.note, 500);
  const updated = await store.updateEnquiry(String(req.params.id), patch);
  if (!updated) {
    res.status(404).json({ error: 'Enquiry not found.' });
    return;
  }
  audit(req, { type: 'enquiry.updated', summary: 'Enquiry updated: ' + String(req.params.id), targetType: 'enquiry', targetId: String(req.params.id), meta: patch });
  res.json({ ok: true, enquiry: updated });
}));

app.delete('/api/enquiries/:id', requireSession, requireRole('staff', 'admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  const removed = await store.removeEnquiry(id);
  if (!removed) {
    res.status(404).json({ error: 'Enquiry not found.' });
    return;
  }
  audit(req, { type: 'enquiry.deleted', summary: 'Enquiry deleted: ' + id, targetType: 'enquiry', targetId: id });
  res.json({ ok: true });
}));

app.get('/api/admin/store', requireSession, requireRole('staff', 'admin', 'super_admin'), asyncRoute(async (req, res) => {
  const admin = await store.adminData();
  const stats = await store.stats();
  res.json({
    ok: true,
    updatedAt: stats.updatedAt,
    leads: admin.leads || [],
    products: admin.products || [],
    partners: admin.partners || [],
    tasks: admin.tasks || [],
    customers: admin.customers || [],
    documents: admin.documents || [],
    notifications: admin.notifications || [],
    settings: admin.settings || {}
  });
}));

app.put('/api/admin/store/:name', requireSession, requireRole('staff', 'admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const name = String(req.params.name || '').toLowerCase();
  const value = validate.adminCollection(name, req.body);
  await store.setAdminCollection(name, value);
  const stats = await store.stats();
  const count = Array.isArray(value) ? value.length : Object.keys(value).length;
  audit(req, { type: 'admin.store_updated', summary: 'Admin data updated: ' + name, targetType: 'admin_store', targetId: name, meta: { name, count } });
  res.json({
    ok: true,
    name,
    count,
    updatedAt: stats.updatedAt
  });
}));

/* ------------------------------------- granular admin collection APIs */

const ADMIN_ITEM_COLLECTIONS = (validate.ADMIN_ARRAYS || []).slice();

function isAdminItemCollection(name) {
  return ADMIN_ITEM_COLLECTIONS.includes(name);
}

function makeItemId(prefix) {
  return String(prefix || 'ITM').toUpperCase() + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

async function readAdminCollection(name) {
  const admin = await store.adminData();
  const list = Array.isArray(admin[name]) ? admin[name].slice() : [];
  return list;
}

async function writeAdminCollection(req, name, list) {
  const safe = Array.isArray(list) ? list : [];
  await store.setAdminCollection(name, safe);
  const stats = await store.stats();
  audit(req, { type: 'admin.store_updated', summary: 'Admin data updated: ' + name, targetType: 'admin_store', targetId: name, meta: { name, count: safe.length } });
  return stats;
}

app.post('/api/track', asyncRoute(async (req, res) => {
  const ip = req.ip || 'unknown';
  if (pwRateLimited('track:' + ip, 120, 60 * 1000)) {
    res.status(429).json({ error: 'Too many requests.' });
    return;
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const type = validate.text(body.type, 40).toLowerCase();
  const allowed = ['page_view', 'form_start', 'form_step', 'form_submit', 'submit_attempt', 'form_submit_success', 'form_submit_failed', 'form_abandon', 'cta_click', 'enquiry_click', 'whatsapp_click', 'phone_click', 'email_click', 'download_click', 'external_link_click'];
  if (!allowed.includes(type)) {
    res.status(400).json({ error: 'Invalid event type.' });
    return;
  }
  const page = validate.text(body.page || '/', 200).slice(0, 200);
  const visitorId = validate.text(body.visitorId, 80).slice(0, 80);
  const eventId = validate.text(body.eventId, 120).slice(0, 120);
  const referrer = validate.text(body.referrer, 200).slice(0, 200);
  const safeMeta = {};
  if (body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)) {
    ['form', 'product', 'source', 'field', 'reason', 'action', 'label', 'href', 'utm_source', 'utm_medium', 'utm_campaign', 'step', 'seconds', 'fieldsTouched'].forEach((k) => {
      if (body.meta[k] != null) safeMeta[k] = validate.text(body.meta[k], 160);
    });
  }
  const ua = validate.text(req.get('user-agent') || '', 160);
  const uaLower = ua.toLowerCase();
  const deviceType = /mobile|android|iphone|ipod/.test(uaLower) ? 'mobile' : /ipad|tablet/.test(uaLower) ? 'tablet' : ua ? 'desktop' : 'unknown';
  await store.addAnalyticsEvent({
    eventId: eventId || undefined,
    type,
    page,
    visitorId: visitorId || null,
    sessionId: validate.text(body.sessionId, 80).slice(0, 80) || null,
    referrer,
    utmSource: validate.text(body.utmSource || safeMeta.utm_source, 80),
    utmMedium: validate.text(body.utmMedium || safeMeta.utm_medium, 80),
    utmCampaign: validate.text(body.utmCampaign || safeMeta.utm_campaign, 120),
    deviceType,
    ip: crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 16),
    ua,
    meta: safeMeta
  });
  res.json({ ok: true });
}));

app.get('/api/admin/analytics', requireSession, requireRole('staff', 'admin', 'super_admin'), asyncRoute(async (req, res) => {
  const data = await store.getAnalytics();
  const events = Array.isArray(data.events) ? data.events : [];
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const since7 = now - 7 * dayMs;
  const since30 = now - 30 * dayMs;
  const inRange = (e, since) => { const t = new Date(e.at || 0).getTime(); return t >= since; };
  const events7 = events.filter((e) => inRange(e, since7));
  const events30 = events.filter((e) => inRange(e, since30));
  const count = (arr, type) => arr.filter((e) => e && e.type === type).length;
  const uniq = (arr, type) => {
    const s = new Set();
    arr.forEach((e) => { if (e && (!type || e.type === type)) s.add(e.visitorId || e.ip || 'unknown'); });
    return s.size;
  };
  const byDayMap = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * dayMs);
    const key = d.toISOString().slice(0, 10);
    byDayMap[key] = { date: key, pageViews: 0, formStarts: 0, formSubmits: 0 };
  }
  events7.forEach((e) => {
    const key = String(e.at || '').slice(0, 10);
    if (!byDayMap[key]) return;
    if (e.type === 'page_view') byDayMap[key].pageViews += 1;
    if (e.type === 'form_start') byDayMap[key].formStarts += 1;
    if (e.type === 'form_submit' || e.type === 'form_submit_success' || e.type === 'submit_attempt') byDayMap[key].formSubmits += 1;
  });
  const pageMap = {};
  const sourceMap = {};
  const deviceMap = {};
  const utmMap = {};
  const landingMap = {};
  const refMap = {};
  events30.forEach((e) => {
    if (!e) return;
    if (e.type === 'page_view') {
      const page = String(e.page || '/').slice(0, 120);
      pageMap[page] = (pageMap[page] || 0) + 1;
      const device = String(e.deviceType || e.device_type || 'unknown').toLowerCase() || 'unknown';
      deviceMap[device] = (deviceMap[device] || 0) + 1;
      const utm = String(e.utmSource || e.utm_source || (e.meta && e.meta.utm_source) || '').trim().toLowerCase();
      const ref = String(e.referrer || '').trim();
      let source = 'direct';
      if (utm) source = utm;
      else if (ref) {
        try { const host = new URL(ref).hostname.replace(/^www\./, ''); source = host || 'referral'; }
        catch (_) { source = 'referral'; }
      }
      sourceMap[source] = (sourceMap[source] || 0) + 1;
      if (ref) { try { const host = new URL(ref).hostname.replace(/^www\./, ''); if (host) refMap[host] = (refMap[host] || 0) + 1; } catch (_) {} }
      const campaign = String(e.utmCampaign || e.utm_campaign || (e.meta && e.meta.utm_campaign) || '').trim();
      if (campaign) utmMap[campaign] = (utmMap[campaign] || 0) + 1;
      if (!landingMap[e.visitorId || e.ip || page + e.at]) landingMap[e.visitorId || e.ip || page + e.at] = page;
    }
  });
  const landingPages = {};
  Object.values(landingMap).forEach(p => { landingPages[p] = (landingPages[p] || 0) + 1; });
  const topList = (obj, keyName) => Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([k,v]) => ({ [keyName]: k, count: v }));
  const topPages = topList(pageMap, 'page').map(x => ({ page: x.page, views: x.count }));
  const trafficSources = topList(sourceMap, 'source');
  const devices = topList(deviceMap, 'device');
  const utmCampaigns = topList(utmMap, 'campaign');
  const topReferrers = topList(refMap, 'referrer');
  const topLandingPages = topList(landingPages, 'page').map(x => ({ page: x.page, entries: x.count }));
  const recent = events.slice(-20).reverse().map((e) => ({
    at: e.at, type: e.type, page: e.page || '', visitorId: e.visitorId || '', deviceType: e.deviceType || '', referrer: e.referrer || '', meta: e.meta || {}
  }));
  const lastFormAttempt = [...events].reverse().find((e) => e && ['form_start', 'form_submit', 'form_submit_success', 'form_submit_failed'].includes(e.type));
  res.json({
    ok: true,
    summary: {
      totalPageViews: count(events, 'page_view'),
      uniqueVisitors: uniq(events.filter((e) => e.type === 'page_view')),
      formStarts: count(events, 'form_start'),
      formSubmits: count(events, 'form_submit') + count(events, 'form_submit_success') + count(events, 'submit_attempt'),
      formSubmitSuccess: count(events, 'form_submit_success'),
      formAbandon: count(events, 'form_abandon'),
      ctaClicks: count(events, 'cta_click') + count(events, 'enquiry_click'),
      whatsappClicks: count(events, 'whatsapp_click'),
      phoneClicks: count(events, 'phone_click'),
      emailClicks: count(events, 'email_click'),
      last7PageViews: count(events7, 'page_view'),
      last7UniqueVisitors: uniq(events7.filter((e) => e.type === 'page_view')),
      last7FormStarts: count(events7, 'form_start'),
      last7FormSubmits: count(events7, 'form_submit') + count(events7, 'form_submit_success') + count(events7, 'submit_attempt'),
      last7FormAbandon: count(events7, 'form_abandon'),
      last7CtaClicks: count(events7, 'cta_click') + count(events7, 'enquiry_click'),
      last7PhoneClicks: count(events7, 'phone_click'),
      last7WhatsappClicks: count(events7, 'whatsapp_click'),
      lastFormAttemptAt: lastFormAttempt ? lastFormAttempt.at : null,
      lastFormAttemptType: lastFormAttempt ? lastFormAttempt.type : null
    },
    daily: Object.values(byDayMap),
    topPages,
    trafficSources,
    devices,
    utmCampaigns,
    topReferrers,
    topLandingPages,
    recent
  });
}));

app.get('/api/admin/import-article', requireSession, requireRole('staff', 'admin', 'super_admin'), asyncRoute(async (req, res) => {
  const rawUrl = validate.text(req.query.url, 1000);
  let u;
  try { u = new URL(rawUrl); } catch (e) { res.status(400).json({ error: 'Invalid URL.' }); return; }
  if (!['http:', 'https:'].includes(u.protocol)) { res.status(400).json({ error: 'Only http/https URLs are allowed.' }); return; }
  const ctrl = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(10000) : undefined;
  const r = await fetch(u.toString(), { signal: ctrl, headers: { 'Accept': 'text/html,application/xhtml+xml', 'User-Agent': 'ASFinancialAdmin/1.0' } });
  if (!r.ok) { res.status(502).json({ error: 'Could not fetch URL (' + r.status + ').' }); return; }
  const html = (await r.text()).slice(0, 300000);
  const pick = (re) => { const m = html.match(re); return m ? String(m[1] || '').replace(/\s+/g, ' ').trim() : ''; };
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i)
    || pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const desc = pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
    || pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  res.json({ ok: true, article: { title: title.slice(0, 180), excerpt: desc.slice(0, 300), url: u.toString() } });
}));

app.get('/api/admin/google-reviews', requireSession, requireRole('staff', 'admin', 'super_admin'), asyncRoute(async (req, res) => {
  const apiKey = String(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '').trim();
  const placeId = String(req.query.placeId || process.env.GOOGLE_PLACE_ID || process.env.GOOGLE_MAPS_PLACE_ID || '').trim();
  if (!apiKey) {
    res.status(400).json({ error: 'Google Places API key is not configured on the server.' });
    return;
  }
  if (!placeId) {
    res.status(400).json({ error: 'Google Place ID is not configured. Set GOOGLE_PLACE_ID on the server or pass placeId.' });
    return;
  }
  const endpoint = 'https://maps.googleapis.com/maps/api/place/details/json?place_id=' + encodeURIComponent(placeId) + '&fields=name,rating,user_ratings_total,reviews,url&reviews_sort=newest&key=' + encodeURIComponent(apiKey);
  const ctrl = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(10000) : undefined;
  const r = await fetch(endpoint, { signal: ctrl, headers: { 'Accept': 'application/json' } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data || data.status !== 'OK') {
    const msg = (data && (data.error_message || data.status)) ? String(data.error_message || data.status) : 'Could not fetch Google reviews.';
    res.status(502).json({ error: msg });
    return;
  }
  const result = data.result || {};
  const reviews = Array.isArray(result.reviews) ? result.reviews.map((rv, i) => ({
    id: 'GREV-' + (rv.time || Date.now()) + '-' + i,
    author: String(rv.author_name || 'Google user').trim(),
    rating: Number(rv.rating) || 0,
    text: String(rv.text || '').trim(),
    time: rv.time ? new Date(rv.time * 1000).toISOString() : null,
    relativeTime: String(rv.relative_time_description || '').trim(),
    profilePhoto: String(rv.profile_photo_url || '').trim(),
    source: 'google_maps',
    placeName: String(result.name || '').trim(),
    placeUrl: String(result.url || '').trim()
  })) : [];
  res.json({
    ok: true,
    place: {
      name: String(result.name || '').trim(),
      rating: Number(result.rating) || 0,
      total: Number(result.user_ratings_total) || 0,
      url: String(result.url || '').trim()
    },
    reviews
  });
}));

app.get('/api/admin/:collection', requireSession, requireRole('staff', 'admin', 'super_admin'), asyncRoute(async (req, res, next) => {
  const collection = String(req.params.collection || '').toLowerCase();
  if (collection === 'store' || collection === 'export') return next();
  if (!isAdminItemCollection(collection)) return next();
  let items = await readAdminCollection(collection);

  const q = validate.text(req.query.q, 120).toLowerCase();
  const status = validate.text(req.query.status, 60).toLowerCase();
  const owner = validate.text(req.query.owner || req.query.assignedTo, 120).toLowerCase();
  const type = validate.text(req.query.type, 60).toLowerCase();

  if (status) {
    items = items.filter((it) => String((it && (it.status || it.stage)) || '').toLowerCase() === status);
  }
  if (owner) {
    items = items.filter((it) => {
      const o = String((it && (it.owner || it.assignedTo || it.assignee)) || '').toLowerCase();
      return o === owner;
    });
  }
  if (type) {
    items = items.filter((it) => String((it && (it.type || it.docType || it.category)) || '').toLowerCase() === type);
  }
  if (q) {
    items = items.filter((it) => {
      try {
        const hay = JSON.stringify(it || {}).toLowerCase();
        return hay.includes(q);
      } catch (e) {
        return false;
      }
    });
  }

  const total = items.length;
  const hasLimit = req.query.limit !== undefined || req.query.offset !== undefined || req.query.page !== undefined;
  let limit = Number(req.query.limit);
  if (!Number.isFinite(limit) || limit <= 0) limit = hasLimit ? 50 : total || 0;
  limit = Math.max(1, Math.min(limit, 500));
  let offset = Number(req.query.offset);
  if (!Number.isFinite(offset) || offset < 0) {
    const page = Number(req.query.page);
    offset = Number.isFinite(page) && page > 0 ? Math.floor((page - 1) * limit) : 0;
  }
  offset = Math.max(0, Math.floor(offset));

  const paged = hasLimit ? items.slice(offset, offset + limit) : items;
  res.json({
    ok: true,
    collection,
    items: paged,
    count: paged.length,
    total,
    limit: hasLimit ? limit : total,
    offset: hasLimit ? offset : 0
  });
}));

function applyCollectionRules(collection, item, existing, session) {
  const out = Object.assign({}, item || {});
  const actorEmail = session && session.email ? String(session.email) : '';
  const actorId = session && session.userId ? String(session.userId) : '';
  const actorName = actorEmail.split('@')[0] || '';

  // ownership/assignment defaults
  if (['leads', 'customers', 'tasks', 'documents'].includes(collection)) {
    if (!existing) {
      if (!out.owner && !out.assignedTo && !out.assignee) out.owner = actorName || actorEmail || 'Admin';
      if (!out.createdBy) out.createdBy = actorEmail || actorId || '';
    }
    if (out.owner && !out.assignedTo) out.assignedTo = out.owner;
    if (out.assignedTo && !out.owner) out.owner = out.assignedTo;
  }

  // basic workflow normalization
  if (collection === 'tasks' && typeof out.done !== 'boolean') out.done = Boolean(out.done);
  if (collection === 'notifications' && typeof out.read !== 'boolean') out.read = Boolean(out.read);
  if (collection === 'documents' && !out.status) out.status = existing && existing.status ? existing.status : 'Pending';
  if (collection === 'leads' && !out.status) out.status = existing && existing.status ? existing.status : 'New';

  // simple status value guardrails (non-breaking: only normalize known aliases)
  if (collection === 'documents') {
    const map = { pending: 'Pending', requested: 'Requested', received: 'Received', verified: 'Verified', rejected: 'Rejected' };
    const k = String(out.status || '').toLowerCase();
    if (map[k]) out.status = map[k];
  }
  if (collection === 'tasks') {
    const st = String(out.status || '').toLowerCase();
    if (!out.status) out.status = out.done ? 'Done' : 'Open';
    if (st === 'done' || st === 'completed') { out.done = true; out.status = 'Done'; }
    if (st === 'open' || st === 'todo' || st === 'pending') { out.done = false; out.status = 'Open'; }
  }

  // prevent privilege/identity spoofing fields from client
  delete out.__proto__;
  return out;
}

app.post('/api/admin/:collection', requireSession, requireRole('staff', 'admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res, next) => {
  const collection = String(req.params.collection || '').toLowerCase();
  if (!isAdminItemCollection(collection)) return next();
  const items = await readAdminCollection(collection);
  const body = validate.adminItem ? validate.adminItem(req.body || {}) : (req.body || {});
  const now = new Date().toISOString();
  const prefixes = { leads: 'LEAD', products: 'PRD', partners: 'PRT', tasks: 'TSK', customers: 'CUS', documents: 'DOC', notifications: 'NTF' };
  let item = Object.assign({}, body);
  if (!item.id) item.id = makeItemId(prefixes[collection] || 'ITM');
  if (items.some((x) => x && String(x.id) === String(item.id))) {
    item.id = makeItemId(prefixes[collection] || 'ITM');
  }
  if (!item.createdAt) item.createdAt = now;
  item.updatedAt = now;
  item = applyCollectionRules(collection, item, null, req.session);
  items.unshift(item);
  if (items.length > 2000) items.length = 2000;
  const stats = await writeAdminCollection(req, collection, items);
  res.status(201).json({ ok: true, collection, item, count: items.length, updatedAt: stats.updatedAt });
}));

app.get('/api/admin/:collection/:id', requireSession, requireRole('staff', 'admin', 'super_admin'), asyncRoute(async (req, res, next) => {
  const collection = String(req.params.collection || '').toLowerCase();
  if (collection === 'store') return next();
  if (!isAdminItemCollection(collection)) return next();
  const id = String(req.params.id || '');
  const items = await readAdminCollection(collection);
  const item = items.find((x) => x && String(x.id) === id);
  if (!item) { res.status(404).json({ error: 'Item not found.' }); return; }
  res.json({ ok: true, collection, item });
}));

app.patch('/api/admin/:collection/:id', requireSession, requireRole('staff', 'admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res, next) => {
  const collection = String(req.params.collection || '').toLowerCase();
  if (!isAdminItemCollection(collection)) return next();
  const id = String(req.params.id || '');
  const items = await readAdminCollection(collection);
  const idx = items.findIndex((x) => x && String(x.id) === id);
  if (idx === -1) { res.status(404).json({ error: 'Item not found.' }); return; }
  const patch = validate.adminItem ? validate.adminItem(req.body || {}) : (req.body || {});
  const now = new Date().toISOString();
  let nextItem = Object.assign({}, items[idx], patch, { id: items[idx].id || id, updatedAt: now });
  if (!nextItem.createdAt && items[idx].createdAt) nextItem.createdAt = items[idx].createdAt;
  nextItem = applyCollectionRules(collection, nextItem, items[idx], req.session);
  nextItem.id = items[idx].id || id; // immutable
  if (!nextItem.createdAt && items[idx].createdAt) nextItem.createdAt = items[idx].createdAt;
  items[idx] = nextItem;
  const stats = await writeAdminCollection(req, collection, items);
  res.json({ ok: true, collection, item: nextItem, updatedAt: stats.updatedAt });
}));

app.delete('/api/admin/:collection/:id', requireSession, requireRole('staff', 'admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res, next) => {
  const collection = String(req.params.collection || '').toLowerCase();
  if (!isAdminItemCollection(collection)) return next();
  const id = String(req.params.id || '');
  const items = await readAdminCollection(collection);
  const idx = items.findIndex((x) => x && String(x.id) === id);
  if (idx === -1) { res.status(404).json({ error: 'Item not found.' }); return; }
  items.splice(idx, 1);
  const stats = await writeAdminCollection(req, collection, items);
  res.json({ ok: true, collection, id, updatedAt: stats.updatedAt });
}));

/* --------------------------------------------------- file uploads */

const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024; // 5 MB decoded
const UPLOAD_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
};

function safeUploadName(name) {
  const base = String(name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return (base || 'file').slice(0, 120);
}

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

app.post('/api/admin/uploads', requireSession, requireRole('staff', 'admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const filename = safeUploadName(body.filename || body.name || 'document');
  const contentType = String(body.contentType || body.mimeType || '').toLowerCase().trim();
  const ext = UPLOAD_MIME[contentType];
  if (!ext) {
    res.status(400).json({ error: 'Unsupported file type. Allowed: PDF, JPG, PNG, WEBP, TXT, CSV, DOC, DOCX, XLS, XLSX.' });
    return;
  }
  const b64 = String(body.dataBase64 || body.data || '').replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
  if (!b64) { res.status(400).json({ error: 'Missing file data.' }); return; }
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (e) { res.status(400).json({ error: 'Invalid file data.' }); return; }
  if (!buf || !buf.length) { res.status(400).json({ error: 'File is empty.' }); return; }
  if (buf.length > UPLOAD_MAX_BYTES) { res.status(400).json({ error: 'File is too large (max 5 MB).' }); return; }

  const id = 'UPL-' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
  const storedName = id + '-' + filename.replace(/\.[^.]+$/, '') + '.' + ext;
  let stored = false;
  let storage = 'metadata';
  let url = '';

  // Local/dev disk storage (ephemeral on Vercel). Best-effort.
  try {
    await ensureUploadDir();
    const outPath = path.join(UPLOAD_DIR, storedName);
    await fs.writeFile(outPath, buf);
    stored = true;
    storage = 'local';
    url = '/api/admin/uploads/' + encodeURIComponent(storedName);
  } catch (err) {
    console.warn('[upload] disk write failed (using metadata only):', err && err.message ? err.message : err);
    stored = false;
    storage = 'metadata';
  }

  const now = new Date().toISOString();
  const file = {
    id,
    filename,
    storedName: stored ? storedName : null,
    contentType,
    size: buf.length,
    storage,
    url: url || null,
    uploadedAt: now,
    uploadedBy: (req.session && (req.session.email || req.session.userId)) || ''
  };

  // Optionally attach/create a document record
  let document = null;
  const documentId = validate.text(body.documentId, 80);
  const shouldCreateDoc = body.createDocument === true || String(body.createDocument || '').toLowerCase() === 'true';
  if (store.adminData && store.setAdminCollection && (documentId || shouldCreateDoc)) {
    try {
      const items = await readAdminCollection('documents');
      if (documentId) {
        const idx = items.findIndex((d) => d && String(d.id) === documentId);
        if (idx !== -1) {
          items[idx] = Object.assign({}, items[idx], {
            file,
            url: file.url || items[idx].url || '',
            filename: file.filename,
            contentType: file.contentType,
            size: file.size,
            storage: file.storage,
            status: items[idx].status || 'Received',
            updatedAt: now
          });
          document = items[idx];
          await writeAdminCollection(req, 'documents', items);
        }
      }
      if (!document && shouldCreateDoc) {
        document = applyCollectionRules('documents', {
          id: makeItemId('DOC'),
          title: validate.text(body.title, 200) || filename,
          type: validate.text(body.type || body.docType, 80),
          linkedTo: validate.text(body.linkedTo, 120),
          status: validate.text(body.status, 40) || 'Received',
          notes: validate.text(body.notes, 1000),
          file,
          url: file.url || '',
          filename: file.filename,
          contentType: file.contentType,
          size: file.size,
          storage: file.storage,
          createdAt: now,
          updatedAt: now
        }, null, req.session);
        items.unshift(document);
        if (items.length > 2000) items.length = 2000;
        await writeAdminCollection(req, 'documents', items);
      }
    } catch (err) {
      console.warn('[upload] document link failed:', err && err.message ? err.message : err);
    }
  }

  audit(req, { type: 'document.uploaded', summary: 'Document uploaded: ' + filename, targetType: 'upload', targetId: file.id, meta: { filename, size: file.size, contentType, storage, documentId: document ? document.id : (documentId || '') } });
  res.status(201).json({ ok: true, file, document, storage });
}));

app.get('/api/admin/uploads/:file', requireSession, requireRole('staff', 'admin', 'super_admin'), asyncRoute(async (req, res) => {
  const name = String(req.params.file || '');
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) {
    res.status(400).json({ error: 'Invalid file name.' });
    return;
  }
  const full = path.join(UPLOAD_DIR, name);
  const resolved = path.resolve(full);
  const base = path.resolve(UPLOAD_DIR);
  if (!resolved.startsWith(base + path.sep)) {
    res.status(400).json({ error: 'Invalid file path.' });
    return;
  }
  try {
    await fs.access(resolved, fsSync.constants.R_OK);
  } catch (e) {
    res.status(404).json({ error: 'File not found. It may have expired on ephemeral storage.' });
    return;
  }
  res.sendFile(resolved);
}));

/* --------------------------------------------------- password & users */

const pwAttemptsByIp = new Map();
function pwRateLimited(ip, limit, windowMs) {
  const now = Date.now();
  const key = ip || 'unknown';
  const rec = pwAttemptsByIp.get(key) || { hits: [] };
  rec.hits = rec.hits.filter((t) => now - t < (windowMs || 15 * 60 * 1000));
  rec.hits.push(now);
  pwAttemptsByIp.set(key, rec);
  if (pwAttemptsByIp.size > 5000) pwAttemptsByIp.clear();
  scheduleSecurityPersist(false);
  return rec.hits.length > (limit || 10);
}

function validatePassword(pw) {
  const s = String(pw || '');
  if (s.length < 6) return 'Password must be at least 6 characters.';
  if (s.length > 200) return 'Password is too long.';
  return null;
}

function normalizeRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'super_admin') return 'admin';
  if (r === 'advisor') return 'staff';
  return ['staff', 'admin'].includes(r) ? r : null;
}

function userPublic(user) {
  return auth.publicUser ? auth.publicUser(user) : { id: user.id, email: user.email, role: user.role, active: user.active !== false };
}

app.post('/api/change-password', requireSession, requireCsrf, asyncRoute(async (req, res) => {
  const ip = req.ip || 'unknown';
  if (pwRateLimited(ip, 12, 15 * 60 * 1000)) {
    res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    return;
  }
  const currentPassword = String((req.body && req.body.currentPassword) || '');
  const newPassword = String((req.body && req.body.newPassword) || '');
  const pwErr = validatePassword(newPassword);
  if (pwErr) { res.status(400).json({ error: pwErr }); return; }

  let user = req.session.userId && store.findUserById ? await store.findUserById(req.session.userId) : null;
  if (!user && store.findUserByEmail) user = await store.findUserByEmail(req.session.email);
  if (!user || user.active === false) { res.status(401).json({ error: 'User account not found.' }); return; }
  if (!auth.verifyPassword(user, currentPassword)) {
    auth.noteFailedAttempt(ip);
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }
  if (auth.verifyPassword(user, newPassword)) {
    res.status(400).json({ error: 'New password must be different from the current password.' });
    return;
  }
  auth.setPassword(user, newPassword);
  await store.upsertUser(user);
  await auth.revokeAllForEmail(user.email);
  audit(req, { type: 'auth.password_changed', summary: 'User changed password', targetType: 'user', targetId: user.id });
  const issued = await auth.issue(user.email, user.role || 'admin', { userId: user.id, ip, userAgent: req.get('user-agent') || '' });
  res.setHeader('Set-Cookie', auth.cookieHeader(issued.token, { maxAgeMs: auth.SESSION_TTL_MS, secure: cookieSecure(req) }));
  res.json(Object.assign({ ok: true, csrfToken: issued.csrfToken, expiresIn: auth.SESSION_TTL_MS }, userPublic(user)));
}));

app.post('/api/forgot-password', asyncRoute(async (req, res) => {
  const ip = req.ip || 'unknown';
  if (pwRateLimited('forgot:' + ip, 6, 15 * 60 * 1000)) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  }
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const generic = { ok: true, message: 'If an account exists for that email, password reset instructions have been prepared.' };
  if (!email || !store.findUserByEmail) { res.json(generic); return; }
  const user = await store.findUserByEmail(email);
  if (!user || user.active === false) { res.json(generic); return; }
  const rt = auth.makeResetToken();
  user.resetToken = rt.tokenHash;
  user.resetExpiresAt = rt.expiresAt;
  await store.upsertUser(user);
  const resetPath = '/admin.html?reset=' + encodeURIComponent(rt.token);
  const resetUrl = (mailer && mailer.absoluteResetUrl) ? mailer.absoluteResetUrl(resetPath, req) : resetPath;
  let mailResult = { sent: false, configured: false };
  if (mailer && mailer.isConfigured && mailer.isConfigured()) {
    mailResult = await mailer.sendPasswordReset({ to: user.email, name: user.name, resetUrl, expiresAt: rt.expiresAt }).catch(() => ({ sent: false, fallback: true, reason: 'send_exception' }));
    mailResult.configured = true;
  }
  const emailSent = !!mailResult.sent;
  const emailConfigured = !!(mailer && mailer.isConfigured && mailer.isConfigured());
  if (IS_PRODUCTION && !emailSent) {
    console.warn('[auth] Password reset requested in production but email was not delivered (configured=' + emailConfigured + ', reason=' + (mailResult.reason || 'unknown') + ') for', user.email);
  }
  audit(req, { type: 'auth.forgot_password', actorEmail: user.email, summary: 'Password reset requested', targetType: 'user', targetId: user.id, meta: { emailSent, emailConfigured, reason: mailResult.reason || null } });
  console.log('[auth] Password reset requested for', user.email, 'token expires', rt.expiresAt, 'url', resetUrl, 'emailSent=' + emailSent + ' emailConfigured=' + emailConfigured);
  if (!IS_PRODUCTION) {
    res.json(Object.assign({}, generic, { devResetToken: rt.token, devResetUrl: resetPath, resetUrl, expiresAt: rt.expiresAt, emailSent, emailConfigured }));
  } else {
    // In production do not expose tokens; delivery relies on configured email or admin-issued reset.
    res.json(Object.assign({}, generic, { emailSent, emailConfigured }));
  }
}));

app.post('/api/reset-password', asyncRoute(async (req, res) => {
  const ip = req.ip || 'unknown';
  if (pwRateLimited('reset:' + ip, 10, 15 * 60 * 1000)) {
    res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    return;
  }
  const token = String((req.body && req.body.token) || '').trim();
  const newPassword = String((req.body && req.body.newPassword) || '');
  const pwErr = validatePassword(newPassword);
  if (pwErr) { res.status(400).json({ error: pwErr }); return; }
  if (!token || !store.findUserByResetToken) { res.status(400).json({ error: 'Invalid or expired reset link.' }); return; }
  const user = await store.findUserByResetToken(token);
  if (!user || user.active === false) { res.status(400).json({ error: 'Invalid or expired reset link.' }); return; }
  const exp = user.resetExpiresAt ? Date.parse(user.resetExpiresAt) : 0;
  if (!exp || exp <= Date.now()) {
    user.resetToken = null; user.resetExpiresAt = null;
    await store.upsertUser(user);
    res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    return;
  }
  auth.setPassword(user, newPassword);
  await store.upsertUser(user);
  await auth.revokeAllForEmail(user.email);
  audit(req, { type: 'auth.password_reset', actorEmail: user.email, summary: 'Password reset completed', targetType: 'user', targetId: user.id });
  res.json({ ok: true, message: 'Password updated. You can now sign in.' });
}));

app.get('/api/users', requireSession, requireRole('super_admin', 'admin'), asyncRoute(async (req, res) => {
  const users = store.listUsers ? await store.listUsers() : [];
  res.json({ users: users.map(userPublic) });
}));

app.get('/api/audit', requireSession, requireRole('super_admin', 'admin'), asyncRoute(async (req, res) => {
  if (!store.listAudit) { res.json({ entries: [] }); return; }
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
  const type = req.query.type ? String(req.query.type) : '';
  const q = validate.text(req.query.q, 120).toLowerCase();
  let entries = await store.listAudit({ limit: q ? 500 : limit, type: type || undefined });
  if (q) {
    entries = entries.filter((e) => {
      const hay = [e && e.type, e && e.summary, e && e.actorEmail, e && e.targetType, e && e.targetId].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    }).slice(0, limit);
  }
  res.json({ entries, count: entries.length, limit });
}));

app.get('/api/sessions', requireSession, requireRole('advisor', 'staff', 'admin', 'super_admin'), asyncRoute(async (req, res) => {
  const isAdmin = roleAtLeast(req.session.role || 'advisor', 'admin');
  const scopeAll = isAdmin && String(req.query.scope || '') === 'all';
  const currentToken = req.authToken || auth.tokenFrom(req);
  let sessions;
  if (scopeAll) {
    sessions = auth.listSessions ? auth.listSessions({ currentToken }) : [];
  } else {
    sessions = auth.listSessions ? auth.listSessions({ email: req.session.email, currentToken }) : [];
  }
  res.json({ sessions });
}));

app.post('/api/sessions/revoke-others', requireSession, requireCsrf, asyncRoute(async (req, res) => {
  const currentToken = req.authToken || auth.tokenFrom(req);
  const count = auth.revokeOthersForEmail ? await auth.revokeOthersForEmail(req.session.email, currentToken) : 0;
  audit(req, { type: 'session.revoke_others', summary: 'Revoked ' + count + ' other session(s)', targetType: 'user', targetId: req.session.userId || '' , meta: { count } });
  res.json({ ok: true, revoked: count });
}));

app.delete('/api/sessions/:id', requireSession, requireCsrf, asyncRoute(async (req, res) => {
  const id = String(req.params.id || '');
  const actorRole = req.session.role || 'advisor';
  const isAdmin = roleAtLeast(actorRole, 'admin');
  const currentToken = req.authToken || auth.tokenFrom(req);
  // Find session info for authorization/audit
  const all = auth.listSessions ? auth.listSessions({ currentToken }) : [];
  const target = all.find((s) => s && s.id === id);
  if (!target) {
    // Try scoped to own if not found globally (for non-admin, listSessions all not called)
    const own = auth.listSessions ? auth.listSessions({ email: req.session.email, currentToken }) : [];
    const ownTarget = own.find((s) => s && s.id === id);
    if (!ownTarget) { res.status(404).json({ error: 'Session not found.' }); return; }
    if (ownTarget.current) { res.status(400).json({ error: 'Use sign out to end your current session.' }); return; }
    const result = await auth.revokeById(id, currentToken);
    if (!result || result.revoked === false) { res.status(400).json({ error: result && result.reason === 'current' ? 'Use sign out to end your current session.' : 'Could not revoke session.' }); return; }
    audit(req, { type: 'session.revoked', summary: 'Revoked session', targetType: 'session', targetId: id, meta: { targetEmail: ownTarget.email } });
    res.json({ ok: true });
    return;
  }
  const targetEmail = String(target.email || '').toLowerCase();
  const actorEmail = String(req.session.email || '').toLowerCase();
  const isOwn = targetEmail && targetEmail === actorEmail;
  if (!isAdmin && !isOwn) {
    res.status(403).json({ error: 'You do not have permission to revoke this session.' });
    return;
  }
  // Prevent lower-privileged admins from revoking sessions of higher/equal privileged users (super_admin can manage all).
  if (!isOwn && actorRole !== 'super_admin') {
    const targetRole = String(target.role || 'advisor');
    if ((ROLE_RANK[actorRole] || 0) <= (ROLE_RANK[targetRole] || 0)) {
      res.status(403).json({ error: 'You do not have permission to revoke sessions for this user.' });
      return;
    }
  }
  if (target.current) { res.status(400).json({ error: 'Use sign out to end your current session.' }); return; }
  const result = await auth.revokeById(id, currentToken);
  if (!result || result.revoked === false) { res.status(400).json({ error: 'Could not revoke session.' }); return; }
  audit(req, { type: 'session.revoked', summary: 'Revoked session for ' + (target.email || ''), targetType: 'session', targetId: id, meta: { targetEmail: target.email } });
  res.json({ ok: true });
}));

app.post('/api/users/:id/revoke-sessions', requireSession, requireRole('super_admin', 'admin'), requireCsrf, asyncRoute(async (req, res) => {
  const user = await store.findUserById(String(req.params.id || ''));
  if (!user) { res.status(404).json({ error: 'User not found.' }); return; }
  const actorRole = req.session.role || 'advisor';
  const actorEmail = String(req.session.email || '').toLowerCase();
  const targetEmail = String(user.email || '').toLowerCase();
  const keepCurrent = targetEmail && targetEmail === actorEmail;
  if (!keepCurrent && actorRole !== 'super_admin') {
    const targetRole = String(user.role || 'advisor');
    if ((ROLE_RANK[actorRole] || 0) <= (ROLE_RANK[targetRole] || 0)) {
      res.status(403).json({ error: 'You do not have permission to revoke sessions for this user.' });
      return;
    }
  }
  const currentToken = req.authToken || auth.tokenFrom(req);
  let count = 0;
  if (keepCurrent && auth.revokeOthersForEmail) {
    count = await auth.revokeOthersForEmail(user.email, currentToken);
  } else if (auth.revokeAllForEmail) {
    await auth.revokeAllForEmail(user.email);
    count = -1; // unknown/all
  }
  audit(req, { type: 'session.revoke_user', summary: 'Revoked sessions for ' + user.email, targetType: 'user', targetId: user.id, meta: { keepCurrent } });
  res.json({ ok: true, revoked: count, keepCurrent });
}));

app.get('/api/admin/export', requireSession, requireRole('super_admin'), asyncRoute(async (req, res) => {
  const content = await store.content();
  const admin = await store.adminData();
  const enquiries = await store.listEnquiries();
  const users = store.listUsers ? await store.listUsers() : [];
  const auditEntries = store.listAudit ? await store.listAudit({ limit: 500 }) : [];
  const stats = await store.stats();
  const desc = typeof store.describe === 'function' ? store.describe() : { backend: store.BACKEND || 'unknown' };
  const safeUsers = users.map((u) => userPublic(u));
  audit(req, { type: 'admin.export', summary: 'Exported system data', targetType: 'system', targetId: 'export' });
  res.json({
    ok: true,
    exportedAt: new Date().toISOString(),
    backend: desc.backend,
    stats,
    content,
    admin,
    enquiries,
    users: safeUsers,
    audit: auditEntries
  });
}));

app.post('/api/users', requireSession, requireRole('super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim().slice(0, 120);
  const role = normalizeRole(body.role) || 'staff';
  const password = String(body.password || '');
  const pwErr = validatePassword(password);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { res.status(400).json({ error: 'A valid email address is required.' }); return; }
  if (pwErr) { res.status(400).json({ error: pwErr }); return; }
  const existing = await store.findUserByEmail(email);
  if (existing) { res.status(409).json({ error: 'A user with this email already exists.' }); return; }
  const user = {
    id: auth.randomId('USR'),
    email,
    name,
    role,
    active: body.active !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastLoginAt: null,
    resetToken: null,
    resetExpiresAt: null,
    passwordChangedAt: null
  };
  auth.setPassword(user, password);
  await store.upsertUser(user);
  audit(req, { type: 'user.created', summary: 'User created: ' + email, targetType: 'user', targetId: user.id, meta: { role: user.role } });
  res.status(201).json({ ok: true, user: userPublic(user) });
}));

app.patch('/api/users/:id', requireSession, requireRole('super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const user = await store.findUserById(String(req.params.id || ''));
  if (!user) { res.status(404).json({ error: 'User not found.' }); return; }
  const body = req.body || {};
  if (typeof body.name === 'string') user.name = body.name.trim().slice(0, 120);
  if (typeof body.role === 'string') {
    const role = normalizeRole(body.role);
    if (!role) { res.status(400).json({ error: 'Invalid role.' }); return; }
    // prevent demoting the last super_admin
    if (user.role === 'super_admin' && role !== 'super_admin') {
      const users = await store.listUsers();
      const supers = users.filter((u) => u.role === 'super_admin' && u.active !== false && u.id !== user.id);
      if (supers.length === 0) { res.status(400).json({ error: 'At least one active super admin is required.' }); return; }
    }
    user.role = role;
  }
  if (typeof body.active === 'boolean') {
    if (user.active !== false && body.active === false) {
      const users = await store.listUsers();
      const supers = users.filter((u) => u.role === 'super_admin' && u.active !== false && u.id !== user.id);
      if (user.role === 'super_admin' && supers.length === 0) { res.status(400).json({ error: 'At least one active super admin is required.' }); return; }
      await auth.revokeAllForEmail(user.email);
    }
    user.active = body.active;
  }
  if (typeof body.password === 'string' && body.password) {
    const pwErr = validatePassword(body.password);
    if (pwErr) { res.status(400).json({ error: pwErr }); return; }
    auth.setPassword(user, body.password);
    await auth.revokeAllForEmail(user.email);
  }
  await store.upsertUser(user);
  audit(req, { type: 'user.updated', summary: 'User updated: ' + user.email, targetType: 'user', targetId: user.id, meta: { role: user.role, active: user.active !== false } });
  res.json({ ok: true, user: userPublic(user) });
}));

app.post('/api/users/:id/reset-token', requireSession, requireRole('super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const user = await store.findUserById(String(req.params.id || ''));
  if (!user) { res.status(404).json({ error: 'User not found.' }); return; }
  const rt = auth.makeResetToken();
  user.resetToken = rt.tokenHash;
  user.resetExpiresAt = rt.expiresAt;
  await store.upsertUser(user);
  const resetPath = '/admin.html?reset=' + encodeURIComponent(rt.token);
  const resetUrl = (mailer && mailer.absoluteResetUrl) ? mailer.absoluteResetUrl(resetPath, req) : resetPath;
  let emailSent = false;
  if (mailer && mailer.isConfigured && mailer.isConfigured()) {
    const mailResult = await mailer.sendPasswordReset({ to: user.email, name: user.name, resetUrl, expiresAt: rt.expiresAt }).catch(() => ({ sent: false }));
    emailSent = !!(mailResult && mailResult.sent);
  }
  audit(req, { type: 'user.reset_token_generated', summary: 'Reset token generated for ' + user.email, targetType: 'user', targetId: user.id, meta: { emailSent } });
  console.log('[auth] Reset token generated for', user.email, 'expires', rt.expiresAt, 'emailSent=' + emailSent);
  res.json({ ok: true, user: userPublic(user), resetToken: rt.token, resetUrl: resetPath, absoluteResetUrl: resetUrl, expiresAt: rt.expiresAt, emailSent });
}));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Unknown API route.' });
});

/* --------------------------------------------------------------- static */

const PRIVATE_PATHS = [
  /^\/server(\/|$)/i,
  /^\/data(\/|$)/i,
  /^\/node_modules(\/|$)/i,
  /^\/\.git(\/|$)/i,
  /^\/\.env(\.|$)/i,
  /^\/package(-lock)?\.json$/i,
  /^\/README\.md$/i
];

app.use((req, res, next) => {
  if (PRIVATE_PATHS.some((pattern) => pattern.test(req.path))) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }
  next();
});

// Clean URLs: /loans -> loans.html
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (path.extname(req.path)) return next();
  const name = req.path === '/' ? 'index' : req.path.replace(/\/+$/, '');
  res.sendFile(path.join(ROOT, name + '.html'), (error) => {
    if (error) next();
  });
});

app.use(express.static(ROOT, { dotfiles: 'ignore', extensions: ['html'], etag: true }));

app.use((req, res) => {
  res.status(404).sendFile(path.join(ROOT, '404.html'), (error) => {
    if (error) res.type('text/plain').send('Not found');
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error instanceof validate.HttpError ? error.status : (error.status || 500);
  if (status >= 500) console.error('[error]', error);
  if (req.path.startsWith('/api/')) {
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : error.message });
    return;
  }
  res.status(status).type('text/plain').send(status >= 500 ? 'Something went wrong.' : error.message);
});

/* ---------------------------------------------------------------- boot */

let bootPromise = null;

async function boot(options) {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    if (BOOT_FATAL) throw new Error(BOOT_FATAL);
    await store.load();

    if (typeof store.listUsers === 'function') {
      await ensureBootstrapUser();
    }

    if (typeof auth.init === 'function') {
      const sessionPersistence = (store.allSessions && store.saveSession && store.deleteSession)
        ? {
            loadAll: () => store.allSessions(),
            loadOne: (token) => store.getSession ? store.getSession(token) : Promise.resolve(null),
            save: (token, session) => store.saveSession(token, session),
            remove: (token) => store.deleteSession(token),
            removeExpired: () => store.deleteExpiredSessions ? store.deleteExpiredSessions() : Promise.resolve()
          }
        : null;
      const securityPersistence = (store.getSecurityState && store.setSecurityState)
        ? {
            load: () => store.getSecurityState(),
            save: (state) => store.setSecurityState(state)
          }
        : null;
      await auth.init(sessionPersistence, securityPersistence);
    }

    if (store.getSecurityState) {
      try { loadBucketsFromState(await store.getSecurityState()); } catch (e) { /* ignore */ }
    }

    const stats = await store.stats();
    const desc = typeof store.describe === 'function' ? store.describe() : { backend: store.BACKEND || 'unknown', location: '' };

    const opts = options || {};
    if (opts.listen !== false) {
      app.listen(PORT, () => {
        console.log('');
        console.log('  AS Financial backend running');
        console.log('  Site:        http://localhost:' + PORT + '/');
        console.log('  Admin:       http://localhost:' + PORT + '/admin.html');
        console.log('  Health:      http://localhost:' + PORT + '/api/health');
        console.log('  Storage:     ' + desc.backend + (desc.location ? ' (' + desc.location + ')' : ''));
        console.log('  Content:     ' + stats.publishedTestimonials + ' published testimonials, ' +
          stats.gallery + ' posters, ' + stats.images + ' image overrides, ' + stats.enquiries + ' enquiries');
        console.log('  Admin data:  ' + (stats.leads || 0) + ' leads, ' +
          (stats.customers || 0) + ' customers, ' + (stats.documents || 0) + ' documents, ' + (stats.notifications || 0) + ' notifications, ' + (stats.users || 0) + ' users');
        console.log('');
      });
    }

    return { stats, desc };
  })().catch((error) => {
    bootPromise = null;
    throw error;
  });
  return bootPromise;
}

if (require.main === module) {
  boot().catch((error) => {
    console.error('[boot] failed to start:', error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = app;
module.exports.app = app;
module.exports.boot = boot;
module.exports.ready = () => boot({ listen: false });
