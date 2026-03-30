// Database connection layer
// BUG #3: In buggy mode, creates a NEW connection for every single query
//         instead of using a connection pool. Simulates 15-40ms remote DB overhead.

const { Client, Pool } = require('pg');

const BUGGY = process.env.BUGGY !== 'false';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://loot:loot@localhost:5432/loot';

let pool;
let connectionsCreated = 0;

function getConnectionsCreated() {
  return connectionsCreated;
}

if (!BUGGY) {
  // FIXED: proper connection pool, max 20 connections, reused across requests
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

async function query(text, params) {
  if (BUGGY) {
    // BUG #3: new connection per query — devastating under load
    const client = new Client({ connectionString: DATABASE_URL });
    connectionsCreated++;
    await client.connect();
    // Simulate remote DB network overhead (15-40ms per connection)
    await new Promise(r => setTimeout(r, 15 + Math.random() * 25));
    try {
      return await client.query(text, params);
    } finally {
      await client.end();
    }
  } else {
    return pool.query(text, params);
  }
}

// For transactions (fixed mode)
async function getClient() {
  if (!BUGGY && pool) {
    return pool.connect();
  }
  const client = new Client({ connectionString: DATABASE_URL });
  connectionsCreated++;
  await client.connect();
  // Add release method for compatibility
  client.release = () => client.end();
  return client;
}

module.exports = { query, getClient, getConnectionsCreated };
