-- 002_add_indexes.sql — Add missing indexes for performance

CREATE INDEX IF NOT EXISTS idx_loot_items_round ON loot_items(round_id, claimed_by);
CREATE INDEX IF NOT EXISTS idx_grab_log_round ON grab_log(round_id);
CREATE INDEX IF NOT EXISTS idx_grab_log_player ON grab_log(player_id);
CREATE INDEX IF NOT EXISTS idx_players_score ON players(total_score DESC);
