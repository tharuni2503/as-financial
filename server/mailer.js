'use strict';

const DEPLOYMENT_HOST = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';
const APP_URL = (process.env.APP_URL || process.env.PUBLIC_URL || (DEPLOYMENT_HOST ? 'https://' + DEPLOYMENT_HOST : '')).replace(/\/+$/, '');
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || process.env.SMTP_USERNAME || '';
const SMTP_PASS = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '';
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || SMTP_PORT === 465;
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.ADMIN_EMAIL || 'no-reply@localhost';

let transport = null;
let transportInit = false;

function isConfigured() {
  return Boolean(SMTP_HOST);
}

function getTransport() {
  if (transportInit) return transport;
  transportInit = true;
  if (!isConfigured()) return null;
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (error) {
    console.warn('[mail] SMTP configured but nodemailer is not installed. Run: npm install nodemailer');
    return null;
  }
  const options = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE
  };
  if (SMTP_USER || SMTP_PASS) {
    options.auth = { user: SMTP_USER, pass: SMTP_PASS };
  }
  transport = nodemailer.createTransport(options);
  return transport;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.toString();
  } catch (_) {
    return '';
  }
}

function absoluteResetUrl(resetPathOrUrl, req) {
  if (!resetPathOrUrl) return '';
  const direct = safeHttpUrl(resetPathOrUrl);
  if (direct) return direct;

  if (APP_URL) {
    const base = safeHttpUrl(APP_URL);
    if (!base) return '';
    try { return new URL(String(resetPathOrUrl), base).toString(); } catch (_) { return ''; }
  }

  // In production, never trust a request Host header to build a credential URL.
  // Vercel's VERCEL_URL / VERCEL_PROJECT_PRODUCTION_URL or APP_URL should be used.
  if (process.env.NODE_ENV === 'production') return '';

  if (req && req.headers) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim().toLowerCase();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (!['http', 'https'].includes(proto) || !host || /[\s\\/@]/.test(host)) return '';
    const origin = safeHttpUrl(proto + '://' + host);
    if (!origin) return '';
    try { return new URL(String(resetPathOrUrl), origin).toString(); } catch (_) { return ''; }
  }
  return '';
}

function buildResetEmail({ name, resetUrl, expiresAt }) {
  const href = safeHttpUrl(resetUrl);
  if (!href) throw new TypeError('A valid absolute HTTP(S) password reset URL is required.');
  const displayName = String(name || 'there');
  const subject = 'Reset your AS Financial admin password';
  const text = [
    \`Hi \${displayName},\`,
    '',
    'A password reset was requested for your account.',
    \`Reset link: \${href}\`,
    expiresAt ? \`This link expires at: \${expiresAt}\` : 'This link expires soon.',
    '',
    'If you did not request this, you can ignore this email.'
  ].join('\n');
  const html = \`<p>Hi \${escapeHtml(displayName)},</p>\n\` +
    '<p>A password reset was requested for your account.</p>\n' +
    \`<p><a href="\${escapeHtml(href)}">Reset your password</a></p>\n\` +
    (expiresAt ? \`<p>This link expires at: \${escapeHtml(expiresAt)}</p>\n\` : '<p>This link expires soon.</p>\n') +
    '<p>If you did not request this, you can ignore this email.</p>';
  return { subject, text, html };
}

async function sendPasswordReset({ to, name, resetUrl, expiresAt }) {
  let message;
  try {
    message = buildResetEmail({ name, resetUrl, expiresAt });
  } catch (error) {
    return { sent: false, fallback: true, reason: 'invalid_reset_url' };
  }

  const tx = getTransport();
  if (!tx) {
    console.log('[mail] password reset email not sent for', to, '(SMTP unavailable)');
    return { sent: false, fallback: true, reason: isConfigured() ? 'mailer_unavailable' : 'not_configured' };
  }

  try {
    const info = await tx.sendMail({ from: MAIL_FROM, to, ...message });
    console.log('[mail] password reset sent to', to, info && info.messageId ? ('id=' + info.messageId) : '');
    return { sent: true, messageId: info && info.messageId };
  } catch (error) {
    console.error('[mail] failed to send password reset:', error && error.message ? error.message : error);
    return { sent: false, fallback: true, reason: 'send_failed', error: error && error.message };
  }
}

module.exports = {
  isConfigured,
  getTransport,
  absoluteResetUrl,
  escapeHtml,
  safeHttpUrl,
  buildResetEmail,
  sendPasswordReset
};
