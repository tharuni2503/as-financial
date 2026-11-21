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

function collectInlineScriptHashes() {
  try {
    const crypto = require('node:crypto');
    const files = fsSync.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
    const hashes = new Set();
    for (const f of files) {
      const html = fsSync.readFileSync(path.join(ROOT, f), 'utf8');
      const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = re.exec(html))) {
        const attrs = String(m[1] || '');
        const type = (attrs.match(/\btype=["']([^"']+)["']/i) || [])[1] || '';
        if (type && type.toLowerCase() !== 'text/javascript' && type.toLowerCase() !== 'module') continue;
        const content = String(m[2] || '');
        const hash = 'sha256-' + crypto.createHash('sha256').update(content, 'utf8').digest('base64');
        hashes.add("'" + hash + "'");
      }
    }
    return Array.from(hashes);
  } catch (err) {
    console.warn('[csp] inline script hash collection failed:', err && err.message ? err.message : err);
    return [];
  }
}
const INLINE_SCRIPT_HASHES = collectInlineScriptHashes();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@asfinancial.in').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AS@2026';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const TURNSTILE_SECRET = String(process.env.AS_TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY || '').trim();

async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) return { ok: true, skipped: true };
  const t = String(token || '').trim();
  if (!t) return { ok: false, error: 'Verification required. Please try again.' };
  try {
    const body = new URLSearchParams();
    body.set('secret', TURNSTILE_SECRET);
    body.set('response', t);
    if (ip) body.set('remoteip', String(ip));
    const ctrl = AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined;
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: ctrl
    });
    const json = await res.json().catch(() => ({}));
    if (json && json.success) return { ok: true };
    return { ok: false, error: 'Verification failed. Please try again.' };
  } catch (err) {
    console.warn('[turnstile] verification error:', err && err.message ? err.message : err);
    return { ok: false, error: 'Verification unavailable. Please try again shortly.' };
  }
}

if (!process.env.ADMIN_PASSWORD) {
  if (IS_PRODUCTION) {
    console.error('[auth] ADMIN_PASSWORD must be set when NODE_ENV=production. Refusing to start with the default demo password.');
    process.exit(1);
  }
  console.warn('[auth] Using the default demo admin password. Set ADMIN_PASSWORD before going live.');
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
  const secure = cookieSecure(req);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (req.path === '/admin.html' || req.path.startsWith('/admin') || req.path.startsWith('/api/admin')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  if (secure || IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // Transitional CSP: allows current inline scripts/styles and Google Fonts used by the site.
  // Tighten further by migrating inline scripts/styles to nonces or hashed external files.
  const scriptSrc = ["'self'", "'unsafe-inline'"].concat(INLINE_SCRIPT_HASHES).join(' ');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' https://fonts.gstatic.com data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src " + scriptSrc,
    "connect-src 'self'",
    "form-action 'self'",
    "frame-src 'self' https://www.google.com https://maps.google.com"
  ].join('; '));
  next();
});

app.use(express.json({ limit: '10mb' }));

const API_LIMIT = Number(process.env.AS_API_RATE_LIMIT || 300);
const API_WINDOW_MS = 5 * 60 * 1000;

async function takeLimit(key, limit, windowMs) {
  if (store && typeof store.takeRateLimit === 'function') {
    return store.takeRateLimit(key, limit, windowMs);
  }
  const now = Date.now();
  const k = String(key || 'unknown');
  const bucket = takeLimit._mem.get(k);
  if (!bucket || bucket.resetAt <= now) {
    const rec = { count: 1, resetAt: now + windowMs };
    takeLimit._mem.set(k, rec);
    return { allowed: 1 <= limit, remaining: Math.max(0, limit - 1), resetAt: new Date(rec.resetAt).toISOString(), count: 1, limit };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), resetAt: new Date(bucket.resetAt).toISOString(), count: bucket.count, limit };
}
takeLimit._mem = new Map();

async function apiRateLimited(ip) {
  const r = await takeLimit('api:' + String(ip || 'unknown'), API_LIMIT, API_WINDOW_MS);
  return !r.allowed;
}

app.use('/api', asyncRoute(async (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const started = Date.now();
  res.on('finish', () => {
    console.log('[api]', req.method, req.originalUrl, res.statusCode, (Date.now() - started) + 'ms');
  });
  if (await apiRateLimited(req.ip)) {
    res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    return;
  }
  next();
}));

const ENQUIRY_LIMIT = 6;
const ENQUIRY_WINDOW_MS = 10 * 60 * 1000;

async function enquiryRateLimited(ip) {
  const r = await takeLimit('enquiry:' + String(ip || 'unknown'), ENQUIRY_LIMIT, ENQUIRY_WINDOW_MS);
  return !r.allowed;
}

function requireSession(req, res, next) {
  const session = auth.read(auth.tokenFrom(req));
  if (!session) {
    res.status(401).json({ error: 'Please sign in again.' });
    return;
  }
  req.session = session;
  req.authToken = auth.tokenFrom(req);
  next();
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

function bucketHits(rec) {
  if (Array.isArray(rec)) return rec;
  if (rec && Array.isArray(rec.hits)) return rec.hits;
  return [];
}

function pruneBucketMap(map, windowMs) {
  const now = Date.now();
  const w = windowMs || 15 * 60 * 1000;
  let changed = false;
  map.forEach((rec, key) => {
    const hits = bucketHits(rec).filter((t) => now - Number(t) < w);
    if (hits.length) {
      if (Array.isArray(rec)) map.set(key, hits);
      else rec.hits = hits;
    } else {
      map.delete(key);
      changed = true;
    }
  });
  if (map.size > 5000) { map.clear(); changed = true; }
  return changed;
}

function serializeBucketMap(map, windowMs) {
  const now = Date.now();
  const w = windowMs || 15 * 60 * 1000;
  const out = {};
  map.forEach((rec, key) => {
    const hits = bucketHits(rec).filter((t) => now - Number(t) < w).slice(-100);
    if (hits.length) out[key] = { hits };
  });
  return out;
}

function loadBucketsFromState(state) {
  // Legacy in-memory bucket restore. Atomic DB rate limiting (store.takeRateLimit) is preferred when available.
  const sec = state && typeof state === 'object' ? state : {};
  const pw = sec.pwBuckets && typeof sec.pwBuckets === 'object' ? sec.pwBuckets : {};
  const enq = sec.enquiryBuckets && typeof sec.enquiryBuckets === 'object' ? sec.enquiryBuckets : {};
  const api = sec.apiBuckets && typeof sec.apiBuckets === 'object' ? sec.apiBuckets : {};
  const mem = takeLimit && takeLimit._mem ? takeLimit._mem : null;
  if (!mem) return;
  const now = Date.now();
  const restore = (src, prefix, windowMs) => {
    Object.keys(src).forEach((k) => {
      const hits = bucketHits(src[k]).filter((t) => now - Number(t) < windowMs);
      if (!hits.length) return;
      const resetAt = Math.max(...hits) + windowMs;
      if (resetAt > now) mem.set(prefix + k, { count: hits.length, resetAt });
    });
  };
  restore(pw, 'pw:', 15 * 60 * 1000);
  restore(enq, 'enquiry:', ENQUIRY_WINDOW_MS);
  restore(api, 'api:', API_WINDOW_MS);
}

async function persistSecurityNow() {
  if (!store || typeof store.getSecurityState !== 'function' || typeof store.setSecurityState !== 'function') return;
  try {
    const state = await store.getSecurityState() || {};
    // When DB atomic rate limiting is active, in-memory buckets are not authoritative.
    if (!(store && typeof store.takeRateLimit === 'function')) {
      const mem = takeLimit && takeLimit._mem ? takeLimit._mem : new Map();
      const toBuckets = (prefix) => {
        const out = {};
        mem.forEach((rec, key) => {
          if (!key.startsWith(prefix) || !rec || rec.resetAt <= Date.now()) return;
          out[key.slice(prefix.length)] = { hits: Array.from({ length: Math.min(rec.count, 100) }, (_, i) => rec.resetAt - 1 - i) };
        });
        return out;
      };
      state.pwBuckets = toBuckets('pw:');
      state.enquiryBuckets = toBuckets('enquiry:');
      state.apiBuckets = toBuckets('api:');
    }
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
  const session = auth.read(auth.tokenFrom(req));
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

app.get('/api/content', asyncRoute(async (req, res) => {
  const session = auth.read(auth.tokenFrom(req));
  const wantsAdmin = req.query.scope === 'admin';
  const canViewAdmin = Boolean(session) && roleAtLeast(session.role || 'advisor', 'admin');
  const admin = wantsAdmin && canViewAdmin;
  const content = await store.content();
  const stats = await store.stats();

  res.json({
    scope: admin ? 'admin' : 'public',
    updatedAt: stats.updatedAt,
    testimonials: admin ? content.testimonials : content.testimonials.filter((item) => item && item.published),
    gallery: content.gallery,
    posts: admin ? content.posts : content.posts.filter((item) => item && item.published),
    lenders: admin ? (content.lenders || []) : (content.lenders || []).filter((item) => item && item.active !== false && item.published !== false),
    images: content.images
  });
}));

app.put('/api/content/:section', requireSession, requireRole('admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
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
  if (await enquiryRateLimited(ip)) {
    res.status(429).json({ error: 'Too many enquiries from this connection. Please call us instead.' });
    return;
  }

  const turnstile = await verifyTurnstile(req.body && (req.body.turnstileToken || req.body['cf-turnstile-response']), ip);
  if (!turnstile.ok) {
    res.status(400).json({ error: turnstile.error || 'Verification failed. Please try again.' });
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
        message: [enquiry.name, enquiry.phone, enquiry.product].filter(Boolean).join(' â€¢ ').slice(0, 240),
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

app.get('/api/enquiries', requireSession, requireRole('admin', 'super_admin'), asyncRoute(async (req, res) => {
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

app.patch('/api/enquiries/:id', requireSession, requireRole('admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const patch = {};
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

app.delete('/api/enquiries/:id', requireSession, requireRole('admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  const removed = await store.removeEnquiry(id);
  if (!removed) {
    res.status(404).json({ error: 'Enquiry not found.' });
    return;
  }
  audit(req, { type: 'enquiry.deleted', summary: 'Enquiry deleted: ' + id, targetType: 'enquiry', targetId: id });
  res.json({ ok: true });
}));

app.get('/api/admin/store', requireSession, requireRole('admin', 'super_admin'), asyncRoute(async (req, res) => {
  const admin = await store.adminData();
  const stats = await store.stats();
  res.json({
    ok: true,
    updatedAt: stats.updatedAt,
    leads: admin.leads || [],
    applications: admin.applications || [],
    products: admin.products || [],
    partners: admin.partners || [],
    tasks: admin.tasks || [],
    customers: admin.customers || [],
    documents: admin.documents || [],
    notifications: admin.notifications || [],
    settings: admin.settings || {}
  });
}));

app.put('/api/admin/store/:name', requireSession, requireRole('admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
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

app.get('/api/admin/:collection', requireSession, requireRole('admin', 'super_admin'), asyncRoute(async (req, res, next) => {
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
  if (['leads', 'applications', 'customers', 'tasks', 'documents'].includes(collection)) {
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
  if (collection === 'applications' && !out.stage) out.stage = existing && existing.stage ? existing.stage : 'Logged';

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

app.post('/api/admin/:collection', requireSession, requireRole('admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res, next) => {
  const collection = String(req.params.collection || '').toLowerCase();
  if (!isAdminItemCollection(collection)) return next();
  const items = await readAdminCollection(collection);
  const body = validate.adminItem ? validate.adminItem(req.body || {}) : (req.body || {});
  const now = new Date().toISOString();
  const prefixes = { leads: 'LEAD', applications: 'APP', products: 'PRD', partners: 'PRT', tasks: 'TSK', customers: 'CUS', documents: 'DOC', notifications: 'NTF' };
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

app.get('/api/admin/:collection/:id', requireSession, requireRole('admin', 'super_admin'), asyncRoute(async (req, res, next) => {
  const collection = String(req.params.collection || '').toLowerCase();
  if (collection === 'store') return next();
  if (!isAdminItemCollection(collection)) return next();
  const id = String(req.params.id || '');
  const items = await readAdminCollection(collection);
  const item = items.find((x) => x && String(x.id) === id);
  if (!item) { res.status(404).json({ error: 'Item not found.' }); return; }
  res.json({ ok: true, collection, item });
}));

app.patch('/api/admin/:collection/:id', requireSession, requireRole('admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res, next) => {
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

app.delete('/api/admin/:collection/:id', requireSession, requireRole('admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res, next) => {
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

/* ----------------------------------------------- auto logo resolve */

const LENDER_LOGO_ASSETS = (() => {
  const dir = path.join(ROOT, 'assets', 'img', 'lenders');
  const map = {
    'sbi': 'sbi', 'state bank of india': 'sbi', 'hdfc bank': 'hdfc-bank', 'icici bank': 'icici-bank', 'axis bank': 'axis-bank',
    'kotak mahindra bank': 'kotak-mahindra-bank', 'bank of baroda': 'bank-of-baroda', 'canara bank': 'canara-bank',
    'union bank of india': 'union-bank-of-india', 'punjab national bank': 'punjab-national-bank', 'indian bank': 'indian-bank',
    'idfc first bank': 'idfc-first-bank', 'yes bank': 'yes-bank', 'federal bank': 'federal-bank', 'indusind bank': 'indusind-bank',
    'bandhan bank': 'bandhan-bank', 'uco bank': 'uco-bank', 'central bank of india': 'central-bank-of-india',
    'indian overseas bank': 'indian-overseas-bank', 'bank of india': 'bank-of-india', 'idbi bank': 'idbi-bank',
    'bajaj finserv': 'bajaj-finserv', 'bajaj housing finance': 'bajaj-finserv', 'bajaj finance': 'bajaj-finserv',
    'tata capital': 'tata-capital', 'hdb financial services': 'hdb-financial-services', 'l&t finance': 'lt-finance',
    'lic housing finance': 'lic-housing-finance', 'muthoot finance': 'muthoot-finance', 'shriram finance': 'shriram-finance',
    'cholamandalam': 'cholamandalam', 'edelweiss': 'edelweiss', 'iifl finance': 'iifl-finance', 'sundaram finance': 'sundaram-finance',
    'mahindra finance': 'mahindra-finance', 'hero fincorp': 'hero-fincorp', 'shriram city': 'shriram-city',
    'creditaccess grameen': 'creditaccess-grameen', 'tata motors finance': 'tata-motors-finance', 'reliance home finance': 'reliance-home-finance'
  };
  const out = {};
  Object.keys(map).forEach((name) => {
    const base = map[name];
    const exts = ['.svg', '.png', '.jpg', '.webp'];
    for (let i = 0; i < exts.length; i++) {
      const file = base + exts[i];
      try {
        if (fs.existsSync(path.join(dir, file))) { out[name] = 'assets/img/lenders/' + file; return; }
      } catch (e) { /* ignore */ }
    }
  });
  return out;
})();

function normalizeBankName(name) {
  return String(name || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9&]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function findLocalLenderLogo(name) {
  const n = normalizeBankName(name);
  if (!n) return '';
  if (LENDER_LOGO_ASSETS[n]) return LENDER_LOGO_ASSETS[n];
  const keys = Object.keys(LENDER_LOGO_ASSETS);
  for (let i = 0; i < keys.length; i++) {
    if (n === keys[i] || n.indexOf(keys[i]) > -1 || keys[i].indexOf(n) > -1) return LENDER_LOGO_ASSETS[keys[i]];
  }
  return '';
}

function guessDomains(name) {
  const n = normalizeBankName(name).replace(/&/g, 'and');
  const compact = n.replace(/[^a-z0-9]/g, '');
  const words = n.split(' ').filter(Boolean);
  const joined = words.join('');
  const noCommon = words.filter(w => !/^(bank|finance|financial|services|service|ltd|limited|india|of|the|co|company)$/.test(w)).join('');
  const candidates = new Set();
  [compact, joined, noCommon].forEach((v) => {
    if (!v || v.length < 3) return;
    candidates.add(v + '.com');
    candidates.add(v + '.co.in');
    candidates.add(v + '.in');
  });
  if (words[0] && words[0].length >= 3) {
    candidates.add(words[0] + 'bank.com');
    candidates.add(words[0] + '.com');
  }
  return Array.from(candidates).slice(0, 8);
}

async function fetchLogoFromInternet(name) {
  if (typeof fetch !== 'function') return '';
  const domains = guessDomains(name);
  const urls = [];
  domains.forEach((d) => {
    urls.push('https://www.google.com/s2/favicons?domain=' + encodeURIComponent(d) + '&sz=128');
    urls.push('https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://' + encodeURIComponent(d) + '&size=128');
  });
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = setTimeout(() => { try { if (ctrl) ctrl.abort(); } catch (e) {} }, 7000);
      const res = await fetch(url, Object.assign({ redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } }, ctrl ? { signal: ctrl.signal } : {}));
      clearTimeout(timer);
      if (!res || !res.ok) continue;
      const ct = String(res.headers.get('content-type') || '').toLowerCase();
      if (!/^image\//.test(ct) && ct.indexOf('icon') === -1 && ct.indexOf('octet-stream') === -1) continue;
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      if (!buf || buf.length < 80) continue; // skip tiny/invalid placeholders
      let mime = ct.split(';')[0].trim();
      if (!/^image\//.test(mime)) {
        if (buf[0] === 0x89 && buf[1] === 0x50) mime = 'image/png';
        else if (buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg';
        else if (buf.slice(0, 4).toString() === 'RIFF') mime = 'image/webp';
        else mime = 'image/png';
      }
      return 'data:' + mime + ';base64,' + buf.toString('base64');
    } catch (e) { /* try next */ }
  }
  return '';
}

app.post('/api/admin/resolve-logo', requireSession, requireRole('admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const name = validate.text(body.name, 120, { label: 'name' });
  if (!name) { res.status(400).json({ error: 'Bank/lender name is required.' }); return; }
  let logo = findLocalLenderLogo(name);
  let source = logo ? 'local' : '';
  if (!logo) {
    logo = await fetchLogoFromInternet(name);
    source = logo ? 'internet' : '';
  }
  res.json({ ok: true, name, logo: logo || '', source: source || 'none' });
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

app.post('/api/admin/uploads', requireSession, requireRole('admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
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

app.get('/api/admin/uploads/:file', requireSession, requireRole('admin', 'super_admin'), asyncRoute(async (req, res) => {
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
  const ext = path.extname(name).toLowerCase();
  const inlineTypes = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.txt', '.csv']);
  const disposition = (inlineTypes.has(ext) ? 'inline' : 'attachment') + '; filename="' + path.basename(name) + '"';
  res.sendFile(resolved, {
    dotfiles: 'deny',
    headers: {
      'Content-Disposition': disposition,
      'X-Content-Type-Options': 'nosniff'
    }
  });
}));

/* --------------------------------------------------- password & users */

async function pwRateLimited(ip, limit, windowMs) {
  const r = await takeLimit('pw:' + String(ip || 'unknown'), limit || 10, windowMs || 15 * 60 * 1000);
  return !r.allowed;
}

function validatePassword(pw) {
  const s = String(pw || '');
  if (s.length < 6) return 'Password must be at least 6 characters.';
  if (s.length > 200) return 'Password is too long.';
  return null;
}

function normalizeRole(role) {
  const r = String(role || '').toLowerCase();
  return ['advisor', 'staff', 'admin', 'super_admin'].includes(r) ? r : null;
}

function userPublic(user) {
  return auth.publicUser ? auth.publicUser(user) : { id: user.id, email: user.email, role: user.role, active: user.active !== false };
}

app.post('/api/change-password', requireSession, requireCsrf, asyncRoute(async (req, res) => {
  const ip = req.ip || 'unknown';
  if (await pwRateLimited(ip, 12, 15 * 60 * 1000)) {
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
  if (await pwRateLimited('forgot:' + ip, 6, 15 * 60 * 1000)) {
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
  const resetUrl = (mailer && mailer.absoluteResetUrl) ? mailer.absoluteResetUrl(resetPath) : '';
  let mailResult = { sent: false, configured: false };
  const emailConfigured = !!(mailer && mailer.isConfigured && mailer.isConfigured());
  if (emailConfigured && resetUrl) {
    mailResult = await mailer.sendPasswordReset({ to: user.email, name: user.name, resetUrl, expiresAt: rt.expiresAt })
      .catch(() => ({ sent: false, fallback: true, reason: 'send_exception' }));
    mailResult.configured = true;
  } else {
    mailResult = { sent: false, configured: emailConfigured, reason: !emailConfigured ? 'not_configured' : 'app_url_missing' };
  }
  const emailSent = !!mailResult.sent;
  if (IS_PRODUCTION && !emailSent) {
    console.warn('[auth] Password reset requested in production but email was not delivered (configured=' + emailConfigured + ', reason=' + (mailResult.reason || 'unknown') + ') for', user.email);
  }
  audit(req, { type: 'auth.forgot_password', actorEmail: user.email, summary: 'Password reset requested', targetType: 'user', targetId: user.id, meta: { emailSent, emailConfigured, reason: mailResult.reason || null } });
  console.log('[auth] Password reset requested for', user.email, 'expires', rt.expiresAt, 'emailSent=' + emailSent + ' emailConfigured=' + emailConfigured);
  if (!IS_PRODUCTION) {
    res.json(Object.assign({}, generic, { devResetToken: rt.token, devResetUrl: resetPath, resetUrl: resetUrl || resetPath, expiresAt: rt.expiresAt, emailSent, emailConfigured }));
  } else {
    // In production do not expose tokens or reset URLs.
    res.json(Object.assign({}, generic, { emailSent, emailConfigured }));
  }
}));

app.post('/api/reset-password', asyncRoute(async (req, res) => {
  const ip = req.ip || 'unknown';
  if (await pwRateLimited('reset:' + ip, 10, 15 * 60 * 1000)) {
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

app.get('/api/sessions', requireSession, requireRole('admin', 'super_admin'), asyncRoute(async (req, res) => {
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
  const role = normalizeRole(body.role) || 'advisor';
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
  const absoluteResetUrl = (mailer && mailer.absoluteResetUrl) ? mailer.absoluteResetUrl(resetPath) : '';
  let emailSent = false;
  const emailConfigured = !!(mailer && mailer.isConfigured && mailer.isConfigured());
  if (emailConfigured && absoluteResetUrl) {
    const mailResult = await mailer.sendPasswordReset({ to: user.email, name: user.name, resetUrl: absoluteResetUrl, expiresAt: rt.expiresAt }).catch(() => ({ sent: false }));
    emailSent = !!(mailResult && mailResult.sent);
  }
  audit(req, { type: 'user.reset_token_generated', summary: 'Reset token generated for ' + user.email, targetType: 'user', targetId: user.id, meta: { emailSent, emailConfigured } });
  console.log('[auth] Reset token generated for', user.email, 'expires', rt.expiresAt, 'emailSent=' + emailSent);
  const response = { ok: true, user: userPublic(user), expiresAt: rt.expiresAt, emailSent, emailConfigured };
  if (!IS_PRODUCTION) {
    response.resetToken = rt.token;
    response.resetUrl = resetPath;
    response.absoluteResetUrl = absoluteResetUrl || resetPath;
  }
  res.json(response);
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
  res.sendFile(path.join(ROOT, name + '.html'), { headers: { 'Cache-Control': 'no-cache' } }, (error) => {
    if (error) next();
  });
});

// Block static serving of internal/sensitive project files.
app.use((req, res, next) => {
  const p = String(req.path || '/').toLowerCase();
  const blockedPrefixes = ['/server/', '/data/', '/tests/', '/node_modules/', '/.git/', '/.github/', '/.vscode/', '/.opencode/', '/.agents/'];
  if (blockedPrefixes.some((prefix) => p === prefix.slice(0, -1) || p.startsWith(prefix))) {
    return res.status(404).type('text/plain').send('Not found');
  }
  const base = path.posix.basename(p);
  const blockedNames = new Set(['.env', '.env.example', '.gitignore', '.vercelignore', 'package.json', 'package-lock.json', 'vercel.json', 'implementation_plan.md', 'readme.md']);
  const blockedExts = ['.md', '.bak', '.lock', '.sql', '.map', '.pem', '.key', '.pfx', '.p12', '.crt'];
  if (blockedNames.has(base) || blockedExts.some((ext) => base.endsWith(ext))) {
    return res.status(404).type('text/plain').send('Not found');
  }
  if (base.startsWith('.env')) {
    return res.status(404).type('text/plain').send('Not found');
  }
  next();
});

app.use('/assets', express.static(path.join(ROOT, 'assets'), {
  dotfiles: 'ignore',
  etag: true,
  maxAge: IS_PRODUCTION ? '7d' : 0,
  setHeaders(res, filePath) {
    if (/\.(html?)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.use(express.static(ROOT, {
  dotfiles: 'ignore',
  extensions: ['html'],
  etag: true,
  setHeaders(res, filePath) {
    if (/\.(html?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(css|js|mjs|svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf)$/i.test(filePath)) {
      res.setHeader('Cache-Control', IS_PRODUCTION ? 'public, max-age=3600' : 'no-cache');
    }
  }
}));

app.use((req, res) => {
  res.status(404).sendFile(path.join(ROOT, '404.html'), { headers: { 'Cache-Control': 'no-cache' } }, (error) => {
    if (error) res.type('text/plain').send('Not found');
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const isHttpError = error instanceof validate.HttpError;
  const status = isHttpError ? error.status : (Number(error && error.status) || 500);
  if (status >= 500) console.error('[error]', error);
  const safeClientMessage = status >= 500
    ? 'Something went wrong. Please try again.'
    : (isHttpError ? String(error.message || 'Request could not be completed.') : 'Request could not be completed.');
  if (req.path.startsWith('/api/')) {
    res.status(status).json({ error: safeClientMessage });
    return;
  }
  res.status(status).type('text/plain').send(status >= 500 ? 'Something went wrong.' : safeClientMessage);
});

/* ---------------------------------------------------------------- boot */

let bootPromise = null;

async function boot(options) {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    await store.load();

    if (typeof store.listUsers === 'function') {
      await ensureBootstrapUser();
    }

    if (typeof auth.init === 'function') {
      const sessionPersistence = (store.allSessions && store.saveSession && store.deleteSession)
        ? {
            loadAll: () => store.allSessions(),
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
        console.log('  Admin data:  ' + (stats.leads || 0) + ' leads, ' + (stats.applications || 0) + ' applications, ' +
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

