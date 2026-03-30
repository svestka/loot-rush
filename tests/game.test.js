// Structural tests for LootRush — fix1: race condition fixed, deadlock introduced
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (err) { failed++; console.log(`  FAIL: ${name}\n        ${err.message}`); }
}

console.log('\nLootRush structural tests (fix1)\n');

// ── Schema (in migrations) ─────────────────────
const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_initial.sql'), 'utf8');

test('Schema has players table', () => assert(schema.includes('CREATE TABLE IF NOT EXISTS players')));
test('Schema has loot_items table', () => assert(schema.includes('CREATE TABLE IF NOT EXISTS loot_items')));
test('Indexes are still commented out', () => {
  assert(schema.includes('-- CREATE INDEX idx_loot_items_round'));
});

// ── Game logic — deadlock bug ───────────────────
const gameCode = fs.readFileSync(path.join(__dirname, '..', 'routes', 'game.js'), 'utf8');

test('Grab: locks specific item with FOR UPDATE (race condition fixed)', () => {
  assert(gameCode.includes('FOR UPDATE'));
  assert(gameCode.includes('WHERE id = $1 AND round_id = $2 FOR UPDATE'));
});

test('Grab: locks ALL items in round (deadlock bug)', () => {
  assert(gameCode.includes("'SELECT id, claimed_by FROM loot_items WHERE round_id = $1 FOR UPDATE'"));
});

test('Grab: has delay between the two locks', () => {
  assert(gameCode.includes('800 + Math.random() * 400'));
});

test('Grab: catches PostgreSQL deadlock error 40P01', () => {
  assert(gameCode.includes("err.code === '40P01'"));
  assert(gameCode.includes('deadlock: true'));
});

test('New Relic integration present', () => {
  assert(gameCode.includes("require('newrelic')"));
  assert(gameCode.includes('newrelic.recordCustomEvent'));
  assert(gameCode.includes("'Deadlock'"));
});

// ── Pool — still creates new connection ─────────
const poolCode = fs.readFileSync(path.join(__dirname, '..', 'db', 'pool.js'), 'utf8');

test('Pool: creates new Client per query (still buggy)', () => {
  assert(poolCode.includes('new Client('));
  assert(!poolCode.includes('new Pool('), 'Should NOT have connection pool yet');
});

test('Pool: exports getClient for transactions', () => {
  assert(poolCode.includes('getClient'));
  assert(poolCode.includes('client.release'));
});

// ── Seed ────────────────────────────────────────
const seedCode = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.js'), 'utf8');

test('Loot pool has all rarities', () => {
  assert(seedCode.includes("rarity: 'legendary'"));
  assert(seedCode.includes("rarity: 'epic'"));
  assert(seedCode.includes("rarity: 'rare'"));
});

// ── Server ──────────────────────────────────────
const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('Server runs migrations on startup', () => {
  assert(serverCode.includes("require('./db/migrate')"));
  assert(serverCode.includes('await migrate()'));
});

// ── Results ─────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
