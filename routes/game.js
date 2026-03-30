// Core grab logic with two bugs that appear in sequence:
//
// BUG #1 — Race condition (TOCTOU):
//   SELECT (no lock) → 2s delay → UPDATE
//
// BUG #2 — Deadlock (introduced when "fixing" the race condition):
//   Lock specific item → delay → Lock ALL items → deadlock
//
// FIXED — Lock only the specific item, no round-wide lock.

const newrelic = require('newrelic');
const { query, getClient } = require('../db/pool');
const { log } = require('../logger');
const { pickItems } = require('../db/seed');

const BUG_RACE_CONDITION = process.env.BUG_RACE_CONDITION !== 'false';
const BUG_DEADLOCK = process.env.BUG_DEADLOCK !== 'false';

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

// ── Grab an item — all three modes ──────────────────────────────
async function grabItem(playerId, roundId, itemId) {
  newrelic.addCustomAttribute('roundId', roundId);
  newrelic.addCustomAttribute('itemId', itemId);
  newrelic.addCustomAttribute('playerId', playerId);

  if (BUG_RACE_CONDITION) {
    newrelic.addCustomAttribute('bugMode', 'race_condition');
    return grabBuggyRaceCondition(playerId, roundId, itemId);
  } else if (BUG_DEADLOCK) {
    newrelic.addCustomAttribute('bugMode', 'deadlock');
    return grabBuggyDeadlock(playerId, roundId, itemId);
  } else {
    newrelic.addCustomAttribute('bugMode', 'fixed');
    return grabFixed(playerId, roundId, itemId);
  }
}

// ═══════════════════════════════════════════════════════════════════
// BUG #1 — Race condition: SELECT without lock → delay → UPDATE
// ═══════════════════════════════════════════════════════════════════
async function grabBuggyRaceCondition(playerId, roundId, itemId) {

  // Step 1: Check availability — NO LOCK
  // Shows in New Relic as: Postgres > SELECT loot_items
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
  // This is the smoking gun in the trace view
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
  // Shows in New Relic as: Postgres > UPDATE loot_items
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
  log('info', 'Item grabbed (race_condition mode)', { playerId, itemId, item: itemName });
  return { success: true, item: { id: itemId, name: itemName, rarity: available[0].rarity, points: itemPoints } };
}

// ═══════════════════════════════════════════════════════════════════
// BUG #2 — Deadlock: lock specific item → delay → lock ALL items
// ═══════════════════════════════════════════════════════════════════
async function grabBuggyDeadlock(playerId, roundId, itemId) {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Step 1: Lock the specific item (this is correct)
    // Shows in New Relic as: Postgres > SELECT loot_items FOR UPDATE
    const { rows: locked } = await newrelic.startSegment('lockItem', true, async () => {
      return client.query(
        'SELECT id, name, rarity, points, claimed_by FROM loot_items WHERE id = $1 AND round_id = $2 FOR UPDATE',
        [itemId, roundId]
      );
    });

    if (locked.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, message: 'Item not found' };
    }
    if (locked[0].claimed_by !== null) {
      await client.query('ROLLBACK');
      return { success: false, message: `${locked[0].name} already taken` };
    }

    // Step 2: Delay — widens the deadlock window
    // Shows as "lockDelay" segment in New Relic
    await newrelic.startSegment('lockDelay', true, async () => {
      await new Promise(r => setTimeout(r, 800 + Math.random() * 400));
    });

    // Step 3: "Validate round state" — locks ALL items in the round
    // THIS IS THE BUG: another grab already holds a lock on a different item
    // Shows as "lockAllItems" segment — then the trace ends with a deadlock error
    await newrelic.startSegment('lockAllItems_BUG', true, async () => {
      await client.query(
        'SELECT id, claimed_by FROM loot_items WHERE round_id = $1 FOR UPDATE',
        [roundId]
      );
    });

    // Step 4: Claim
    await client.query(
      'UPDATE loot_items SET claimed_by = $1, claimed_at = NOW() WHERE id = $2',
      [playerId, itemId]
    );
    await client.query(
      'UPDATE players SET total_score = total_score + $1, grabs_won = grabs_won + 1 WHERE id = $2',
      [locked[0].points, playerId]
    );

    await client.query('COMMIT');

    query(
      `INSERT INTO grab_log (round_id, player_id, item_id, success, duration_ms)
       VALUES ($1, $2, $3, true, 0)`,
      [roundId, playerId, itemId]
    ).catch(() => {});

    log('info', 'Item grabbed (deadlock mode)', { playerId, itemId, item: locked[0].name });
    return { success: true, item: { id: itemId, name: locked[0].name, rarity: locked[0].rarity, points: locked[0].points } };

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});

    if (err.code === '40P01') {
      log('error', 'DEADLOCK detected during grab!', { playerId, itemId, roundId, pgError: err.message });
      newrelic.addCustomAttribute('deadlockDetected', true);
      newrelic.noticeError(err, { playerId, itemId, roundId, deadlock: true });
      newrelic.recordCustomEvent('Deadlock', { playerId, itemId, roundId });

      await query('UPDATE players SET grabs_failed = grabs_failed + 1 WHERE id = $1', [playerId]).catch(() => {});
      return { success: false, deadlock: true, itemName: 'unknown' };
    }

    throw err;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════
// FIXED — Lock only the specific item
// ═══════════════════════════════════════════════════════════════════
async function grabFixed(playerId, roundId, itemId) {
  const client = await getClient();

  try {
    await client.query('BEGIN');

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
    await client.query(
      'UPDATE players SET total_score = total_score + $1, grabs_won = grabs_won + 1 WHERE id = $2',
      [locked[0].points, playerId]
    );

    await client.query('COMMIT');

    query(
      `INSERT INTO grab_log (round_id, player_id, item_id, success, duration_ms)
       VALUES ($1, $2, $3, true, 0)`,
      [roundId, playerId, itemId]
    ).catch(() => {});

    log('info', 'Item grabbed (fixed)', { playerId, itemId, item: locked[0].name });
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
