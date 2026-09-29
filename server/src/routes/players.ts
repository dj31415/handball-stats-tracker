import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { POSITIONS } from '../../../shared/types.js';
import { db } from '../db.js';
import { toPlayer } from '../rows.js';
import { invalid } from '../validate.js';

const players = new Hono();

const name = z.string().trim().min(1).max(100);
const number = z.number().int().min(0).max(999);
const position = z.enum(POSITIONS);

const createSchema = z.object({
	id: z.string().min(1).max(100).optional(),
	name,
	number,
	position,
	is_active: z.union([z.literal(0), z.literal(1)]).optional()
});

const patchSchema = z.object({
	name: name.optional(),
	number: number.optional(),
	position: position.optional(),
	is_active: z.union([z.literal(0), z.literal(1)]).optional()
});

async function findPlayer(id: string) {
	const result = await db.execute({ sql: 'SELECT * FROM players WHERE id = ?', args: [id] });
	return result.rows[0] ? toPlayer(result.rows[0]) : null;
}

players.get('/', async (c) => {
	const activeOnly = c.req.query('active') === '1';
	const result = await db.execute(
		`SELECT * FROM players ${activeOnly ? 'WHERE is_active = 1' : ''} ORDER BY number, name`
	);
	return c.json(result.rows.map(toPlayer));
});

players.post('/', zValidator('json', createSchema, invalid), async (c) => {
	const body = c.req.valid('json');
	const id = body.id ?? randomUUID();
	await db.execute({
		sql: 'INSERT OR IGNORE INTO players (id, name, number, position, is_active) VALUES (?, ?, ?, ?, ?)',
		args: [id, body.name, body.number, body.position, body.is_active ?? 1]
	});
	return c.json(await findPlayer(id), 201);
});

players.patch('/:id', zValidator('json', patchSchema, invalid), async (c) => {
	const id = c.req.param('id');
	const patch = c.req.valid('json');
	const sets: string[] = [];
	const args: (string | number)[] = [];
	for (const key of ['name', 'number', 'position', 'is_active'] as const) {
		const value = patch[key];
		if (value !== undefined) {
			sets.push(`${key} = ?`);
			args.push(value);
		}
	}
	if (sets.length > 0) {
		await db.execute({ sql: `UPDATE players SET ${sets.join(', ')} WHERE id = ?`, args: [...args, id] });
	}
	const player = await findPlayer(id);
	if (!player) return c.json({ error: 'not_found' }, 404);
	return c.json(player);
});

players.delete('/:id', async (c) => {
	const id = c.req.param('id');
	if (!(await findPlayer(id))) return c.json({ error: 'not_found' }, 404);
	const used = await db.execute({
		sql: `SELECT 1 FROM game_events WHERE player_id = ?
		      UNION ALL SELECT 1 FROM game_rosters WHERE player_id = ? LIMIT 1`,
		args: [id, id]
	});
	if (used.rows.length > 0) return c.json({ error: 'player_has_data' }, 409);
	await db.execute({ sql: 'DELETE FROM players WHERE id = ?', args: [id] });
	return c.body(null, 204);
});

export default players;
