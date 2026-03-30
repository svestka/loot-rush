// Structured JSON logger — New Relic picks these up via logs in context
const BUG_RACE_CONDITION = process.env.BUG_RACE_CONDITION !== 'false';
const BUG_DEADLOCK = process.env.BUG_DEADLOCK !== 'false';

function log(level, message, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: 'loot-drop',
    bugRaceCondition: BUG_RACE_CONDITION,
    bugDeadlock: BUG_DEADLOCK,
    ...fields,
  };
  const out = JSON.stringify(entry) + '\n';
  if (level === 'error') {
    process.stderr.write(out);
  } else {
    process.stdout.write(out);
  }
}

module.exports = { log };
