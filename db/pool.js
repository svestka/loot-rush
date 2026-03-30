// Database connection layer
// BUG: Creates a NEW connection for every single query
//      instead of using a connection pool. Simulates 15-40ms remote DB overhead.

const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://loot:loot@localhost:5432/loot';

let connectionsCreated = 0;

function getConnectionsCreated() {
  return connectionsCreated;
}

async function query(text, params) {
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
}

module.exports = { query, getConnectionsCreated };
