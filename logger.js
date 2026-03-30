// Structured JSON logger — New Relic picks these up via logs in context

function log(level, message, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: 'loot-drop',
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
