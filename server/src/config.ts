import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

function fail(message: string): never {
	console.error(`Configuration error: ${message}`);
	process.exit(1);
}

function bool(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined || value === '') return fallback;
	return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

const env = process.env;

const APP_PASSWORD = env.APP_PASSWORD ?? '';
if (!APP_PASSWORD) {
	if (env.STATS_PIN) fail('STATS_PIN was replaced by APP_PASSWORD. Set APP_PASSWORD instead.');
	fail('APP_PASSWORD is required. Set it to a long, random password.');
}
if (APP_PASSWORD.length < 12) {
	console.warn('Warning: APP_PASSWORD is shorter than 12 characters. Use a longer password.');
}

const VIEWER_PASSWORD = env.VIEWER_PASSWORD || '';
if (VIEWER_PASSWORD && VIEWER_PASSWORD === APP_PASSWORD) {
	fail('VIEWER_PASSWORD must differ from APP_PASSWORD.');
}

const DATA_DIR = path.resolve(env.DATA_DIR || path.resolve(process.cwd(), 'data'));
const DB_PATH = path.resolve(env.DB_PATH || path.join(DATA_DIR, 'handball.db'));
const STATIC_DIR = path.resolve(env.STATIC_DIR || path.resolve(process.cwd(), '../client/build'));

function loadSessionSecret(): string {
	if (env.SESSION_SECRET) return env.SESSION_SECRET;
	const file = path.join(DATA_DIR, '.session-secret');
	try {
		return fs.readFileSync(file, 'utf8').trim();
	} catch {
		const secret = randomBytes(32).toString('hex');
		fs.mkdirSync(DATA_DIR, { recursive: true });
		fs.writeFileSync(file, secret, { mode: 0o600 });
		return secret;
	}
}

export const config = {
	PORT: parseInt(env.PORT || '3001'),
	HOST: env.HOST || '0.0.0.0',
	DATA_DIR,
	DB_PATH,
	STATIC_DIR,
	CLUB_NAME: env.CLUB_NAME?.trim() || 'Handball Stats',
	APP_PASSWORD,
	VIEWER_PASSWORD,
	SESSION_SECRET: loadSessionSecret(),
	COOKIE_SECURE: bool(env.COOKIE_SECURE, env.NODE_ENV === 'production'),
	TRUST_PROXY: bool(env.TRUST_PROXY, false)
};
