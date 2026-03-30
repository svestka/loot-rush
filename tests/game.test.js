// Structural tests for LootRush — fix3: indexes added via migration
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log(`  PASS: ${name}`); }
  catch (err) { failed++; console.log(`  FAIL: ${name}\n        ${err.message}`); }
}

console.log('\nLootRush structural tests (fix3)\n');

// ── Schema ──────────────────────────────────────
const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_initial.sql'), 'utf8');

test('Schema has all tables', () => {
  assert(schema.includes('CREATE TABLE IF NOT EXISTS players'));
  assert(schema.includes('CREATE TABLE IF NOT EXISTS loot_items'));
  assert(schema.includes('CREATE TABLE IF NOT EXISTS grab_log'));
});

// ── Index migration exists ──────────────────────
test('Index migration file exists', () => {
  const indexMigration = path.join(__dirname, '..', 'db', 'migrations', '002_add_indexes.sql');
  assert(fs.existsSync(indexMigration), '002_add_indexes.sql should exist');
});

const indexSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '002_add_indexes.sql'), 'utf8');

test('Index migration adds loot_items index', () => {
  assert(indexSql.includes('idx_loot_items_round'));
  assert(indexSql.includes('loot_items(round_id'));
});

test('Index migration adds grab_log indexes', () => {
  assert(indexSql.includes('idx_grab_log_round'));
  assert(indexSql.includes('idx_grab_log_player'));
});

test('Index migration adds players score index', () => {
  assert(indexSql.includes('idx_players_score'));
  assert(indexSql.includes('total_score DESC'));
});

// ── Game logic — still fixed ────────────────────
const gameCode = fs.readFileSync(path.join(__dirname, '..', 'routes', 'game.js'), 'utf8');

test('Grab: locks specific item with FOR UPDATE', () => {
  assert(gameCode.includes('WHERE id = $1 AND round_id = $2 FOR UPDATE'));
});

test('Grab: no round-wide lock', () => {
  assert(!gameCode.includes('WHERE round_id = $1 FOR UPDATE'));
});

// ── Pool — uses connection pool ─────────────────
const poolCode = fs.readFileSync(path.join(__dirname, '..', 'db', 'pool.js'), 'utf8');

test('Pool: uses Pool (fixed)', () => {
  assert(poolCode.includes('new Pool('));
});

// ── Server ──────────────────────────────────────
const serverCode = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('Server runs migrations on startup', () => {
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
