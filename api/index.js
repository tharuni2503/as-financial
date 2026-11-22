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
      const safe = /ADMIN_PASSWORD|BOOT_FATAL|\[auth\]/i.test(msg)
        ? 'Server config error: ADMIN_PASSWORD must be set in Vercel Production environment variables. Redeploy after saving.'
        : 'Server initialization failed.';
      res.end(JSON.stringify({ error: safe }));
    }
  }
};
