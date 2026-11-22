'use strict';

const APP_URL = (process.env.APP_URL || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
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

function absoluteResetUrl(resetPathOrUrl) {
  if (!resetPathOrUrl) return '';
  if (/^https?:\/\//i.test(resetPathOrUrl)) return resetPathOrUrl;
  if (APP_URL) return APP_URL + (resetPathOrUrl.startsWith('/') ? resetPathOrUrl : '/' + resetPathOrUrl);
  return '';
}

async function sendPasswordReset({ to, name, resetUrl, expiresAt }) {
  const tx = getTransport();
  const safeName = name || 'there';
  const subject = 'Reset your AS Financial admin password';
  const text = [
    `Hi ${safeName},`,
    '',
    'A password reset was requested for your account.',
    `Reset link: ${resetUrl}`,
    expiresAt ? `This link expires at: ${expiresAt}` : 'This link expires soon.',
    '',
    'If you did not request this, you can ignore this email.'
  ].join('\n');
  const html = `<p>Hi ${safeName},</p>
<p>A password reset was requested for your account.</p>
<p><a href="${resetUrl}">Reset your password</a></p>
${expiresAt ? `<p>This link expires at: ${expiresAt}</p>` : '<p>This link expires soon.</p>'}
<p>If you did not request this, you can ignore this email.</p>`;

  if (!tx) {
    console.log('[mail] (fallback) password reset for', to, '->', resetUrl);
    return { sent: false, fallback: true, reason: isConfigured() ? 'mailer_unavailable' : 'not_configured' };
  }

  try {
    const info = await tx.sendMail({ from: MAIL_FROM, to, subject, text, html });
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
  sendPasswordReset
};
