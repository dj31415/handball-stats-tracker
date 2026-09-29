import path from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import type { PublicConfig } from '../../shared/types.js';
import { config } from './config.js';
import { db, initDB } from './db.js';
import { requireAdminForWrites, requireAuth } from './auth.js';
import authRoutes from './routes/auth.js';
import playersRoutes from './routes/players.js';
import gamesRoutes from './routes/games.js';
import eventsRoutes from './routes/events.js';
import seasonsRoutes from './routes/seasons.js';

const app = new Hono();

app.use('*', secureHeaders());
app.use('*', async (c, next) => {
	await next();
	c.header('X-Robots-Tag', 'noindex');
});
app.use(
	'/api/*',
	bodyLimit({
		maxSize: 256 * 1024,
		onError: (c) => c.json({ error: 'payload_too_large' }, 413)
	})
);

// Reject cross-origin writes (JSON requests are not covered by Hono's csrf() middleware).
app.use('/api/*', async (c, next) => {
	const method = c.req.method;
	if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
		const origin = c.req.header('origin');
		if (origin) {
			let host: string | null = null;
			try {
				host = new URL(origin).host;
			} catch {
				// invalid origin, rejected below
			}
			const expected = (config.TRUST_PROXY && c.req.header('x-forwarded-host')) || c.req.header('host');
			if (host !== expected) return c.json({ error: 'forbidden' }, 403);
		}
	}
	await next();
});

// Public routes
app.get('/api/health', async (c) => {
	await db.execute('SELECT 1');
	return c.json({ ok: true });
});
app.get('/api/config', (c) => {
	const body: PublicConfig = { club_name: config.CLUB_NAME };
	return c.json(body);
});
app.route('/api/auth', authRoutes);

// Protected API routes (viewers are read-only)
app.use('/api/*', requireAuth, requireAdminForWrites);
app.route('/api/players', playersRoutes);
app.route('/api/seasons', seasonsRoutes);
app.route('/api/games', gamesRoutes);
app.route('/api/events', eventsRoutes);
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

// Static SPA
const staticRoot = path.relative(process.cwd(), config.STATIC_DIR) || '.';
app.use(
	'/*',
	serveStatic({
		root: staticRoot,
		onFound: (filePath, c) => {
			if (filePath.includes('/_app/immutable/')) {
				c.header('Cache-Control', 'public, max-age=31536000, immutable');
			} else if (filePath.endsWith('.html')) {
				c.header('Cache-Control', 'no-cache');
			}
		}
	})
);

// SPA fallback: only for page navigations, not for missing assets
const spaFallback = serveStatic({
	root: staticRoot,
	path: 'index.html',
	onFound: (_p, c) => {
		c.header('Cache-Control', 'no-cache');
	}
});
app.get('/*', async (c, next): Promise<Response | void> => {
	const p = c.req.path;
	if (p.startsWith('/_app/') || path.extname(p) !== '') return c.text('Not found', 404);
	return await spaFallback(c, next);
});

app.notFound((c) => c.text('Not found', 404));

app.onError((err, c) => {
	if (err instanceof HTTPException) {
		return c.json({ error: err.status === 400 ? 'invalid' : 'http_error', details: err.message }, err.status);
	}
	console.error(err);
	return c.json({ error: 'internal' }, 500);
});

async function main() {
	await initDB();
	serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST });
	console.log(`Server running on http://${config.HOST}:${config.PORT}`);
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

main();
