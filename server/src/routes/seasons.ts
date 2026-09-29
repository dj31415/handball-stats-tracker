import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { toSeason } from '../rows.js';
import { invalid } from '../validate.js';

const seasons = new Hono();

const createSchema = z.object({
	id: z.string().min(1).max(100).optional(),
	name: z.string().trim().min(1).max(100),
	start_date: z.string().min(1).max(40),
	end_date: z.string().max(40).optional()
});

seasons.get('/', async (c) => {
	const result = await db.execute('SELECT * FROM seasons ORDER BY start_date');
	return c.json(result.rows.map(toSeason));
});

seasons.post('/', zValidator('json', createSchema, invalid), async (c) => {
	const body = c.req.valid('json');
	const id = body.id ?? randomUUID();
	await db.execute({
		sql: 'INSERT OR IGNORE INTO seasons (id, name, start_date, end_date) VALUES (?, ?, ?, ?)',
		args: [id, body.name, body.start_date, body.end_date ?? '']
	});
	const result = await db.execute({ sql: 'SELECT * FROM seasons WHERE id = ?', args: [id] });
	return c.json(toSeason(result.rows[0]), 201);
});

export default seasons;
