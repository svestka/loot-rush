// Structural tests for LootRush — fix2: deadlock fixed, pool fixed
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (err) { failed++; console.log(`  FAIL: ${name}\n        ${err.message}`); }
}

console.log('\nLootRush structural tests (fix2)\n');

// ── Schema ──────────────────────────────────────
const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_initial.sql'), 'utf8');

test('Schema has all tables', () => {
  assert(schema.includes('CREATE TABLE IF NOT EXISTS players'));
  assert(schema.includes('CREATE TABLE IF NOT EXISTS loot_items'));
  assert(schema.includes('CREATE TABLE IF NOT EXISTS grab_log'));
});
test('Indexes are still commented out', () => {
  assert(schema.includes('-- CREATE INDEX idx_loot_items_round'));
});

// ── Game logic — fixed ──────────────────────────
const gameCode = fs.readFileSync(path.join(__dirname, '..', 'routes', 'game.js'), 'utf8');

test('Grab: locks specific item with FOR UPDATE', () => {
  assert(gameCode.includes('WHERE id = $1 AND round_id = $2 FOR UPDATE'));
});

test('Grab: no round-wide lock (deadlock fixed)', () => {
  assert(!gameCode.includes('WHERE round_id = $1 FOR UPDATE'), 'Should NOT lock all items in round');
});

test('Grab: no artificial delay', () => {
  assert(!gameCode.includes('800 + Math.random()'), 'Should NOT have lock delay');
  assert(!gameCode.includes('1500 + Math.random()'), 'Should NOT have validation delay');
});

// ── Pool — uses connection pool ─────────────────
const poolCode = fs.readFileSync(path.join(__dirname, '..', 'db', 'pool.js'), 'utf8');

test('Pool: uses Pool (fixed)', () => {
  assert(poolCode.includes('new Pool('));
  assert(poolCode.includes('max: 20'));
});

test('Pool: no per-query Client creation', () => {
  assert(!poolCode.includes('new Client('), 'Should NOT create Client per query');
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

// ── Regression guards ───────────────────────────
test('Grab: updates player score on success', () => {
  assert(gameCode.includes('total_score = total_score + $1'), 'Must update total_score after grab');
  assert(gameCode.includes('grabs_won = grabs_won + 1'), 'Must increment grabs_won after grab');
});

// ── Results ─────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
