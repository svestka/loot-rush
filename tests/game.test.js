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

// ── Schema (now in migrations) ──────────────────
const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_initial.sql'), 'utf8');

test('Schema has players table', () => assert(schema.includes('CREATE TABLE IF NOT EXISTS players')));
test('Schema has rounds table', () => assert(schema.includes('CREATE TABLE IF NOT EXISTS rounds')));
test('Schema has loot_items table', () => assert(schema.includes('CREATE TABLE IF NOT EXISTS loot_items')));
test('Schema has grab_log table', () => assert(schema.includes('CREATE TABLE IF NOT EXISTS grab_log')));
test('Indexes are commented out', () => {
  assert(schema.includes('-- CREATE INDEX idx_loot_items_round'));
  assert(schema.includes('-- CREATE INDEX idx_grab_log_round'));
});

// ── Migration runner exists ─────────────────────
test('Migration runner exists', () => {
  const migratePath = path.join(__dirname, '..', 'db', 'migrate.js');
  assert(fs.existsSync(migratePath), 'db/migrate.js should exist');
  const migrateCode = fs.readFileSync(migratePath, 'utf8');
  assert(migrateCode.includes('_migrations'), 'should track migrations in _migrations table');
});

// ── Game logic — 3 modes ────────────────────────
const gameCode = fs.readFileSync(path.join(__dirname, '..', 'routes', 'game.js'), 'utf8');

test('Has three grab functions', () => {
  assert(gameCode.includes('grabBuggyRaceCondition'));
  assert(gameCode.includes('grabBuggyDeadlock'));
  assert(gameCode.includes('grabFixed'));
});

test('Race condition mode: SELECT without FOR UPDATE + delay', () => {
  assert(gameCode.includes("'SELECT id, name, rarity, points, claimed_by FROM loot_items WHERE id = $1 AND round_id = $2'"));
  assert(gameCode.includes('1500 + Math.random() * 1000'));
});

test('Deadlock mode: locks specific item then ALL items (FOR UPDATE)', () => {
  assert(gameCode.includes("'SELECT id, claimed_by FROM loot_items WHERE round_id = $1 FOR UPDATE'"));
});

test('Deadlock mode: has delay between the two locks', () => {
  assert(gameCode.includes('800 + Math.random() * 400'));
});

test('Deadlock mode: catches PostgreSQL error 40P01', () => {
  assert(gameCode.includes("err.code === '40P01'"));
});

test('Fixed mode: locks only the specific item', () => {
  assert(gameCode.includes('FOR UPDATE'));
});

test('New Relic integration present', () => {
  assert(gameCode.includes("require('newrelic')"));
  assert(gameCode.includes('newrelic.addCustomAttribute'));
  assert(gameCode.includes('newrelic.recordCustomEvent'));
});

// ── Pool ────────────────────────────────────────
const poolCode = fs.readFileSync(path.join(__dirname, '..', 'db', 'pool.js'), 'utf8');

test('Pool: buggy creates new Client per query', () => assert(poolCode.includes('new Client(')));
test('Pool: fixed uses Pool', () => assert(poolCode.includes('new Pool(')));

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

// ── Server imports migrate ──────────────────────
const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('Server runs migrations on startup', () => {
  assert(serverCode.includes("require('./db/migrate')"), 'server.js should import migrate');
  assert(serverCode.includes('await migrate()'), 'server.js should call migrate()');
});

// ── Results ─────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
