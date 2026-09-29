import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { GAME_STATUSES } from '../../../shared/types.js';
import { db } from '../db.js';
import { toEvent } from '../rows.js';
import { invalid } from '../validate.js';

const events = new Hono();

const query = z.object({
	season_id: z.string().optional(),
	status: z.enum(GAME_STATUSES).optional()
});

events.get('/', zValidator('query', query, invalid), async (c) => {
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
		sql: `SELECT e.* FROM game_events e JOIN games g ON g.id = e.game_id
		      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
		      ORDER BY e.timestamp, e.rowid`,
		args
	});
	return c.json(result.rows.map(toEvent));
});

export default events;
