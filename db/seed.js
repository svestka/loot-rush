// Seed the database with initial data on first start

const { query } = require('./pool');

// Loot item pool — each round picks 3 random items from this list
const LOOT_POOL = [
  { name: 'Dragon Sword',    rarity: 'legendary', points: 100 },
  { name: 'Phoenix Staff',   rarity: 'legendary', points: 100 },
  { name: 'Void Blade',      rarity: 'legendary', points: 100 },
  { name: 'Shadow Cloak',    rarity: 'epic',      points: 50 },
  { name: 'Thunder Hammer',  rarity: 'epic',      points: 50 },
  { name: 'Frost Crown',     rarity: 'epic',      points: 50 },
  { name: 'Crystal Shield',  rarity: 'epic',      points: 50 },
  { name: 'Iron Gauntlets',  rarity: 'rare',      points: 25 },
  { name: 'Silver Ring',     rarity: 'rare',      points: 25 },
  { name: 'Bronze Helmet',   rarity: 'rare',      points: 25 },
  { name: 'Leather Boots',   rarity: 'rare',      points: 25 },
  { name: 'Wooden Shield',   rarity: 'rare',      points: 25 },
];

async function seed() {
  // Check if already seeded
  const { rows } = await query('SELECT COUNT(*) as c FROM rounds');
  if (parseInt(rows[0].c) > 0) {
    return false; // already seeded
  }
  return true; // ready for first round
}

function pickItems(count = 3) {
  // Pick random items ensuring at least one legendary/epic
  const shuffled = [...LOOT_POOL].sort(() => Math.random() - 0.5);
  const picked = [];

  // Guarantee at least one legendary
  const legendary = shuffled.find(i => i.rarity === 'legendary');
  if (legendary) picked.push(legendary);

  // Fill remaining slots
  for (const item of shuffled) {
    if (picked.length >= count) break;
    if (!picked.includes(item)) picked.push(item);
  }

  return picked;
}

module.exports = { seed, pickItems, LOOT_POOL };
