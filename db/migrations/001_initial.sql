-- 001_initial.sql — LootRush schema

CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    nickname VARCHAR(30) UNIQUE NOT NULL,
    total_score INTEGER DEFAULT 0,
    grabs_won INTEGER DEFAULT 0,
    grabs_failed INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rounds (
    id SERIAL PRIMARY KEY,
    status VARCHAR(20) DEFAULT 'waiting',
    started_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS loot_items (
    id SERIAL PRIMARY KEY,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    name VARCHAR(50) NOT NULL,
    rarity VARCHAR(20) NOT NULL,
    points INTEGER NOT NULL,
    claimed_by INTEGER REFERENCES players(id),
    claimed_at TIMESTAMPTZ,
    UNIQUE(round_id, name)
);

CREATE TABLE IF NOT EXISTS grab_log (
    id SERIAL PRIMARY KEY,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    player_id INTEGER NOT NULL REFERENCES players(id),
    item_id INTEGER NOT NULL REFERENCES loot_items(id),
    success BOOLEAN NOT NULL,
    duration_ms INTEGER,
    attempted_at TIMESTAMPTZ DEFAULT NOW()
);

-- BUG: These indexes are intentionally missing.
-- Uncomment as part of the "fix" during the presentation.
-- CREATE INDEX idx_loot_items_round ON loot_items(round_id, claimed_by);
-- CREATE INDEX idx_grab_log_round ON grab_log(round_id);
-- CREATE INDEX idx_grab_log_player ON grab_log(player_id);
-- CREATE INDEX idx_players_score ON players(total_score DESC);
