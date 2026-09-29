import { createClient, type Client } from '@libsql/client';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { config } from './config.js';

mkdirSync(dirname(config.DB_PATH), { recursive: true });

export const db: Client = createClient({
	url: `file:${config.DB_PATH}`
});

export async function initDB() {
	await db.executeMultiple(`
		CREATE TABLE IF NOT EXISTS players (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			number INTEGER NOT NULL,
			position TEXT NOT NULL,
			is_active INTEGER NOT NULL DEFAULT 1
		);

		CREATE TABLE IF NOT EXISTS seasons (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			start_date TEXT NOT NULL,
			end_date TEXT NOT NULL DEFAULT ''
		);

		CREATE TABLE IF NOT EXISTS games (
			id TEXT PRIMARY KEY,
			season_id TEXT NOT NULL,
			date TEXT NOT NULL,
			opponent TEXT NOT NULL,
			is_home INTEGER NOT NULL DEFAULT 1,
			location TEXT NOT NULL DEFAULT '',
			notes TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'finished',
			FOREIGN KEY (season_id) REFERENCES seasons(id)
		);

		CREATE TABLE IF NOT EXISTS game_rosters (
			game_id TEXT NOT NULL,
			player_id TEXT NOT NULL,
			PRIMARY KEY (game_id, player_id),
			FOREIGN KEY (game_id) REFERENCES games(id),
			FOREIGN KEY (player_id) REFERENCES players(id)
		);

		CREATE TABLE IF NOT EXISTS game_events (
			id TEXT PRIMARY KEY,
			game_id TEXT NOT NULL,
			player_id TEXT,
			timestamp TEXT NOT NULL,
			half INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			shot_zone TEXT,
			FOREIGN KEY (game_id) REFERENCES games(id),
			FOREIGN KEY (player_id) REFERENCES players(id)
		);

		CREATE INDEX IF NOT EXISTS idx_events_game ON game_events(game_id);
		CREATE INDEX IF NOT EXISTS idx_events_player ON game_events(player_id);
		CREATE INDEX IF NOT EXISTS idx_rosters_game ON game_rosters(game_id);
	`);
}
