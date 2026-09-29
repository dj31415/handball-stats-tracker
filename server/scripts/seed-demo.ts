/**
 * Seeds a database with a fictional demo team: one season, a roster and a few generated games.
 * Refuses to touch an existing database unless --force is given (which wipes it).
 *
 * Usage: npm run seed:demo [-- --force]
 */
import { existsSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { EventType, Position, ShotZone } from '../../shared/types.js';

// config.ts requires APP_PASSWORD and a session secret, which the seed script does not need.
process.env.APP_PASSWORD ||= 'seed-script-unused';
process.env.SESSION_SECRET ||= 'seed-script-unused';
const { config } = await import('../src/config.js');

const force = process.argv.includes('--force');

if (existsSync(config.DB_PATH)) {
	if (!force) {
		console.error(`Database already exists at ${config.DB_PATH}. Use --force to wipe it.`);
		process.exit(1);
	}
	for (const suffix of ['', '-wal', '-shm', '-journal']) {
		if (existsSync(config.DB_PATH + suffix)) unlinkSync(config.DB_PATH + suffix);
	}
}

// Import the db only now: opening it creates the file.
const { db, initDB } = await import('../src/db.js');

// Deterministic pseudo-random numbers so the demo data is reproducible.
let seed = 42;
function rand(): number {
	seed = (seed * 1664525 + 1013904223) % 4294967296;
	return seed / 4294967296;
}
function pick<T>(items: readonly T[]): T {
	return items[Math.floor(rand() * items.length)];
}

const seasonId = randomUUID();
const roster: { name: string; number: number; position: Position }[] = [
	{ name: 'Alex Berger', number: 1, position: 'GK' },
	{ name: 'Jonas Kramer', number: 12, position: 'GK' },
	{ name: 'Mia Lindner', number: 3, position: 'LW' },
	{ name: 'Noah Vogel', number: 5, position: 'LB' },
	{ name: 'Emil Hartmann', number: 7, position: 'CB' },
	{ name: 'Lea Sommer', number: 9, position: 'RB' },
	{ name: 'Finn Brandt', number: 11, position: 'RW' },
	{ name: 'Paul Winter', number: 14, position: 'PV' },
	{ name: 'Tim Roth', number: 17, position: 'LB' },
	{ name: 'Ben Fuchs', number: 20, position: 'CB' }
];
const players = roster.map((p) => ({ ...p, id: randomUUID() }));
const goalies = players.filter((p) => p.position === 'GK');
const fieldPlayers = players.filter((p) => p.position !== 'GK');

const zoneFor: Partial<Record<Position, ShotZone>> = {
	LW: 'LW', LB: 'LB', CB: 'CB', RB: 'RB', RW: 'RW', PV: 'PV'
};

const opponents = [
	{ name: 'TSV Nordhafen', home: true, location: 'Sporthalle Mitte' },
	{ name: 'HSV Ostwind', home: false, location: 'Ostwind-Arena' },
	{ name: 'SG Westkueste', home: true, location: 'Sporthalle Mitte' },
	{ name: 'TuS Suederau', home: false, location: 'Suederau Halle' }
];

interface EventRow {
	id: string;
	game_id: string;
	player_id: string | null;
	timestamp: string;
	half: number;
	event_type: EventType;
	shot_zone: ShotZone | null;
}

function generateEvents(gameId: string, date: string, gk: (typeof players)[number]): EventRow[] {
	const events: EventRow[] = [];
	const start = new Date(`${date}T15:00:00.000Z`).getTime();
	const count = 45 + Math.floor(rand() * 20);
	for (let i = 0; i < count; i++) {
		const half = i < count / 2 ? 1 : 2;
		const minute = (half === 1 ? 0 : 35) + Math.floor(((i % Math.ceil(count / 2)) / (count / 2)) * 30);
		const timestamp = new Date(start + (minute * 60 + Math.floor(rand() * 60)) * 1000).toISOString();
		const add = (player_id: string | null, event_type: EventType, shot_zone: ShotZone | null = null) =>
			events.push({ id: randomUUID(), game_id: gameId, player_id, timestamp, half, event_type, shot_zone });

		const r = rand();
		const shooter = pick(fieldPlayers);
		const zone = zoneFor[shooter.position] ?? null;
		if (r < 0.3) add(shooter.id, 'goal', zone);
		else if (r < 0.42) add(shooter.id, 'miss', zone);
		else if (r < 0.47) add(shooter.id, 'goal_7m');
		else if (r < 0.5) add(shooter.id, 'miss_7m');
		else if (r < 0.58) add(shooter.id, 'tech_mistake');
		else if (r < 0.6) add(shooter.id, 'suspension_2min');
		else if (r < 0.61) add(shooter.id, 'yellow_card');
		else if (r < 0.75) {
			add(gk.id, 'save');
		} else if (r < 0.79) {
			add(gk.id, 'save_7m');
		} else if (r < 0.92) {
			// A conceded goal is logged as a pair: goalie event + opponent goal
			add(gk.id, 'conceded');
			add(null, 'opponent_goal');
		} else {
			add(gk.id, 'conceded_7m');
			add(null, 'opponent_7m');
		}
	}
	return events;
}

await initDB();

await db.execute({
	sql: 'INSERT INTO seasons (id, name, start_date, end_date) VALUES (?, ?, ?, ?)',
	args: [seasonId, 'Demo Season', '2025-08-01', '2026-06-30']
});
for (const p of players) {
	await db.execute({
		sql: 'INSERT INTO players (id, name, number, position, is_active) VALUES (?, ?, ?, ?, 1)',
		args: [p.id, p.name, p.number, p.position]
	});
}

let eventTotal = 0;
for (const [i, opp] of opponents.entries()) {
	const gameId = randomUUID();
	const date = `2025-10-${String(4 + i * 7).padStart(2, '0')}`;
	const events = generateEvents(gameId, date, goalies[i % goalies.length]);
	await db.execute({
		sql: `INSERT INTO games (id, season_id, date, opponent, is_home, location, notes, status)
		      VALUES (?, ?, ?, ?, ?, ?, '', 'finished')`,
		args: [gameId, seasonId, date, opp.name, opp.home ? 1 : 0, opp.location]
	});
	for (const p of players) {
		await db.execute({
			sql: 'INSERT INTO game_rosters (game_id, player_id) VALUES (?, ?)',
			args: [gameId, p.id]
		});
	}
	await db.batch(
		events.map((e) => ({
			sql: `INSERT INTO game_events (id, game_id, player_id, timestamp, half, event_type, shot_zone)
			      VALUES (?, ?, ?, ?, ?, ?, ?)`,
			args: [e.id, e.game_id, e.player_id, e.timestamp, e.half, e.event_type, e.shot_zone]
		})),
		'write'
	);
	eventTotal += events.length;
}

console.log(`Seeded ${config.DB_PATH}: 1 season, ${players.length} players, ${opponents.length} games, ${eventTotal} events.`);
process.exit(0);
