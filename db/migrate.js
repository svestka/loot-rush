// Simple migration runner for PostgreSQL
// Reads .sql files from db/migrations/ in order and tracks which have been applied.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { log } = require('../logger');

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://loot:loot@localhost:5432/loot';
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function migrate() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get already-applied migrations
    const { rows: applied } = await client.query('SELECT name FROM _migrations ORDER BY name');
    const appliedSet = new Set(applied.map(r => r.name));

    // Read migration files in order
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let ran = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      log('info', `Running migration: ${file}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran++;
        log('info', `Migration applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        log('error', `Migration failed: ${file}`, { error: err.message });
        throw err;
      }
    }

    if (ran === 0) {
      log('info', 'Database is up to date — no new migrations');
    } else {
      log('info', `Applied ${ran} migration(s)`);
    }
  } finally {
    await client.end();
  }
}

// Allow running directly: node db/migrate.js
if (require.main === module) {
  migrate()
    .then(() => { console.log('Migrations complete'); process.exit(0); })
    .catch(err => { console.error('Migration error:', err.message); process.exit(1); });
}

module.exports = { migrate };
