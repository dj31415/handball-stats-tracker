import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
	checkPassword,
	clearSession,
	clientIp,
	getSession,
	issueSession,
	loginRetryAfter,
	recordLoginFailure,
	resetLoginFailures
} from '../auth.js';
import { invalid } from '../validate.js';

const auth = new Hono();

auth.post(
	'/login',
	zValidator('json', z.object({ password: z.string().max(1000) }), invalid),
	async (c) => {
		const ip = clientIp(c);
		const retryAfter = loginRetryAfter(ip);
		if (retryAfter > 0) {
			c.header('Retry-After', String(retryAfter));
			return c.json({ error: 'rate_limited', retry_after: retryAfter }, 429);
		}
		const role = checkPassword(c.req.valid('json').password);
		if (!role) {
			recordLoginFailure(ip);
			return c.json({ error: 'invalid_password' }, 401);
		}
		resetLoginFailures(ip);
		await issueSession(c, role);
		return c.body(null, 204);
	}
);

auth.post('/logout', (c) => {
	clearSession(c);
	return c.body(null, 204);
});

auth.get('/me', async (c) => {
	const role = await getSession(c);
	if (!role) return c.json({ error: 'unauthorized' }, 401);
	return c.json({ role });
});

export default auth;
