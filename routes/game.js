// Core game logic — LootRush
//
// BUG: Race condition (TOCTOU)
//   SELECT (no lock) → 2s "validation" delay → UPDATE
//   Two players both see the item as available, one loses.

const newrelic = require('newrelic');
const { query } = require('../db/pool');
const { log } = require('../logger');
const { pickItems } = require('../db/seed');

// ── Create a new round with 3 random loot items ─────────────────
async function createRound() {
  const { rows } = await query(
    "INSERT INTO rounds (status, started_at) VALUES ('countdown', NOW()) RETURNING id"
  );
  const roundId = rows[0].id;

  const items = pickItems(3);
  const insertedItems = [];

  for (const item of items) {
    const { rows: itemRows } = await query(
      `INSERT INTO loot_items (round_id, name, rarity, points)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [roundId, item.name, item.rarity, item.points]
    );
    insertedItems.push(itemRows[0]);
  }

  return { id: roundId, items: insertedItems };
}

// ── Grab an item ────────────────────────────────────────────────
async function grabItem(playerId, roundId, itemId) {
  newrelic.addCustomAttribute('roundId', roundId);
  newrelic.addCustomAttribute('itemId', itemId);
  newrelic.addCustomAttribute('playerId', playerId);

  // Step 1: Check availability — NO LOCK (this is the bug)
  const { rows: available } = await newrelic.startSegment('checkAvailability', true, async () => {
    return query(
      'SELECT id, name, rarity, points, claimed_by FROM loot_items WHERE id = $1 AND round_id = $2',
      [itemId, roundId]
    );
  });

  if (available.length === 0) return { success: false, message: 'Item not found' };
  if (available[0].claimed_by !== null) return { success: false, message: `${available[0].name} already taken` };

  const itemName = available[0].name;
  const itemPoints = available[0].points;

  // Step 2: "Loot validation" — THIS IS THE RACE WINDOW
  // Shows in New Relic as a named segment: "lootValidationDelay" taking ~2 seconds
  const delay = 1500 + Math.random() * 1000;
  await newrelic.startSegment('lootValidationDelay', true, async () => {
    await new Promise(r => setTimeout(r, delay));
  });

  // Step 3: Wasteful queries — show up individually in New Relic trace
  await newrelic.startSegment('wastefulQueries', true, async () => {
    await query(
      `INSERT INTO grab_log (round_id, player_id, item_id, success, duration_ms)
       VALUES ($1, $2, $3, true, 0)`,
      [roundId, playerId, itemId]
    );
    await query(
      `SELECT p.*, (SELECT COUNT(*) FROM grab_log gl WHERE gl.player_id = p.id) as total_grabs
       FROM players p WHERE p.id = $1`,
      [playerId]
    );
    await query('SELECT COUNT(*) FROM grab_log WHERE round_id = $1', [roundId]);

    // CPU burn
    const cpuStart = Date.now();
    while (Date.now() - cpuStart < 30) { Math.random(); }
  });

  // Step 4: Try to claim — but the item may be gone
  const { rowCount } = await newrelic.startSegment('claimItem', true, async () => {
    return query(
      `UPDATE loot_items SET claimed_by = $1, claimed_at = NOW()
       WHERE id = $2 AND round_id = $3 AND claimed_by IS NULL`,
      [playerId, itemId, roundId]
    );
  });

  if (rowCount === 0) {
    log('warn', 'RACE CONDITION detected', { playerId, itemId, roundId, item: itemName, delayMs: Math.round(delay) });
    newrelic.addCustomAttribute('raceConditionDetected', true);
    newrelic.recordCustomEvent('RaceCondition', { playerId, itemId, itemName, roundId, delayMs: Math.round(delay) });
    await query('UPDATE players SET grabs_failed = grabs_failed + 1 WHERE id = $1', [playerId]);
    return { success: false, raceCondition: true, itemName };
  }

  await query(
    'UPDATE players SET total_score = total_score + $1, grabs_won = grabs_won + 1 WHERE id = $2',
    [itemPoints, playerId]
  );
  log('info', 'Item grabbed', { playerId, itemId, item: itemName });
  return { success: true, item: { id: itemId, name: itemName, rarity: available[0].rarity, points: itemPoints } };
}

// ── Leaderboard ─────────────────────────────────────────────────
async function getLeaderboard() {
  const { rows } = await query(
    'SELECT id, nickname, total_score, grabs_won, grabs_failed FROM players ORDER BY total_score DESC LIMIT 10'
  );
  return rows;
}

module.exports = { createRound, grabItem, getLeaderboard };
