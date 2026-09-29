import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { EVENT_TYPES, GAME_STATUSES, HALVES, SHOT_ZONES } from '../../../shared/types.js';
import type { GameDetail } from '../../../shared/types.js';
import { db } from '../db.js';
import { toEvent, toGame, toGameListItem, toPlayer } from '../rows.js';
import { invalid } from '../validate.js';

const games = new Hono();

const text = (max: number) => z.string().max(max);
const status = z.enum(GAME_STATUSES);

const createSchema = z.object({
	id: z.string().min(1).max(100),
	season_id: z.string().min(1).max(100),
	date: z.string().min(1).max(40),
	opponent: z.string().trim().min(1).max(100),
	is_home: z.boolean(),
	location: text(200),
	notes: text(10000).optional(),
	status,
	player_ids: z.array(z.string().min(1).max(100)).max(100)
});

const patchSchema = z.object({
	status: status.optional(),
	notes: text(10000).optional(),
	opponent: z.string().trim().min(1).max(100).optional(),
	date: z.string().min(1).max(40).optional(),
	location: text(200).optional(),
	is_home: z.boolean().optional()
});

const eventsSchema = z.object({
	events: z
		.array(
			z.object({
				id: z.string().min(1).max(100),
				player_id: z.string().min(1).max(100).nullable(),
				timestamp: z.string().min(1).max(40),
				half: z.union([z.literal(HALVES[0]), z.literal(HALVES[1])]),
				event_type: z.enum(EVENT_TYPES),
				shot_zone: z.enum(SHOT_ZONES).nullable()
			})
		)
		.min(1)
		.max(200)
});

async function findGame(id: string) {
	const result = await db.execute({ sql: 'SELECT * FROM games WHERE id = ?', args: [id] });
	return result.rows[0] ? toGame(result.rows[0]) : null;
}

games.get('/', zValidator('query', z.object({ season_id: z.string().optional(), status: status.optional() }), invalid), async (c) => {
	const { season_id, status } = c.req.valid('query');
	const where: string[] = [];
	const args: string[] = [];
	if (season_id) {
		where.push('g.season_id = ?');
		args.push(season_id);
	}
	if (status) {
		where.push('g.status = ?');
		args.push(status);
	}
	const result = await db.execute({
		sql: `SELECT g.*,
		        COALESCE(SUM(e.event_type IN ('goal', 'goal_7m')), 0) AS own_score,
		        COALESCE(SUM(e.event_type IN ('opponent_goal', 'opponent_7m')), 0) AS opp_score
		      FROM games g LEFT JOIN game_events e ON e.game_id = g.id
		      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
		      GROUP BY g.id ORDER BY g.date DESC, g.rowid DESC`,
		args
	});
	return c.json(result.rows.map(toGameListItem));
});

games.get('/:id', async (c) => {
	const id = c.req.param('id');
	const game = await findGame(id);
	if (!game) return c.json({ error: 'not_found' }, 404);

	const events = await db.execute({
		sql: 'SELECT * FROM game_events WHERE game_id = ? ORDER BY timestamp, rowid',
		args: [id]
	});
	const roster = await db.execute({
		sql: `SELECT p.* FROM players p
		      JOIN game_rosters gr ON gr.player_id = p.id
		      WHERE gr.game_id = ? ORDER BY p.number, p.name`,
		args: [id]
	});
	const detail: GameDetail = {
		game,
		roster: roster.rows.map(toPlayer),
		events: events.rows.map(toEvent)
	};
	return c.json(detail);
});

games.post('/', zValidator('json', createSchema, invalid), async (c) => {
	const body = c.req.valid('json');

	const season = await db.execute({ sql: 'SELECT 1 FROM seasons WHERE id = ?', args: [body.season_id] });
	if (season.rows.length === 0) {
		return c.json({ error: 'invalid', details: 'unknown season_id' }, 400);
	}
	const playerIds = [...new Set(body.player_ids)];
	if (playerIds.length > 0) {
		const known = await db.execute({
			sql: `SELECT id FROM players WHERE id IN (${playerIds.map(() => '?').join(',')})`,
			args: playerIds
		});
		if (known.rows.length !== playerIds.length) {
			return c.json({ error: 'invalid', details: 'unknown player_ids' }, 400);
		}
	}

	await db.batch(
		[
			{
				sql: `INSERT OR IGNORE INTO games (id, season_id, date, opponent, is_home, location, notes, status)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				args: [body.id, body.season_id, body.date, body.opponent, body.is_home ? 1 : 0, body.location, body.notes ?? '', body.status]
			},
			...playerIds.map((playerId) => ({
				sql: 'INSERT OR IGNORE INTO game_rosters (game_id, player_id) VALUES (?, ?)',
				args: [body.id, playerId]
			}))
		],
		'write'
	);
	return c.json({ game: await findGame(body.id) }, 201);
});

games.patch('/:id', zValidator('json', patchSchema, invalid), async (c) => {
	const id = c.req.param('id');
	const patch = c.req.valid('json');
	const sets: string[] = [];
	const args: (string | number)[] = [];
	for (const key of ['status', 'notes', 'opponent', 'date', 'location', 'is_home'] as const) {
		const value = patch[key];
		if (value !== undefined) {
			sets.push(`${key} = ?`);
			args.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
		}
	}
	if (sets.length > 0) {
		await db.execute({ sql: `UPDATE games SET ${sets.join(', ')} WHERE id = ?`, args: [...args, id] });
	}
	const game = await findGame(id);
	if (!game) return c.json({ error: 'not_found' }, 404);
	return c.json(game);
});

games.delete('/:id', async (c) => {
	const id = c.req.param('id');
	await db.batch(
		[
			{ sql: 'DELETE FROM game_events WHERE game_id = ?', args: [id] },
			{ sql: 'DELETE FROM game_rosters WHERE game_id = ?', args: [id] },
			{ sql: 'DELETE FROM games WHERE id = ?', args: [id] }
		],
		'write'
	);
	return c.body(null, 204);
});

games.post('/:id/events', zValidator('json', eventsSchema, invalid), async (c) => {
	const gameId = c.req.param('id');
	const { events } = c.req.valid('json');
	if (!(await findGame(gameId))) return c.json({ error: 'not_found' }, 404);

	// Players must be on this game's roster (opponent events have no player).
	const rosterResult = await db.execute({
		sql: 'SELECT player_id FROM game_rosters WHERE game_id = ?',
		args: [gameId]
	});
	const roster = new Set(rosterResult.rows.map((r) => r.player_id as string));
	const offRoster = events.filter((e) => e.player_id !== null && !roster.has(e.player_id));
	if (offRoster.length > 0) {
		return c.json({ error: 'invalid', details: 'player not on game roster' }, 400);
	}

	await db.batch(
		events.map((e) => ({
			sql: `INSERT OR IGNORE INTO game_events (id, game_id, player_id, timestamp, half, event_type, shot_zone)
			      VALUES (?, ?, ?, ?, ?, ?, ?)`,
			args: [e.id, gameId, e.player_id, e.timestamp, e.half, e.event_type, e.shot_zone]
		})),
		'write'
	);
	return c.json({ ids: events.map((e) => e.id) }, 201);
});

games.delete('/:id/events', async (c) => {
	const gameId = c.req.param('id');
	const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean);
	if (ids.length > 200) return c.json({ error: 'invalid', details: 'too many ids' }, 400);
	if (ids.length > 0) {
		await db.execute({
			sql: `DELETE FROM game_events WHERE game_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
			args: [gameId, ...ids]
		});
	}
	return c.body(null, 204);
});

export default games;
