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
 *   POST   /api/enquiries              website enquiry (public, rate limited)
 *   GET    /api/enquiries              list enquiries (auth)
 *   PATCH  /api/enquiries/:id          mark handled / add a note (auth + csrf)
 *   DELETE /api/enquiries/:id          remove an enquiry (auth + csrf)
 *
 * Storage: PostgreSQL when DATABASE_URL/POSTGRES_URL is set, otherwise JSON file (data/db.json).
 */

const path = require('node:path');
const express = require('express');

const store = require('./store');
const auth = require('./auth');
const validate = require('./validate');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@asfinancial.in').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AS@2026';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(express.json({ limit: '6mb' }));

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
  return hits.length > ENQUIRY_LIMIT;
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

function requireRole(...roles) {
  const allowed = roles && roles.length ? roles : ['staff', 'admin', 'super_admin'];
  return (req, res, next) => {
    if (!req.session) {
      res.status(401).json({ error: 'Please sign in again.' });
      return;
    }
    const role = req.session.role || 'advisor';
    const ok = allowed.some((r) => role === r || (ROLE_RANK[role] || 0) >= (ROLE_RANK[r] || 99));
    if (!ok) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }
    next();
  };
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/* ------------------------------------------------------------------ api */

app.get('/api/health', (req, res) => {
  const desc = typeof store.describe === 'function' ? store.describe() : { backend: store.BACKEND || 'unknown' };
  res.json({ ok: true, service: 'as-financial', backend: desc.backend, time: new Date().toISOString() });
});

app.post('/api/login', asyncRoute(async (req, res) => {
  const ip = req.ip || 'unknown';
  if (auth.tooManyAttempts(ip)) {
    res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
    return;
  }

  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
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
    res.status(401).json({ error: 'Those details do not match our records.' });
    return;
  }

  auth.clearAttempts(ip);
  user.lastLoginAt = new Date().toISOString();
  if (store.upsertUser) await store.upsertUser(user);

  const issued = await auth.issue(user.email, user.role || 'admin', {
    userId: user.id,
    ip,
    userAgent: req.get('user-agent') || ''
  });
  res.setHeader('Set-Cookie', auth.cookieHeader(issued.token, { maxAgeMs: auth.SESSION_TTL_MS, secure: cookieSecure(req) }));
  const pub = auth.publicUser ? auth.publicUser(user) : { email: user.email, role: user.role };
  res.json(Object.assign({ ok: true, csrfToken: issued.csrfToken, expiresIn: auth.SESSION_TTL_MS }, pub));
}));

app.post('/api/logout', requireSession, requireCsrf, asyncRoute(async (req, res) => {
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
  const admin = req.query.scope === 'admin' && Boolean(session);
  const content = await store.content();
  const stats = await store.stats();

  res.json({
    scope: admin ? 'admin' : 'public',
    updatedAt: stats.updatedAt,
    testimonials: admin ? content.testimonials : content.testimonials.filter((item) => item && item.published),
    gallery: content.gallery,
    posts: admin ? content.posts : content.posts.filter((item) => item && item.published),
    images: content.images
  });
}));

app.put('/api/content/:section', requireSession, requireRole('staff', 'admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const section = String(req.params.section || '').toLowerCase();
  const value = validate.content(section, req.body);
  await store.setSection(section, value);
  const stats = await store.stats();
  res.json({ ok: true, section, count: Array.isArray(value) ? value.length : Object.keys(value).length, updatedAt: stats.updatedAt });
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

  res.status(201).json({ ok: true, id: enquiry.id });
}));

app.get('/api/enquiries', requireSession, requireRole('advisor', 'staff', 'admin', 'super_admin'), asyncRoute(async (req, res) => {
  const enquiries = await store.listEnquiries();
  const stats = await store.stats();
  res.json({ enquiries, stats });
}));

app.patch('/api/enquiries/:id', requireSession, requireRole('advisor', 'staff', 'admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const patch = {};
  if (req.body && typeof req.body.handled === 'boolean') patch.handled = req.body.handled;
  if (req.body && typeof req.body.note === 'string') patch.note = validate.text(req.body.note, 500);
  const updated = await store.updateEnquiry(String(req.params.id), patch);
  if (!updated) {
    res.status(404).json({ error: 'Enquiry not found.' });
    return;
  }
  res.json({ ok: true, enquiry: updated });
}));

app.delete('/api/enquiries/:id', requireSession, requireRole('staff', 'admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const removed = await store.removeEnquiry(String(req.params.id));
  if (!removed) {
    res.status(404).json({ error: 'Enquiry not found.' });
    return;
  }
  res.json({ ok: true });
}));

app.get('/api/admin/store', requireSession, requireRole('staff', 'admin', 'super_admin'), asyncRoute(async (req, res) => {
  const admin = await store.adminData();
  const stats = await store.stats();
  res.json({
    ok: true,
    updatedAt: stats.updatedAt,
    leads: admin.leads,
    applications: admin.applications,
    products: admin.products,
    partners: admin.partners,
    tasks: admin.tasks,
    settings: admin.settings
  });
}));

app.put('/api/admin/store/:name', requireSession, requireRole('staff', 'admin', 'super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const name = String(req.params.name || '').toLowerCase();
  const value = validate.adminCollection(name, req.body);
  await store.setAdminCollection(name, value);
  const stats = await store.stats();
  res.json({
    ok: true,
    name,
    count: Array.isArray(value) ? value.length : Object.keys(value).length,
    updatedAt: stats.updatedAt
  });
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
  return ['advisor', 'staff', 'admin', 'super_admin'].includes(r) ? r : null;
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
  user.resetToken = rt.token;
  user.resetExpiresAt = rt.expiresAt;
  await store.upsertUser(user);
  const resetUrl = '/admin.html?reset=' + encodeURIComponent(rt.token);
  console.log('[auth] Password reset requested for', user.email, 'token expires', rt.expiresAt, 'url', resetUrl);
  if (!IS_PRODUCTION) {
    res.json(Object.assign({}, generic, { devResetToken: rt.token, devResetUrl: resetUrl, expiresAt: rt.expiresAt }));
  } else {
    res.json(generic);
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
  res.json({ ok: true, message: 'Password updated. You can now sign in.' });
}));

app.get('/api/users', requireSession, requireRole('super_admin', 'admin'), asyncRoute(async (req, res) => {
  const users = store.listUsers ? await store.listUsers() : [];
  res.json({ users: users.map(userPublic) });
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
  res.json({ ok: true, user: userPublic(user) });
}));

app.post('/api/users/:id/reset-token', requireSession, requireRole('super_admin'), requireCsrf, asyncRoute(async (req, res) => {
  const user = await store.findUserById(String(req.params.id || ''));
  if (!user) { res.status(404).json({ error: 'User not found.' }); return; }
  const rt = auth.makeResetToken();
  user.resetToken = rt.token;
  user.resetExpiresAt = rt.expiresAt;
  await store.upsertUser(user);
  const resetUrl = '/admin.html?reset=' + encodeURIComponent(rt.token);
  console.log('[auth] Reset token generated for', user.email, 'expires', rt.expiresAt);
  res.json({ ok: true, user: userPublic(user), resetToken: rt.token, resetUrl, expiresAt: rt.expiresAt });
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

async function boot() {
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
    await auth.init(sessionPersistence);
  }

  const stats = await store.stats();
  const desc = typeof store.describe === 'function' ? store.describe() : { backend: store.BACKEND || 'unknown', location: '' };

  app.listen(PORT, () => {
    console.log('');
    console.log('  AS Financial backend running');
    console.log('  Site:        http://localhost:' + PORT + '/');
    console.log('  Admin:       http://localhost:' + PORT + '/admin.html');
    console.log('  Health:      http://localhost:' + PORT + '/api/health');
    console.log('  Storage:     ' + desc.backend + (desc.location ? ' (' + desc.location + ')' : ''));
    console.log('  Content:     ' + stats.publishedTestimonials + ' published testimonials, ' +
      stats.gallery + ' posters, ' + stats.images + ' image overrides, ' + stats.enquiries + ' enquiries');
    console.log('  Admin data:  ' + stats.leads + ' leads, ' + stats.applications + ' applications, ' + (stats.users || 0) + ' users');
    console.log('');
  });
}

boot().catch((error) => {
  console.error('[boot] failed to start:', error && error.message ? error.message : error);
  process.exit(1);
});
