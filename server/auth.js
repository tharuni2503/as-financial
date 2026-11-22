'use strict';

/*
 * Admin authentication: scrypt password hashing and session tokens.
 * Sessions are cached in memory for fast sync reads and optionally persisted
 * via a store adapter so they survive server restarts.
 */

const crypto = require('node:crypto');

const COOKIE_NAME = 'as_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_REFRESH_MS = 30 * 60 * 1000; // extend when older than this
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

const sessions = new Map();
const attempts = new Map();
let persistence = null; // { loadAll, save, remove, removeExpired }
let securityPersistence = null; // { load, save }
let securitySaveTimer = null;

function pruneAttemptsMap(map) {
  const now = Date.now();
  let changed = false;
  map.forEach((record, key) => {
    if (!record || (record.resetAt && record.resetAt <= now)) { map.delete(key); changed = true; }
  });
  return changed;
}

function serializeAttempts() {
  const obj = {};
  attempts.forEach((record, key) => {
    if (record && record.resetAt > Date.now()) obj[key] = { count: record.count, resetAt: record.resetAt };
  });
  return obj;
}

async function persistAttemptsNow() {
  if (!securityPersistence || !securityPersistence.save) return;
  try {
    let state = {};
    if (securityPersistence.load) state = await Promise.resolve(securityPersistence.load()) || {};
    state.attempts = serializeAttempts();
    state.savedAt = Date.now();
    await Promise.resolve(securityPersistence.save(state));
  } catch (err) {
    console.warn('[auth] security persist failed:', err && err.message ? err.message : err);
  }
}

function scheduleAttemptsPersist(immediate) {
  if (!securityPersistence || !securityPersistence.save) return;
  if (immediate) {
    if (securitySaveTimer) { clearTimeout(securitySaveTimer); securitySaveTimer = null; }
    persistAttemptsNow();
    return;
  }
  if (securitySaveTimer) return;
  securitySaveTimer = setTimeout(() => {
    securitySaveTimer = null;
    persistAttemptsNow();
  }, 1500);
  if (securitySaveTimer.unref) securitySaveTimer.unref();
}

function createCredential(email, password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return {
    email: String(email).toLowerCase(),
    salt: salt.toString('hex'),
    hash: hash.toString('hex')
  };
}

function setPassword(user, password) {
  const cred = createCredential(user.email || '', password);
  user.salt = cred.salt;
  user.hash = cred.hash;
  user.passwordChangedAt = new Date().toISOString();
  user.resetToken = null;
  user.resetExpiresAt = null;
  return user;
}

function verifyPassword(credential, password) {
  if (!credential || typeof password !== 'string' || !password) return false;
  if (!credential.salt || !credential.hash) return false;
  try {
    const salt = Buffer.from(credential.salt, 'hex');
    const expected = Buffer.from(credential.hash, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (error) {
    return false;
  }
}

function persistSave(token, session) {
  if (!persistence || !persistence.save) return Promise.resolve();
  return Promise.resolve(persistence.save(token, session)).catch((err) => {
    console.warn('[auth] session persist failed:', err && err.message ? err.message : err);
  });
}

function persistRemove(token) {
  if (!persistence || !persistence.remove) return Promise.resolve();
  return Promise.resolve(persistence.remove(token)).catch((err) => {
    console.warn('[auth] session remove failed:', err && err.message ? err.message : err);
  });
}

async function init(storePersistence, secPersistence) {
  persistence = storePersistence || null;
  securityPersistence = secPersistence || null;
  sessions.clear();
  attempts.clear();
  if (persistence && persistence.loadAll) {
    try {
      const all = await persistence.loadAll();
      const now = Date.now();
      Object.keys(all || {}).forEach((token) => {
        const s = all[token];
        if (!s) return;
        const exp = typeof s.expiresAt === 'number' ? s.expiresAt : Date.parse(s.expiresAt);
        if (!exp || exp <= now) return;
        sessions.set(token, Object.assign({}, s, {
          id: s.id || null,
          expiresAt: exp,
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.parse(s.createdAt) || now,
          lastSeenAt: typeof s.lastSeenAt === 'number' ? s.lastSeenAt : (Date.parse(s.lastSeenAt) || now)
        }));
      });
      if (persistence.removeExpired) {
        await persistence.removeExpired().catch(() => {});
      }
    } catch (err) {
      console.warn('[auth] could not load persisted sessions:', err && err.message ? err.message : err);
    }
  }
  if (securityPersistence && securityPersistence.load) {
    try {
      const state = await securityPersistence.load();
      const stored = state && state.attempts && typeof state.attempts === 'object' ? state.attempts : {};
      const now = Date.now();
      Object.keys(stored).forEach((key) => {
        const rec = stored[key];
        if (!rec || !rec.resetAt || rec.resetAt <= now) return;
        attempts.set(key, { count: Number(rec.count) || 0, resetAt: Number(rec.resetAt) });
      });
      pruneAttemptsMap(attempts);
    } catch (err) {
      console.warn('[auth] could not load security state:', err && err.message ? err.message : err);
    }
  }
}

async function issue(email, role, meta) {
  const token = crypto.randomBytes(32).toString('base64url');
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const session = {
    id: crypto.randomBytes(12).toString('base64url'),
    email: String(email || '').toLowerCase(),
    role: role || 'admin',
    csrfToken,
    userId: meta && meta.userId ? meta.userId : null,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    lastSeenAt: now,
    ip: meta && meta.ip ? String(meta.ip).slice(0, 120) : '',
    userAgent: meta && meta.userAgent ? String(meta.userAgent).slice(0, 400) : ''
  };
  sessions.set(token, session);
  await persistSave(token, session);
  return { token, csrfToken, session };
}

async function read(token) {
  if (!token) return null;
  let session = sessions.get(token);
  if (!session && persistence && typeof persistence.loadOne === 'function') {
    try {
      const loaded = await persistence.loadOne(token);
      if (loaded) {
        const exp = typeof loaded.expiresAt === 'number' ? loaded.expiresAt : Date.parse(loaded.expiresAt);
        if (exp && exp > Date.now()) {
          session = Object.assign({}, loaded, {
            expiresAt: exp,
            createdAt: typeof loaded.createdAt === 'number' ? loaded.createdAt : Date.parse(loaded.createdAt) || Date.now(),
            lastSeenAt: typeof loaded.lastSeenAt === 'number' ? loaded.lastSeenAt : (Date.parse(loaded.lastSeenAt) || Date.now())
          });
          sessions.set(token, session);
        }
      }
    } catch (err) {
      console.warn('[auth] session load failed:', err && err.message ? err.message : err);
    }
  }
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt <= now) {
    sessions.delete(token);
    persistRemove(token);
    return null;
  }
  const last = session.lastSeenAt || session.createdAt || now;
  if (now - last > SESSION_REFRESH_MS || session.expiresAt - now < SESSION_REFRESH_MS) {
    session.lastSeenAt = now;
    session.expiresAt = now + SESSION_TTL_MS;
    persistSave(token, session);
  } else {
    session.lastSeenAt = now;
  }
  return session;
}

async function rotate(token, meta) {
  const current = await read(token);
  if (!current) return null;
  sessions.delete(token);
  await persistRemove(token);
  return issue(current.email, current.role, Object.assign({ userId: current.userId }, meta || {}));
}

async function revoke(token) {
  if (!token) return;
  sessions.delete(token);
  await persistRemove(token);
}

async function revokeAllForEmail(email) {
  const needle = String(email || '').toLowerCase();
  const tokens = [];
  sessions.forEach((s, t) => { if (String(s.email || '').toLowerCase() === needle) tokens.push(t); });
  await Promise.all(tokens.map((t) => revoke(t)));
}

function publicSessionInfo(session, token, currentToken) {
  if (!session) return null;
  return {
    id: session.id || null,
    email: session.email || '',
    role: session.role || '',
    userId: session.userId || null,
    createdAt: session.createdAt ? new Date(session.createdAt).toISOString() : null,
    expiresAt: session.expiresAt ? new Date(session.expiresAt).toISOString() : null,
    lastSeenAt: session.lastSeenAt ? new Date(session.lastSeenAt).toISOString() : null,
    ip: session.ip || '',
    userAgent: session.userAgent || '',
    current: Boolean(currentToken && token === currentToken)
  };
}

function listSessions(options) {
  const opts = options || {};
  const now = Date.now();
  const items = [];
  sessions.forEach((s, token) => {
    if (!s || s.expiresAt <= now) return;
    if (opts.email && String(s.email || '').toLowerCase() !== String(opts.email).toLowerCase()) return;
    if (opts.userId && String(s.userId || '') !== String(opts.userId)) return;
    items.push(publicSessionInfo(s, token, opts.currentToken));
  });
  items.sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
  return items.slice(0, 200);
}

async function revokeById(id, currentToken) {
  if (!id) return false;
  let foundToken = null;
  let found = null;
  sessions.forEach((s, t) => {
    if (!foundToken && s && s.id === id) { foundToken = t; found = s; }
  });
  if (!foundToken) return false;
  if (currentToken && foundToken === currentToken) return { revoked: false, reason: 'current' };
  await revoke(foundToken);
  return { revoked: true, session: publicSessionInfo(found, foundToken, currentToken) };
}

async function revokeOthersForEmail(email, currentToken) {
  const needle = String(email || '').toLowerCase();
  if (!needle) return 0;
  const tokens = [];
  sessions.forEach((s, t) => {
    if (String(s.email || '').toLowerCase() === needle && t !== currentToken) tokens.push(t);
  });
  await Promise.all(tokens.map((t) => revoke(t)));
  return tokens.length;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header).split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i === -1) return;
    const key = part.slice(0, i).trim();
    if (!key) return;
    const value = part.slice(i + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch (e) { out[key] = value; }
  });
  return out;
}

function tokenFrom(request) {
  const cookies = parseCookies(request && request.headers && request.headers.cookie);
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
  const header = (request && request.headers && request.headers.authorization) || '';
  const match = /^Bearer\s+([A-Za-z0-9\-_]+)$/.exec(header);
  return match ? match[1] : '';
}

function cookieHeader(token, options) {
  const opts = options || {};
  const parts = [COOKIE_NAME + '=' + encodeURIComponent(token), 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  if (typeof opts.maxAgeMs === 'number') parts.push('Max-Age=' + Math.max(0, Math.floor(opts.maxAgeMs / 1000)));
  return parts.join('; ');
}

function clearCookieHeader(secure) {
  const parts = [COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function tooManyAttempts(ip) {
  const record = attempts.get(ip);
  if (!record) return false;
  if (record.resetAt <= Date.now()) {
    attempts.delete(ip);
    scheduleAttemptsPersist(false);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function noteFailedAttempt(ip) {
  const record = attempts.get(ip);
  if (!record || record.resetAt <= Date.now()) {
    attempts.set(ip, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS });
  } else {
    record.count += 1;
  }
  scheduleAttemptsPersist(true);
}

function clearAttempts(ip) {
  if (!attempts.has(ip)) return;
  attempts.delete(ip);
  scheduleAttemptsPersist(true);
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function makeResetToken() {
  const token = crypto.randomBytes(24).toString('base64url');
  return { token, tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString() };
}

function randomId(prefix) {
  return (prefix || 'USR') + '-' + crypto.randomBytes(6).toString('hex').toUpperCase();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name || '',
    role: user.role || 'advisor',
    active: user.active !== false,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    passwordChangedAt: user.passwordChangedAt || null
  };
}

// Sweep expired sessions (memory + persisted) every 15 minutes.
const sweeper = setInterval(() => {
  const now = Date.now();
  const expired = [];
  sessions.forEach((session, token) => {
    if (session.expiresAt <= now) { sessions.delete(token); expired.push(token); }
  });
  if (persistence) {
    expired.forEach((t) => persistRemove(t));
    if (persistence.removeExpired) persistence.removeExpired().catch(() => {});
  }
  const pruned = pruneAttemptsMap(attempts);
  if (pruned) scheduleAttemptsPersist(false);
}, 15 * 60 * 1000);
if (sweeper.unref) sweeper.unref();

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_MS,
  RESET_TTL_MS,
  createCredential,
  setPassword,
  verifyPassword,
  init,
  issue,
  read,
  rotate,
  revoke,
  revokeAllForEmail,
  revokeById,
  revokeOthersForEmail,
  listSessions,
  tokenFrom,
  cookieHeader,
  clearCookieHeader,
  tooManyAttempts,
  noteFailedAttempt,
  clearAttempts,
  hashResetToken,
  makeResetToken,
  randomId,
  publicUser
};
