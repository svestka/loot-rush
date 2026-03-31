// Database connection layer
// FIXED: Uses a connection pool instead of creating a new connection per query.

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://loot:loot@localhost:5432/loot';

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

async function query(text, params) {
  return pool.query(text, params);
}

// For transactions — returns a client from the pool
async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient };
