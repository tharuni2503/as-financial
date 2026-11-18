'use strict';

/*
 * Admin authentication: scrypt password hashing (no plaintext on disk) and
 * random bearer tokens held in memory for the life of the server process.
 */

const crypto = require('node:crypto');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

const sessions = new Map();
const attempts = new Map();

function createCredential(email, password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return {
    email: String(email).toLowerCase(),
    salt: salt.toString('hex'),
    hash: hash.toString('hex')
  };
}

function verifyPassword(credential, password) {
  if (!credential || typeof password !== 'string' || !password) return false;
  const salt = Buffer.from(credential.salt, 'hex');
  const expected = Buffer.from(credential.hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function issue(email) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { email, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function read(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function revoke(token) {
  if (token) sessions.delete(token);
}

function tokenFrom(request) {
  const header = request.headers.authorization || '';
  const match = /^Bearer\s+([A-Za-z0-9\-_]+)$/.exec(header);
  return match ? match[1] : '';
}

function tooManyAttempts(ip) {
  const record = attempts.get(ip);
  if (!record) return false;
  if (record.resetAt <= Date.now()) {
    attempts.delete(ip);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function noteFailedAttempt(ip) {
  const record = attempts.get(ip);
  if (!record || record.resetAt <= Date.now()) {
    attempts.set(ip, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS });
    return;
  }
  record.count += 1;
}

function clearAttempts(ip) {
  attempts.delete(ip);
}

// Drop expired sessions every 15 minutes.
const sweeper = setInterval(() => {
  const now = Date.now();
  sessions.forEach((session, token) => {
    if (session.expiresAt <= now) sessions.delete(token);
  });
  attempts.forEach((record, ip) => {
    if (record.resetAt <= now) attempts.delete(ip);
  });
}, 15 * 60 * 1000);
if (sweeper.unref) sweeper.unref();

module.exports = {
  SESSION_TTL_MS,
  createCredential,
  verifyPassword,
  issue,
  read,
  revoke,
  tokenFrom,
  tooManyAttempts,
  noteFailedAttempt,
  clearAttempts
};
