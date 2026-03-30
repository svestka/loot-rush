// Core game logic — LootRush
//
// FIXED: Lock only the specific item with FOR UPDATE.
// No round-wide lock, no artificial delay.

const newrelic = require('newrelic');
const { query, getClient } = require('../db/pool');
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

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Lock only the specific item — no round-wide lock
    const { rows: locked } = await client.query(
      'SELECT id, name, rarity, points, claimed_by FROM loot_items WHERE id = $1 AND round_id = $2 FOR UPDATE',
      [itemId, roundId]
    );

    if (locked.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Item not found' };
    }
    if (locked[0].claimed_by !== null) {
      await client.query('ROLLBACK');
      return { success: false, message: `${locked[0].name} already taken` };
    }

    await client.query(
      'UPDATE loot_items SET claimed_by = $1, claimed_at = NOW() WHERE id = $2',
      [playerId, itemId]
    );

    await client.query('COMMIT');

    query(
      `INSERT INTO grab_log (round_id, player_id, item_id, success, duration_ms)
       VALUES ($1, $2, $3, true, 0)`,
      [roundId, playerId, itemId]
    ).catch(() => {});

    log('info', 'Item grabbed', { playerId, itemId, item: locked[0].name });
    return { success: true, item: { id: itemId, name: locked[0].name, rarity: locked[0].rarity, points: locked[0].points } };

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── Leaderboard ─────────────────────────────────────────────────
async function getLeaderboard() {
  const { rows } = await query(
    'SELECT id, nickname, total_score, grabs_won, grabs_failed FROM players ORDER BY total_score DESC LIMIT 10'
  );
  return rows;
}

module.exports = { createRound, grabItem, getLeaderboard };
