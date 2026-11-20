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
    console.error('[vercel] handler error:', error && error.message ? error.message : error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Server initialization failed.' }));
    }
  }
};
