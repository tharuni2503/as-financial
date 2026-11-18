'use strict';

/*
 * Store selector: PostgreSQL when DATABASE_URL/POSTGRES_URL is configured,
 * otherwise the JSON file datastore. Both backends expose the same async API.
 */

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const backend = url ? require('./store-pg') : require('./store-json');

module.exports = backend;
module.exports.BACKEND = url ? 'postgres' : 'json';
module.exports.DATABASE_URL = url;
