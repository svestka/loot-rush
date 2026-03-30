// E2E test for two players grabbing one item
const assert = require('assert');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const WS_URL = `ws://localhost:${PORT}`;

async function testTwoPlayersGrabOneItem() {
  console.log('\nE2E Test: Two players grab one item\n');

  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 1000));

  let player1GrabResult = null;
  let player2GrabResult = null;
  let testComplete = false;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!testComplete) {
        ws1.close();
        ws2.close();
        reject(new Error('Test timeout'));
      }
    }, 30000);

    const ws1 = new WebSocket(WS_URL);
    const ws2 = new WebSocket(WS_URL);

    let ws1Joined = false;
    let ws2Joined = false;
    let roundOpen = false;
    let currentRoundId = null;
    let availableItems = [];

    ws1.on('message', (data) => {
      const msg = JSON.parse(data);

      if (msg.type === 'joined') {
        ws1Joined = true;
        checkIfReadyToGrab();
      }

      if (msg.type === 'round_open') {
        roundOpen = true;
        currentRoundId = msg.roundId;
        availableItems = msg.items.filter(i => !i.claimed);
        checkIfReadyToGrab();
      }

      if (msg.type === 'grab_result') {
        player1GrabResult = msg;
        checkResults();
      }
    });

    ws2.on('message', (data) => {
      const msg = JSON.parse(data);

      if (msg.type === 'joined') {
        ws2Joined = true;
        checkIfReadyToGrab();
      }

      if (msg.type === 'round_open') {
        roundOpen = true;
        currentRoundId = msg.roundId;
        availableItems = msg.items.filter(i => !i.claimed);
        checkIfReadyToGrab();
      }

      if (msg.type === 'grab_result') {
        player2GrabResult = msg;
        checkResults();
      }
    });

    function checkIfReadyToGrab() {
      if (ws1Joined && ws2Joined && roundOpen && availableItems.length > 0) {
        // Both players grab the same item simultaneously
        const targetItem = availableItems[0];
        ws1.send(JSON.stringify({ type: 'grab', itemId: targetItem.id }));
        ws2.send(JSON.stringify({ type: 'grab', itemId: targetItem.id }));
      }
    }

    function checkResults() {
      if (player1GrabResult && player2GrabResult && !testComplete) {
        testComplete = true;
        clearTimeout(timeout);
        ws1.close();
        ws2.close();

        // Exactly one should succeed
        const successCount = (player1GrabResult.success ? 1 : 0) + (player2GrabResult.success ? 1 : 0);

        try {
          assert.strictEqual(successCount, 1, 'Exactly one player should successfully grab the item');

          const mode = process.env.BUGGY !== 'false' ? 'buggy' : 'fixed';
          if (mode === 'buggy') {
            // In buggy mode, we might see race conditions
            const hasRaceCondition = player1GrabResult.raceCondition || player2GrabResult.raceCondition;
            console.log(`  Race condition detected: ${hasRaceCondition}`);
          }

          console.log(`  PASS: Two players grab one item (mode: ${mode})`);
          console.log(`        Player 1: ${player1GrabResult.success ? 'SUCCESS' : 'FAILED'}`);
          console.log(`        Player 2: ${player2GrabResult.success ? 'SUCCESS' : 'FAILED'}`);
          resolve();
        } catch (err) {
          console.log(`  FAIL: Two players grab one item`);
          console.log(`        ${err.message}`);
          console.log(`        Player 1: ${JSON.stringify(player1GrabResult)}`);
          console.log(`        Player 2: ${JSON.stringify(player2GrabResult)}`);
          reject(err);
        }
      }
    }

    ws1.on('open', () => {
      ws1.send(JSON.stringify({ type: 'join', nickname: 'TestPlayer1' }));
    });

    ws2.on('open', () => {
      ws2.send(JSON.stringify({ type: 'join', nickname: 'TestPlayer2' }));
    });

    ws1.on('error', reject);
    ws2.on('error', reject);
  });
}

// Run the test
testTwoPlayersGrabOneItem()
  .then(() => {
    console.log('\n✓ E2E test passed\n');
    process.exit(0);
  })
  .catch((err) => {
    console.log(`\n✗ E2E test failed: ${err.message}\n`);
    process.exit(1);
  });
