// New Relic agent MUST be required first — it monkey-patches pg, express, etc.
const newrelic = require('newrelic');

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { log } = require('./logger');
const { query } = require('./db/pool');
const { seed } = require('./db/seed');
const { migrate } = require('./db/migrate');
const { createRound, grabItem, getLeaderboard } = require('./routes/game');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── WebSocket Management ────────────────────────────────────────
const clients = new Map();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

function broadcastOnlineCount() {
  broadcast({ type: 'online', count: clients.size });
}

function broadcastAlert(message, alertType) {
  broadcast({ type: 'alert', message, alertType: alertType || 'race_condition' });
}

// ── Game State ──────────────────────────────────────────────────
let currentRoundId = null;
let roundStatus = 'waiting';
let roundItems = [];
let countdownTimer = null;
let resolveTimer = null;

const COUNTDOWN_SECONDS = 8;
const OPEN_SECONDS = 15;

async function startNewRound() {
  return newrelic.startBackgroundTransaction('game/newRound', 'GameLoop', async () => {
    const txn = newrelic.getTransaction();
    roundStatus = 'countdown';
    const round = await createRound();
    currentRoundId = round.id;
    roundItems = round.items;

    newrelic.addCustomAttribute('roundId', currentRoundId);
    log('info', 'New round starting', { roundId: currentRoundId, items: roundItems.map(i => i.name) });

    broadcast({
      type: 'round_countdown',
      roundId: currentRoundId,
      seconds: COUNTDOWN_SECONDS,
      items: roundItems.map(i => ({ id: i.id, name: i.name, rarity: i.rarity, points: i.points })),
    });

    txn.end();

    countdownTimer = setTimeout(async () => {
      roundStatus = 'open';
      await query("UPDATE rounds SET status = 'open', opened_at = NOW() WHERE id = $1", [currentRoundId]);
      log('info', 'Crate opened!', { roundId: currentRoundId });

      broadcast({
        type: 'round_open',
        roundId: currentRoundId,
        items: roundItems.map(i => ({ id: i.id, name: i.name, rarity: i.rarity, points: i.points, claimed: false })),
      });

      resolveTimer = setTimeout(() => resolveRound(), OPEN_SECONDS * 1000);
    }, COUNTDOWN_SECONDS * 1000);
  });
}

async function resolveRound() {
  if (roundStatus === 'resolved') return;

  return newrelic.startBackgroundTransaction('game/resolveRound', 'GameLoop', async () => {
    const txn = newrelic.getTransaction();
    roundStatus = 'resolved';

    await query("UPDATE rounds SET status = 'resolved', resolved_at = NOW() WHERE id = $1", [currentRoundId]);

    const { rows: finalItems } = await query(
      `SELECT li.*, p.nickname as claimed_by_name
       FROM loot_items li LEFT JOIN players p ON li.claimed_by = p.id
       WHERE li.round_id = $1`,
      [currentRoundId]
    );

    const leaderboard = await getLeaderboard();
    log('info', 'Round resolved', { roundId: currentRoundId });
    broadcast({ type: 'round_resolved', roundId: currentRoundId, items: finalItems, leaderboard });

    txn.end();
    setTimeout(() => startNewRound(), 4000);
  });
}

// ── WebSocket Handlers ──────────────────────────────────────────
wss.on('connection', (ws) => {
  log('info', 'WebSocket connected', { totalClients: wss.clients.size });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // ── Join ──
    if (msg.type === 'join') {
      return newrelic.startBackgroundTransaction('ws/join', 'WebSocket', async () => {
        const txn = newrelic.getTransaction();
        const nickname = (msg.nickname || '').trim().substring(0, 30);
        if (!nickname) {
          ws.send(JSON.stringify({ type: 'error', message: 'Nickname required' }));
          txn.end();
          return;
        }

        try {
          const { rows } = await query(
            `INSERT INTO players (nickname) VALUES ($1)
             ON CONFLICT (nickname) DO UPDATE SET nickname = EXCLUDED.nickname
             RETURNING id, nickname, total_score, grabs_won, grabs_failed`,
            [nickname]
          );
          const player = rows[0];
          clients.set(ws, { nickname: player.nickname, playerId: player.id });

          newrelic.addCustomAttribute('playerId', player.id);
          newrelic.addCustomAttribute('playerNickname', player.nickname);

          ws.send(JSON.stringify({ type: 'joined', player }));
          broadcastOnlineCount();
          broadcast({ type: 'player_joined', nickname: player.nickname });
          log('info', 'Player joined', { nickname, playerId: player.id });

          // Send current game state
          if (roundStatus === 'open' && currentRoundId) {
            const { rows: items } = await query(
              `SELECT li.*, p.nickname as claimed_by_name
               FROM loot_items li LEFT JOIN players p ON li.claimed_by = p.id
               WHERE li.round_id = $1`,
              [currentRoundId]
            );
            ws.send(JSON.stringify({
              type: 'round_open',
              roundId: currentRoundId,
              items: items.map(i => ({
                id: i.id, name: i.name, rarity: i.rarity, points: i.points,
                claimed: !!i.claimed_by, claimed_by_name: i.claimed_by_name,
              })),
            }));
          } else if (roundStatus === 'countdown' && currentRoundId) {
            ws.send(JSON.stringify({
              type: 'round_countdown',
              roundId: currentRoundId,
              seconds: 3,
              items: roundItems.map(i => ({ id: i.id, name: i.name, rarity: i.rarity, points: i.points })),
            }));
          }

          const leaderboard = await getLeaderboard();
          ws.send(JSON.stringify({ type: 'leaderboard', leaderboard }));
        } catch (err) {
          log('error', 'Join error', { error: err.message });
          newrelic.noticeError(err);
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to join' }));
        } finally {
          txn.end();
        }
      });
    }

    // ── Grab ──
    if (msg.type === 'grab') {
      return newrelic.startBackgroundTransaction('ws/grabItem', 'WebSocket', async () => {
        const txn = newrelic.getTransaction();
        const client = clients.get(ws);
        if (!client) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not joined' }));
          txn.end();
          return;
        }
        if (roundStatus !== 'open') {
          ws.send(JSON.stringify({ type: 'grab_result', success: false, message: 'Crate is not open' }));
          txn.end();
          return;
        }

        const itemId = msg.itemId;
        const start = Date.now();

        newrelic.addCustomAttribute('playerId', client.playerId);
        newrelic.addCustomAttribute('playerNickname', client.nickname);
        newrelic.addCustomAttribute('itemId', itemId);
        newrelic.addCustomAttribute('roundId', currentRoundId);

        try {
          const result = await grabItem(client.playerId, currentRoundId, itemId);
          const elapsed = Date.now() - start;

          newrelic.addCustomAttribute('grabElapsedMs', elapsed);

          if (result.raceCondition) {
            newrelic.addCustomAttribute('raceConditionDetected', true);
            newrelic.recordCustomEvent('RaceCondition', {
              playerId: client.playerId, nickname: client.nickname,
              itemId, itemName: result.itemName, roundId: currentRoundId, elapsed,
            });
            broadcastAlert(
              `RACE CONDITION! ${client.nickname} tried to grab ${result.itemName} but someone else got it during the ${elapsed}ms delay!`,
              'race_condition'
            );
            ws.send(JSON.stringify({
              type: 'grab_result', success: false, raceCondition: true,
              message: `Race condition! Someone grabbed ${result.itemName} during your ${elapsed}ms request`,
              elapsed,
            }));
          } else if (result.deadlock) {
            newrelic.addCustomAttribute('deadlockDetected', true);
            newrelic.recordCustomEvent('Deadlock', {
              playerId: client.playerId, nickname: client.nickname,
              itemId, roundId: currentRoundId, elapsed,
            });
            broadcastAlert(
              `DEADLOCK! ${client.nickname}'s grab collided with another transaction — both were waiting for each other's locks!`,
              'deadlock'
            );
            ws.send(JSON.stringify({
              type: 'grab_result', success: false, deadlock: true,
              message: `Deadlock detected! Your grab and another player's grab locked items in opposite order (${elapsed}ms)`,
              elapsed,
            }));
          } else if (result.success) {
            newrelic.addCustomAttribute('grabSuccess', true);
            newrelic.addCustomAttribute('itemName', result.item.name);
            newrelic.addCustomAttribute('itemPoints', result.item.points);

            ws.send(JSON.stringify({
              type: 'grab_result', success: true, item: result.item,
              message: `You grabbed ${result.item.name}! +${result.item.points} pts (${elapsed}ms)`,
              elapsed,
            }));
            broadcast({
              type: 'item_claimed',
              roundId: currentRoundId,
              itemId: result.item.id,
              itemName: result.item.name,
              claimedBy: client.nickname,
              points: result.item.points,
            });

            const { rows: unclaimed } = await query(
              'SELECT COUNT(*) as c FROM loot_items WHERE round_id = $1 AND claimed_by IS NULL',
              [currentRoundId]
            );
            if (parseInt(unclaimed[0].c) === 0) {
              clearTimeout(resolveTimer);
              resolveRound();
            }
          } else {
            ws.send(JSON.stringify({
              type: 'grab_result', success: false,
              message: result.message || 'Item already taken',
              elapsed,
            }));
          }

          const leaderboard = await getLeaderboard();
          broadcast({ type: 'leaderboard', leaderboard });

        } catch (err) {
          log('error', 'Grab error', { error: err.message, playerId: client.playerId, itemId });
          newrelic.noticeError(err);
          ws.send(JSON.stringify({ type: 'error', message: 'Grab failed' }));
        } finally {
          txn.end();
        }
      });
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    if (client) {
      log('info', 'Player left', { nickname: client.nickname });
      broadcast({ type: 'player_left', nickname: client.nickname });
    }
    clients.delete(ws);
    broadcastOnlineCount();
  });
});

// ── HTTP ────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', online: clients.size });
});

// ── Startup ─────────────────────────────────────────────────────
async function start() {
  log('info', 'LootRush starting');

  // Run database migrations (creates tables if needed)
  await migrate();
  await seed();

  server.listen(PORT, '0.0.0.0', () => {
    log('info', `LootRush listening on port ${PORT}`);
    setTimeout(() => startNewRound(), 2000);
  });
}

start().catch(err => { log('error', 'Failed to start', { error: err.message }); process.exit(1); });
