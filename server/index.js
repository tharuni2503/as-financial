'use strict';

/*
 * AS Financial Services and Solutions - site + content API.
 *
 * Serves the static site from the project root and exposes a small JSON API:
 *   GET    /api/health                 liveness probe
 *   POST   /api/login                  { email, password } -> bearer token
 *   POST   /api/logout                 revoke the current token
 *   GET    /api/session                who is signed in
 *   GET    /api/content[?scope=admin]  published content (admin scope needs auth)
 *   PUT    /api/content/:section       replace testimonials | gallery | posts | images
 *   POST   /api/enquiries              website enquiry (public, rate limited)
 *   GET    /api/enquiries              list enquiries (auth)
 *   PATCH  /api/enquiries/:id          mark handled / add a note (auth)
 *   DELETE /api/enquiries/:id          remove an enquiry (auth)
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

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[auth] Using the default demo admin password. Set ADMIN_PASSWORD before going live.');
}

const credential = auth.createCredential(ADMIN_EMAIL, ADMIN_PASSWORD);
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
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/* ------------------------------------------------------------------ api */

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'as-financial', time: new Date().toISOString() });
});

app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (auth.tooManyAttempts(ip)) {
    res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
    return;
  }

  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');

  const emailMatches = email === credential.email;
  const passwordMatches = auth.verifyPassword(credential, password);

  if (!emailMatches || !passwordMatches) {
    auth.noteFailedAttempt(ip);
    res.status(401).json({ error: 'Those details do not match our records.' });
    return;
  }

  auth.clearAttempts(ip);
  const token = auth.issue(credential.email);
  res.json({ token, email: credential.email, expiresIn: auth.SESSION_TTL_MS });
});

app.post('/api/logout', (req, res) => {
  auth.revoke(auth.tokenFrom(req));
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  const session = auth.read(auth.tokenFrom(req));
  if (!session) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  res.json({ email: session.email, expiresAt: new Date(session.expiresAt).toISOString() });
});

app.get('/api/content', (req, res) => {
  const session = auth.read(auth.tokenFrom(req));
  const admin = req.query.scope === 'admin' && Boolean(session);
  const content = store.content();
  const stats = store.stats();

  res.json({
    scope: admin ? 'admin' : 'public',
    updatedAt: stats.updatedAt,
    testimonials: admin ? content.testimonials : content.testimonials.filter((item) => item && item.published),
    gallery: content.gallery,
    posts: admin ? content.posts : content.posts.filter((item) => item && item.published),
    images: content.images
  });
});

app.put('/api/content/:section', requireSession, (req, res) => {
  const section = String(req.params.section || '').toLowerCase();
  const value = validate.content(section, req.body);
  store.setSection(section, value);
  res.json({ ok: true, section, count: Array.isArray(value) ? value.length : Object.keys(value).length, updatedAt: store.stats().updatedAt });
});

app.post('/api/enquiries', (req, res) => {
  const ip = req.ip || 'unknown';
  if (enquiryRateLimited(ip)) {
    res.status(429).json({ error: 'Too many enquiries from this connection. Please call us instead.' });
    return;
  }

  const data = validate.enquiry(req.body);
  if (!data) {
    // Honeypot tripped: answer normally, store nothing.
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

  store.addEnquiry(enquiry);
  console.log('[enquiry]', enquiry.id, enquiry.name, enquiry.phone, enquiry.product);

  res.status(201).json({ ok: true, id: enquiry.id });
});

app.get('/api/enquiries', requireSession, (req, res) => {
  res.json({ enquiries: store.listEnquiries(), stats: store.stats() });
});

app.patch('/api/enquiries/:id', requireSession, (req, res) => {
  const patch = {};
  if (req.body && typeof req.body.handled === 'boolean') patch.handled = req.body.handled;
  if (req.body && typeof req.body.note === 'string') patch.note = validate.text(req.body.note, 500);
  const updated = store.updateEnquiry(String(req.params.id), patch);
  if (!updated) {
    res.status(404).json({ error: 'Enquiry not found.' });
    return;
  }
  res.json({ ok: true, enquiry: updated });
});

app.delete('/api/enquiries/:id', requireSession, (req, res) => {
  const removed = store.removeEnquiry(String(req.params.id));
  if (!removed) {
    res.status(404).json({ error: 'Enquiry not found.' });
    return;
  }
  res.json({ ok: true });
});

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

store.load();
const stats = store.stats();

app.listen(PORT, () => {
  console.log('');
  console.log('  AS Financial backend running');
  console.log('  Site:        http://localhost:' + PORT + '/');
  console.log('  Admin:       http://localhost:' + PORT + '/admin.html');
  console.log('  Health:      http://localhost:' + PORT + '/api/health');
  console.log('  Data file:   ' + path.join(store.DATA_DIR, 'db.json'));
  console.log('  Content:     ' + stats.publishedTestimonials + ' published testimonials, ' +
    stats.gallery + ' posters, ' + stats.images + ' image overrides, ' + stats.enquiries + ' enquiries');
  console.log('');
});
