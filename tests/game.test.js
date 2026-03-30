// Structural tests for LootRush
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (err) { failed++; console.log(`  FAIL: ${name}\n        ${err.message}`); }
}

console.log('\nLootRush structural tests\n');

// ── Schema (in migrations) ─────────────────────
const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_initial.sql'), 'utf8');

test('Schema has players table', () => assert(schema.includes('CREATE TABLE IF NOT EXISTS players')));
test('Schema has rounds table', () => assert(schema.includes('CREATE TABLE IF NOT EXISTS rounds')));
test('Schema has loot_items table', () => assert(schema.includes('CREATE TABLE IF NOT EXISTS loot_items')));
test('Schema has grab_log table', () => assert(schema.includes('CREATE TABLE IF NOT EXISTS grab_log')));
test('Indexes are commented out (missing)', () => {
  assert(schema.includes('-- CREATE INDEX idx_loot_items_round'));
  assert(schema.includes('-- CREATE INDEX idx_grab_log_round'));
});

// ── Migration runner ───────────────────────────
test('Migration runner exists', () => {
  const migratePath = path.join(__dirname, '..', 'db', 'migrate.js');
  assert(fs.existsSync(migratePath), 'db/migrate.js should exist');
  const migrateCode = fs.readFileSync(migratePath, 'utf8');
  assert(migrateCode.includes('_migrations'), 'should track migrations in _migrations table');
});

// ── Game logic — race condition bug ─────────────
const gameCode = fs.readFileSync(path.join(__dirname, '..', 'routes', 'game.js'), 'utf8');

test('Grab: SELECT without FOR UPDATE (race condition bug)', () => {
  assert(gameCode.includes("'SELECT id, name, rarity, points, claimed_by FROM loot_items WHERE id = $1 AND round_id = $2'"));
  assert(!gameCode.includes('FOR UPDATE'), 'Should NOT have FOR UPDATE anywhere');
});

test('Grab: has validation delay (race window)', () => {
  assert(gameCode.includes('1500 + Math.random() * 1000'));
  assert(gameCode.includes('lootValidationDelay'));
});

test('Grab: detects race condition when rowCount=0', () => {
  assert(gameCode.includes('raceCondition: true'));
});

test('New Relic integration present', () => {
  assert(gameCode.includes("require('newrelic')"));
  assert(gameCode.includes('newrelic.addCustomAttribute'));
  assert(gameCode.includes('newrelic.recordCustomEvent'));
  assert(gameCode.includes('newrelic.startSegment'));
});

// ── Pool — always creates new connection ────────
const poolCode = fs.readFileSync(path.join(__dirname, '..', 'db', 'pool.js'), 'utf8');

test('Pool: creates new Client per query (bug)', () => {
  assert(poolCode.includes('new Client('));
  assert(!poolCode.includes('new Pool('), 'Should NOT have connection pool');
});

// ── Seed ────────────────────────────────────────
const seedCode = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.js'), 'utf8');

test('Loot pool has all rarities', () => {
  assert(seedCode.includes("rarity: 'legendary'"));
  assert(seedCode.includes("rarity: 'epic'"));
  assert(seedCode.includes("rarity: 'rare'"));
});

// ── New Relic config ────────────────────────────
const nrConfig = fs.readFileSync(path.join(__dirname, '..', 'newrelic.js'), 'utf8');

test('New Relic: distributed tracing enabled', () => assert(nrConfig.includes('distributed_tracing')));
test('New Relic: logs in context enabled', () => assert(nrConfig.includes('application_logging')));

// ── Server ──────────────────────────────────────
const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('Server runs migrations on startup', () => {
  assert(serverCode.includes("require('./db/migrate')"));
  assert(serverCode.includes('await migrate()'));
});

// ── Docker ──────────────────────────────────────
test('docker-compose.yml is DB-only (no app service)', () => {
  const compose = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
  assert(compose.includes('postgres'), 'should have postgres service');
  assert(!compose.includes('loot-app'), 'should NOT have app service');
});

// ── Results ─────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
