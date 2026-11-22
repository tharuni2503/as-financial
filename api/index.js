'use strict';

const server = require('../server/index');

let readyPromise = null;

module.exports = async function handler(req, res) {
  try {
    if (!readyPromise) {
      readyPromise = (typeof server.ready === 'function')
        ? server.ready()
        : Promise.resolve();
    }
    await readyPromise;
    return server(req, res);
  } catch (error) {
    const msg = error && error.message ? String(error.message) : 'Server initialization failed.';
    console.error('[vercel] handler error:', msg);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      let safe = 'Server initialization failed.';
      if (/ADMIN_PASSWORD|BOOT_FATAL|\[auth\]/i.test(msg)) {
        safe = 'Server config error: ADMIN_PASSWORD must be set in Vercel Production environment variables. Redeploy after saving.';
      } else {
        const redacted = msg.replace(/(postgres(?:ql)?:\/\/)([^@\s]+)@/gi, '$1***@').replace(/(mongodb(?:\+srv)?:\/\/)([^@\s]+)@/gi, '$1***@').replace(/[A-Za-z0-9_\-]{24,}/g, '[redacted]');
        safe = 'Server initialization failed: ' + redacted.slice(0, 180);
      }
      res.end(JSON.stringify({ error: safe }));
    }
  }
};
