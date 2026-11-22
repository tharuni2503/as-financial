'use strict';

/*
 * Store selector: PostgreSQL when DATABASE_URL/POSTGRES_URL is configured.
 * In production, JSON fallback is disabled to avoid silent data loss on
 * ephemeral serverless filesystems.
 */

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!url && IS_PRODUCTION) {
  throw new Error('DATABASE_URL (or POSTGRES_URL) is required in production. JSON fallback is disabled to protect data.');
}

const backend = url ? require('./store-pg') : require('./store-json');

module.exports = backend;
module.exports.BACKEND = url ? 'postgres' : 'json';
module.exports.DATABASE_URL = url;
