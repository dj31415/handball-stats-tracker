#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
//
// API contract test for the Handball Statistics Tracker backends (Node reference server and PHP twin).
// Black-box: it only speaks HTTP, so the same run must pass against both backends.
//
// Usage:
//   node php/tests/contract.mjs --base http://localhost:3001 --password devpassword \
//        [--viewer-password viewerpass123] [--skip-ratelimit]
//
// Requirements:
//   - Node 22+ (built-in fetch), no dependencies.
//   - The server must use a FRESH, EMPTY database (the suite asserts exact list contents and aborts
//     if players/seasons/games already exist). Restart with a new data dir before every run.
//   - The login rate limiter must be untouched: the last section locks this client's IP out of
//     /api/auth/login for 15 minutes. The Node server keeps that state in memory (restart it);
//     the PHP server keeps it in <data_dir>/ratelimit.db (use a fresh data dir).
//     Use --skip-ratelimit to leave it out (e.g. when re-running against a long-lived server).
//   - --base must reach the server directly (the Origin check compares against the Host header the
//     server sees; a proxy that rewrites Host would break the CSRF checks).

import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';

// ── CLI ──

const { values: args } = parseArgs({
	options: {
		base: { type: 'string', default: 'http://localhost:3001' },
		password: { type: 'string' },
		'viewer-password': { type: 'string' },
		'skip-ratelimit': { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h', default: false }
	}
});

if (args.help || !args.password) {
	console.log(
		'Usage: node php/tests/contract.mjs --base <url> --password <admin password> ' +
			'[--viewer-password <viewer password>] [--skip-ratelimit]\n' +
			'Runs against a FRESH, EMPTY database. See php/tests/README.md.'
	);
	process.exit(args.help ? 0 : 2);
}

const BASE = args.base.replace(/\/+$/, '');
const BASE_URL = new URL(BASE);
const ADMIN_PW = args.password;
const VIEWER_PW = args['viewer-password'];

// ── Enums (copied from shared/types.ts) ──

const POSITIONS = ['LW', 'LB', 'CB', 'RB', 'RW', 'PV', 'GK'];
const SHOT_ZONES = ['LW', 'PV', 'RW', 'LB', 'CB', 'RB'];
const EVENT_TYPES = [
	'goal', 'miss', 'goal_7m', 'miss_7m', 'tech_mistake', 'suspension_2min', 'yellow_card',
	'red_card', 'save', 'save_7m', 'conceded', 'conceded_7m', 'opponent_goal', 'opponent_7m'
];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION_SECONDS = 30 * 24 * 60 * 60;

// ── Tiny runner ──

const results = [];
let currentSection = '';

function section(name) {
	currentSection = name;
	console.log(`\n${name}`);
}

async function check(name, fn) {
	try {
		await fn();
		results.push({ section: currentSection, name, status: 'pass' });
		console.log(`  ok    ${name}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		results.push({ section: currentSection, name, status: 'fail', message });
		console.log(`  FAIL  ${name}`);
		console.log(indent(message, 8));
	}
}

function skip(name, reason) {
	results.push({ section: currentSection, name, status: 'skip', message: reason });
	console.log(`  skip  ${name} (${reason})`);
}

function indent(text, n) {
	const pad = ' '.repeat(n);
	const lines = text.split('\n');
	const shown = lines.length > 40 ? [...lines.slice(0, 40), `... (${lines.length - 40} more lines)`] : lines;
	return shown.map((l) => pad + l).join('\n');
}

function abort(message) {
	console.error(`\nABORTED: ${message}`);
	process.exit(2);
}

// ── HTTP client with a minimal cookie jar ──

function parseSetCookie(header) {
	const [nameValue, ...rest] = header.split(';').map((s) => s.trim());
	const eq = nameValue.indexOf('=');
	const attrs = {};
	for (const a of rest) {
		if (!a) continue;
		const i = a.indexOf('=');
		if (i < 0) attrs[a.toLowerCase()] = true;
		else attrs[a.slice(0, i).trim().toLowerCase()] = a.slice(i + 1).trim();
	}
	return { name: nameValue.slice(0, eq), value: nameValue.slice(eq + 1), attrs };
}

function isDeletion(cookie) {
	if (cookie.value === '') return true;
	if (cookie.attrs['max-age'] !== undefined && Number(cookie.attrs['max-age']) <= 0) return true;
	if (typeof cookie.attrs.expires === 'string' && Date.parse(cookie.attrs.expires) <= Date.now()) return true;
	return false;
}

class Client {
	constructor(label) {
		this.label = label;
		this.jar = new Map();
	}

	cookieHeader() {
		return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
	}

	/**
	 * @param {string} method
	 * @param {string} path  path incl. query, e.g. /api/players?active=1
	 * @param {{json?: unknown, raw?: string, contentType?: string|null, headers?: Record<string,string>, cookie?: string}} [opts]
	 */
	async req(method, path, opts = {}) {
		const headers = { ...(opts.headers ?? {}) };
		let body;
		if (opts.json !== undefined) {
			body = JSON.stringify(opts.json);
			headers['content-type'] = 'application/json';
		} else if (opts.raw !== undefined) {
			// Uint8Array so fetch does not add a default text/plain content type
			body = new TextEncoder().encode(opts.raw);
			const ct = opts.contentType === undefined ? 'application/json' : opts.contentType;
			if (ct !== null) headers['content-type'] = ct;
		}
		const cookie = opts.cookie !== undefined ? opts.cookie : this.cookieHeader();
		if (cookie) headers.cookie = cookie;

		let res;
		for (let attempt = 1; ; attempt++) {
			try {
				res = await fetch(BASE + path, {
					method,
					headers,
					body,
					redirect: 'manual',
					signal: AbortSignal.timeout(15000)
				});
				break;
			} catch (err) {
				// A server that answers early (e.g. 413) without reading the body may close the
				// keep-alive socket; the next request on that socket then fails. Retry once on a
				// fresh connection (all writes in this API are idempotent).
				const code = err.cause?.code ?? '';
				const retryable = ['UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE'].includes(code) || /other side closed/i.test(err.cause?.message ?? '');
				if (attempt === 1 && retryable) continue;
				throw new Error(`${method} ${path}: request failed: ${err.cause?.message ?? err.message}`);
			}
		}
		const text = await res.text();
		let json;
		if (text !== '') {
			try {
				json = JSON.parse(text);
			} catch {
				json = undefined;
			}
		}
		const setCookies = res.headers.getSetCookie();
		for (const sc of setCookies) {
			const c = parseSetCookie(sc);
			if (isDeletion(c)) this.jar.delete(c.name);
			else this.jar.set(c.name, c.value);
		}
		return { method, path, status: res.status, headers: res.headers, text, json, setCookies };
	}

	get(path, opts) { return this.req('GET', path, opts); }
	post(path, json, opts = {}) { return this.req('POST', path, { ...opts, json }); }
	patch(path, json, opts = {}) { return this.req('PATCH', path, { ...opts, json }); }
	del(path, opts) { return this.req('DELETE', path, opts); }
}

// ── Assertions ──

function describe(res) {
	return `${res.method} ${res.path} -> ${res.status} ${res.text.length > 600 ? res.text.slice(0, 600) + '...' : res.text}`;
}

function expectStatus(res, status) {
	assert.equal(res.status, status, `expected status ${status}, got: ${describe(res)}`);
}

function expectJsonType(res) {
	const ct = res.headers.get('content-type') ?? '';
	assert.ok(/^application\/json\b/i.test(ct), `expected JSON content type, got "${ct}" (${describe(res)})`);
	assert.notEqual(res.json, undefined, `body is not valid JSON: ${describe(res)}`);
}

function expectJson(res, status, expected) {
	expectStatus(res, status);
	expectJsonType(res);
	assert.deepStrictEqual(res.json, expected, `JSON body mismatch for ${res.method} ${res.path}`);
}

function expectError(res, status, error) {
	expectJson(res, status, { error });
}

function expectNoContent(res) {
	expectStatus(res, 204);
	assert.equal(res.text, '', `204 must have an empty body: ${describe(res)}`);
}

const ANY = Symbol('any details');

/** 400 {error:'invalid', details}. details: undefined => non-empty array, ANY => any value, else exact. */
function expectInvalid(res, details) {
	expectStatus(res, 400);
	expectJsonType(res);
	assert.equal(res.json?.error, 'invalid', `expected error "invalid": ${describe(res)}`);
	assert.deepStrictEqual(Object.keys(res.json).sort(), ['details', 'error'], `keys must be exactly error, details: ${describe(res)}`);
	if (details === undefined) {
		assert.ok(Array.isArray(res.json.details) && res.json.details.length > 0, `details must be a non-empty array: ${describe(res)}`);
	} else if (details !== ANY) {
		assert.deepStrictEqual(res.json, { error: 'invalid', details });
	}
}

function expectHeader(res, name, expected) {
	const v = res.headers.get(name);
	assert.equal(v, expected, `header ${name}: expected "${expected}", got "${v}" (${res.method} ${res.path})`);
}

// SQLite BINARY collation = byte order of the UTF-8 encoding
const bin = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

// ── Expected state model ──

const model = {
	players: new Map(), // id -> Player
	seasons: new Map(), // id -> Season
	games: new Map(), // id -> { game, seq, roster:Set }
	events: new Map(), // id -> { event, seq }
	gameSeq: 0,
	eventSeq: 0
};

function expectedPlayers({ activeOnly = false, ids } = {}) {
	return [...model.players.values()]
		.filter((p) => (!activeOnly || p.is_active === 1) && (!ids || ids.has(p.id)))
		.sort((a, b) => a.number - b.number || bin(a.name, b.name))
		.map((p) => ({ ...p }));
}

function expectedSeasons() {
	return [...model.seasons.values()].sort((a, b) => bin(a.start_date, b.start_date)).map((s) => ({ ...s }));
}

function scoreOf(gameId) {
	let own = 0;
	let opp = 0;
	for (const { event } of model.events.values()) {
		if (event.game_id !== gameId) continue;
		if (event.event_type === 'goal' || event.event_type === 'goal_7m') own++;
		if (event.event_type === 'opponent_goal' || event.event_type === 'opponent_7m') opp++;
	}
	return { own_score: own, opp_score: opp };
}

function expectedGames({ season_id, status } = {}) {
	return [...model.games.values()]
		.filter(({ game }) => (!season_id || game.season_id === season_id) && (!status || game.status === status))
		.sort((a, b) => -bin(a.game.date, b.game.date) || b.seq - a.seq)
		.map(({ game }) => ({ ...game, ...scoreOf(game.id) }));
}

function expectedEvents(filter = () => true) {
	return [...model.events.values()]
		.filter(({ event }) => filter(event))
		.sort((a, b) => bin(a.event.timestamp, b.event.timestamp) || a.seq - b.seq)
		.map(({ event }) => ({ ...event }));
}

function expectedEventsWhere({ season_id, status } = {}) {
	return expectedEvents((e) => {
		const g = model.games.get(e.game_id)?.game;
		if (!g) return false;
		return (!season_id || g.season_id === season_id) && (!status || g.status === status);
	});
}

function expectedDetail(gameId) {
	const g = model.games.get(gameId);
	return {
		game: { ...g.game },
		roster: expectedPlayers({ ids: g.roster }),
		events: expectedEvents((e) => e.game_id === gameId)
	};
}

function addEvents(events) {
	for (const e of events) {
		if (!model.events.has(e.id)) model.events.set(e.id, { event: { ...e }, seq: model.eventSeq++ });
	}
}

// ── Clients ──

const admin = new Client('admin');
const anon = new Client('anonymous');

const sessionNames = new Set(['session', '__Host-session']);
let sessionCookieName = null;

// ════════════════════════════════════════════════════════════════════
// Preflight
// ════════════════════════════════════════════════════════════════════

section('Preflight');
{
	let res;
	try {
		res = await anon.get('/api/health');
	} catch (err) {
		abort(`server not reachable at ${BASE}: ${err.message}`);
	}
	if (res.status !== 200) abort(`GET /api/health returned ${res.status}: ${res.text}`);

	res = await admin.post('/api/auth/login', { password: ADMIN_PW });
	if (res.status === 429) {
		abort('login is rate limited (429). The previous run tripped the limiter: restart the Node server / use a fresh PHP data dir (ratelimit.db).');
	}
	if (res.status !== 204) abort(`admin login failed with ${res.status}: ${res.text}`);
	sessionCookieName = [...admin.jar.keys()].find((k) => sessionNames.has(k)) ?? null;
	if (!sessionCookieName) abort(`admin login did not set a session cookie: ${JSON.stringify(res.setCookies)}`);

	for (const path of ['/api/players', '/api/seasons', '/api/games', '/api/events']) {
		const r = await admin.get(path);
		if (r.status !== 200 || r.text.trim() !== '[]') {
			abort(`${path} is not empty (${r.status} ${r.text.slice(0, 200)}). The suite needs a FRESH, EMPTY database.`);
		}
	}
	console.log(`  ok    server at ${BASE} is up, admin login works, database is empty (cookie "${sessionCookieName}")`);
}

// ════════════════════════════════════════════════════════════════════
// Public endpoints and headers
// ════════════════════════════════════════════════════════════════════

section('Public endpoints');

await check('GET /api/health without session -> 200 {ok:true}', async () => {
	expectJson(await anon.get('/api/health'), 200, { ok: true });
});

await check('GET /api/config without session -> 200 {club_name: non-empty string}, no other keys', async () => {
	const res = await anon.get('/api/config');
	expectStatus(res, 200);
	expectJsonType(res);
	assert.deepStrictEqual(Object.keys(res.json), ['club_name']);
	assert.equal(typeof res.json.club_name, 'string');
	assert.ok(res.json.club_name.length > 0, 'club_name must not be empty');
});

await check('security headers on API 200 response (nosniff, SAMEORIGIN, no-referrer, noindex)', async () => {
	const res = await anon.get('/api/health');
	expectHeader(res, 'x-content-type-options', 'nosniff');
	expectHeader(res, 'x-frame-options', 'SAMEORIGIN');
	expectHeader(res, 'referrer-policy', 'no-referrer');
	expectHeader(res, 'x-robots-tag', 'noindex');
});

await check('security headers also on API error responses (401)', async () => {
	const res = await anon.get('/api/players');
	expectStatus(res, 401);
	expectHeader(res, 'x-content-type-options', 'nosniff');
	expectHeader(res, 'x-frame-options', 'SAMEORIGIN');
	expectHeader(res, 'referrer-policy', 'no-referrer');
	expectHeader(res, 'x-robots-tag', 'noindex');
});

// ════════════════════════════════════════════════════════════════════
// Auth
// ════════════════════════════════════════════════════════════════════

section('Auth');

await check('GET /api/auth/me without cookie -> 401 unauthorized', async () => {
	expectError(await anon.get('/api/auth/me'), 401, 'unauthorized');
});

for (const [method, path] of [
	['GET', '/api/players'],
	['GET', '/api/seasons'],
	['GET', '/api/games'],
	['GET', '/api/games/some-id'],
	['GET', '/api/events'],
	['POST', '/api/players'],
	['DELETE', '/api/games/some-id'],
	['GET', '/api/does-not-exist']
]) {
	await check(`${method} ${path} without cookie -> 401 unauthorized`, async () => {
		const opts = method === 'POST' ? { json: { name: 'X', number: 1, position: 'LW' } } : {};
		expectError(await anon.req(method, path, opts), 401, 'unauthorized');
	});
}

await check('login with wrong password -> 401 invalid_password, no cookie', async () => {
	const c = new Client('wrong');
	const res = await c.post('/api/auth/login', { password: 'definitely-wrong' });
	expectError(res, 401, 'invalid_password');
	assert.equal(res.setCookies.length, 0, `unexpected Set-Cookie: ${res.setCookies}`);
});

await check('login body validation: {} -> 400 invalid (details array)', async () => {
	expectInvalid(await anon.post('/api/auth/login', {}));
});
await check('login body validation: password is a number -> 400 invalid', async () => {
	expectInvalid(await anon.post('/api/auth/login', { password: 12345 }));
});
await check('login body validation: password longer than 1000 chars -> 400 invalid', async () => {
	expectInvalid(await anon.post('/api/auth/login', { password: 'x'.repeat(1001) }));
});
await check('login body validation: password null -> 400 invalid', async () => {
	expectInvalid(await anon.post('/api/auth/login', { password: null }));
});
await check('login body: malformed JSON -> 400 invalid', async () => {
	expectInvalid(await anon.req('POST', '/api/auth/login', { raw: '{"password":' }), ANY);
});
await check('login body: JSON array -> 400 invalid', async () => {
	expectInvalid(await anon.req('POST', '/api/auth/login', { raw: '["devpassword"]' }));
});

const fresh = new Client('fresh-admin');
let loginRes;
await check('login with admin password -> 204, empty body, exactly one Set-Cookie', async () => {
	loginRes = await fresh.post('/api/auth/login', { password: ADMIN_PW });
	expectNoContent(loginRes);
	assert.equal(loginRes.setCookies.length, 1, `Set-Cookie headers: ${JSON.stringify(loginRes.setCookies)}`);
});

await check('session cookie attributes: name session|__Host-session, HttpOnly, SameSite=Strict, Path=/, Max-Age=2592000, Secure iff __Host-', async () => {
	const c = parseSetCookie(loginRes.setCookies[0]);
	assert.ok(sessionNames.has(c.name), `cookie name "${c.name}"`);
	assert.equal(c.attrs.httponly, true, 'HttpOnly missing');
	assert.equal(String(c.attrs.samesite).toLowerCase(), 'strict', `SameSite=${c.attrs.samesite}`);
	assert.equal(c.attrs.path, '/', `Path=${c.attrs.path}`);
	assert.equal(c.attrs['max-age'], String(SESSION_SECONDS), `Max-Age=${c.attrs['max-age']}`);
	if (c.name === '__Host-session') {
		assert.equal(c.attrs.secure, true, '__Host- cookie requires Secure');
		assert.equal(c.attrs.domain, undefined, '__Host- cookie must not have Domain');
	} else {
		assert.equal(c.attrs.secure, undefined, 'plain "session" cookie (cookie_secure off) should not be Secure');
	}
});

await check('session cookie value: v1.admin.<exp>.<16 hex tag>.<base64 HMAC> (URL-decoded), exp = now + 30 days', async () => {
	const c = parseSetCookie(loginRes.setCookies[0]);
	const decoded = decodeURIComponent(c.value);
	const m = /^v1\.admin\.(\d+)\.([0-9a-f]{16})\.([A-Za-z0-9+/]{43}=)$/.exec(decoded);
	assert.ok(m, `unexpected cookie value format: ${decoded}`);
	const exp = Number(m[1]);
	const expected = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
	assert.ok(Math.abs(exp - expected) <= 300, `exp ${exp} is not ~now+30d (${expected}); clock skew?`);
});

await check('GET /api/auth/me with fresh session -> 200 {role:"admin"} and no cookie re-issue', async () => {
	const res = await fresh.get('/api/auth/me');
	expectJson(res, 200, { role: 'admin' });
	assert.equal(res.setCookies.length, 0, `fresh session must not be re-issued: ${res.setCookies}`);
});

await check('tampered signature -> me 401 unauthorized', async () => {
	const value = decodeURIComponent(fresh.jar.get(sessionCookieName));
	const lastDot = value.lastIndexOf('.');
	const sig = value.slice(lastDot + 1);
	const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
	const forged = encodeURIComponent(value.slice(0, lastDot + 1) + flipped);
	expectError(await anon.get('/api/auth/me', { cookie: `${sessionCookieName}=${forged}` }), 401, 'unauthorized');
});

await check('role changed to viewer with the admin signature -> me 401 unauthorized', async () => {
	const value = decodeURIComponent(fresh.jar.get(sessionCookieName));
	const forged = encodeURIComponent(value.replace(/^v1\.admin\./, 'v1.viewer.'));
	expectError(await anon.get('/api/auth/me', { cookie: `${sessionCookieName}=${forged}` }), 401, 'unauthorized');
});

await check('garbage session cookie -> protected route 401 unauthorized', async () => {
	expectError(await anon.get('/api/players', { cookie: `${sessionCookieName}=garbage` }), 401, 'unauthorized');
});

await check('POST /api/auth/logout -> 204 and Set-Cookie that clears the session cookie', async () => {
	const res = await fresh.post('/api/auth/logout', undefined);
	expectNoContent(res);
	const cleared = res.setCookies.map(parseSetCookie).find((c) => c.name === sessionCookieName);
	assert.ok(cleared, `no Set-Cookie for ${sessionCookieName}: ${JSON.stringify(res.setCookies)}`);
	assert.ok(isDeletion(cleared), `Set-Cookie does not delete the cookie: ${JSON.stringify(res.setCookies)}`);
	assert.equal(cleared.attrs.path, '/', 'cleared cookie must use Path=/');
	assert.equal(fresh.jar.size, 0, 'cookie jar should be empty after logout');
});

await check('GET /api/auth/me after logout -> 401 unauthorized', async () => {
	expectError(await fresh.get('/api/auth/me'), 401, 'unauthorized');
});

await check('POST /api/auth/logout without session -> 204', async () => {
	expectNoContent(await anon.post('/api/auth/logout', undefined));
});

if (VIEWER_PW) {
	const viewer = new Client('viewer');
	await check('viewer login -> 204 with session cookie v1.viewer...', async () => {
		const res = await viewer.post('/api/auth/login', { password: VIEWER_PW });
		expectNoContent(res);
		const value = decodeURIComponent(viewer.jar.get(sessionCookieName) ?? '');
		assert.match(value, /^v1\.viewer\.\d+\.[0-9a-f]{16}\./);
	});
	await check('viewer GET /api/auth/me -> {role:"viewer"}', async () => {
		expectJson(await viewer.get('/api/auth/me'), 200, { role: 'viewer' });
	});
	for (const path of ['/api/players', '/api/players?active=1', '/api/seasons', '/api/games', '/api/events']) {
		await check(`viewer GET ${path} -> 200 []`, async () => {
			expectJson(await viewer.get(path), 200, []);
		});
	}
	await check('viewer GET /api/games/unknown -> 404 not_found', async () => {
		expectError(await viewer.get('/api/games/unknown'), 404, 'not_found');
	});
	for (const [method, path, json] of [
		['POST', '/api/players', { name: 'Viewer', number: 1, position: 'LW' }],
		['POST', '/api/players', { invalid: true }],
		['PATCH', '/api/players/whatever', { name: 'X' }],
		['DELETE', '/api/players/whatever', undefined],
		['POST', '/api/seasons', { name: 'S', start_date: '2025-01-01' }],
		['POST', '/api/games', {}],
		['PATCH', '/api/games/whatever', {}],
		['DELETE', '/api/games/whatever', undefined],
		['POST', '/api/games/whatever/events', { events: [] }],
		['DELETE', '/api/games/whatever/events?ids=a', undefined],
		['POST', '/api/does-not-exist', {}]
	]) {
		await check(`viewer ${method} ${path} ${json && 'invalid' in json ? '(invalid body) ' : ''}-> 403 forbidden`, async () => {
			expectError(await viewer.req(method, path, json === undefined ? {} : { json }), 403, 'forbidden');
		});
	}
	await check('viewer POST /api/auth/logout -> 204 (auth routes are not write-protected)', async () => {
		expectNoContent(await viewer.post('/api/auth/logout', undefined));
		expectError(await viewer.get('/api/auth/me'), 401, 'unauthorized');
	});
} else {
	skip('viewer role checks', 'no --viewer-password given');
}

// ════════════════════════════════════════════════════════════════════
// CSRF / Origin
// ════════════════════════════════════════════════════════════════════

section('CSRF / Origin');

const SAME_ORIGIN = BASE_URL.origin;
const otherPort = String((Number(BASE_URL.port || (BASE_URL.protocol === 'https:' ? 443 : 80)) % 65535) + 1);
const OTHER_PORT_ORIGIN = `${BASE_URL.protocol}//${BASE_URL.hostname}:${otherPort}`;

await check('POST with foreign Origin (http://evil.example) -> 403 forbidden', async () => {
	const res = await admin.post('/api/players', { id: 'csrf-evil', name: 'Evil', number: 1, position: 'LW' }, { headers: { origin: 'http://evil.example' } });
	expectError(res, 403, 'forbidden');
});
await check('POST with Origin on same host but other port -> 403 forbidden', async () => {
	const res = await admin.post('/api/players', { id: 'csrf-port', name: 'Port', number: 1, position: 'LW' }, { headers: { origin: OTHER_PORT_ORIGIN } });
	expectError(res, 403, 'forbidden');
});
await check('POST with unparseable Origin "null" -> 403 forbidden', async () => {
	const res = await admin.post('/api/players', { id: 'csrf-null', name: 'Null', number: 1, position: 'LW' }, { headers: { origin: 'null' } });
	expectError(res, 403, 'forbidden');
});
await check('DELETE with foreign Origin -> 403 forbidden', async () => {
	expectError(await admin.del('/api/games/whatever', { headers: { origin: 'http://evil.example' } }), 403, 'forbidden');
});
await check('foreign Origin without session -> 403 (origin check runs before auth)', async () => {
	const res = await anon.post('/api/players', { name: 'Evil', number: 1, position: 'LW' }, { headers: { origin: 'http://evil.example' } });
	expectError(res, 403, 'forbidden');
});
await check('login with foreign Origin and correct password -> 403 forbidden, no cookie', async () => {
	const c = new Client('csrf-login');
	const res = await c.post('/api/auth/login', { password: ADMIN_PW }, { headers: { origin: 'http://evil.example' } });
	expectError(res, 403, 'forbidden');
	assert.equal(res.setCookies.length, 0);
});
await check('GET with foreign Origin -> allowed (200)', async () => {
	expectJson(await admin.get('/api/players', { headers: { origin: 'http://evil.example' } }), 200, []);
});
await check(`POST with matching Origin (${SAME_ORIGIN}) -> allowed (201)`, async () => {
	const res = await admin.post('/api/players', { id: 'csrf-ok', name: 'Same Origin', number: 1, position: 'LW' }, { headers: { origin: SAME_ORIGIN } });
	expectJson(res, 201, { id: 'csrf-ok', name: 'Same Origin', number: 1, position: 'LW', is_active: 1 });
	expectNoContent(await admin.del('/api/players/csrf-ok', { headers: { origin: SAME_ORIGIN } }));
});
await check('POST without Origin header -> allowed (201)', async () => {
	const res = await admin.post('/api/players', { id: 'csrf-none', name: 'No Origin', number: 1, position: 'LW' });
	expectJson(res, 201, { id: 'csrf-none', name: 'No Origin', number: 1, position: 'LW', is_active: 1 });
	expectNoContent(await admin.del('/api/players/csrf-none'));
});
await check('rejected cross-origin writes did not create anything', async () => {
	expectJson(await admin.get('/api/players'), 200, []);
});

// ════════════════════════════════════════════════════════════════════
// Request bodies
// ════════════════════════════════════════════════════════════════════

section('Request bodies');

function bodyOfLength(total) {
	const prefix = '{"name":"';
	const suffix = '","number":1,"position":"LW"}';
	return prefix + 'a'.repeat(total - prefix.length - suffix.length) + suffix;
}

await check('POST /api/players with 300 KB JSON body -> 413 payload_too_large', async () => {
	expectError(await admin.req('POST', '/api/players', { raw: bodyOfLength(300 * 1024) }), 413, 'payload_too_large');
});
await check('413 body limit applies before auth (no session)', async () => {
	expectError(await anon.req('POST', '/api/players', { raw: bodyOfLength(300 * 1024) }), 413, 'payload_too_large');
});
await check('body of exactly 262144 bytes is accepted by the limit (-> 400 invalid name, not 413)', async () => {
	const raw = bodyOfLength(262144);
	assert.equal(Buffer.byteLength(raw), 262144);
	expectInvalid(await admin.req('POST', '/api/players', { raw }));
});
await check('body of 262145 bytes -> 413 payload_too_large', async () => {
	expectError(await admin.req('POST', '/api/players', { raw: bodyOfLength(262145) }), 413, 'payload_too_large');
});
await check('malformed JSON -> 400 {error:"invalid", details}', async () => {
	expectInvalid(await admin.req('POST', '/api/players', { raw: '{"name": "x",' }), ANY);
});
await check('empty body with JSON content type -> 400 invalid', async () => {
	expectInvalid(await admin.req('POST', '/api/players', { raw: '' }), ANY);
});
for (const raw of ['[1,2]', '"text"', '42', 'null', 'true']) {
	await check(`non-object JSON body ${raw} -> 400 invalid`, async () => {
		expectInvalid(await admin.req('POST', '/api/players', { raw }));
	});
}
await check('valid JSON sent as text/plain is not parsed (treated as {}) -> 400 invalid', async () => {
	const raw = JSON.stringify({ id: 'ct-plain', name: 'Plain', number: 1, position: 'LW' });
	expectInvalid(await admin.req('POST', '/api/players', { raw, contentType: 'text/plain' }));
});
await check('valid JSON without Content-Type is not parsed (treated as {}) -> 400 invalid', async () => {
	const raw = JSON.stringify({ id: 'ct-none', name: 'None', number: 1, position: 'LW' });
	expectInvalid(await admin.req('POST', '/api/players', { raw, contentType: null }));
});
await check('Content-Type "application/json; charset=utf-8" is accepted', async () => {
	const raw = JSON.stringify({ id: 'ct-charset', name: 'Charset', number: 1, position: 'LW' });
	const res = await admin.req('POST', '/api/players', { raw, contentType: 'application/json; charset=utf-8' });
	expectJson(res, 201, { id: 'ct-charset', name: 'Charset', number: 1, position: 'LW', is_active: 1 });
	expectNoContent(await admin.del('/api/players/ct-charset'));
});
await check('nothing was created by the body tests', async () => {
	expectJson(await admin.get('/api/players'), 200, []);
});

// ════════════════════════════════════════════════════════════════════
// Players
// ════════════════════════════════════════════════════════════════════

section('Players');

let annaId = null;

async function createPlayer(input, expected) {
	const res = await admin.post('/api/players', input);
	expectJson(res, 201, expected);
	model.players.set(expected.id, { ...expected });
	return res;
}

await check('create without id -> 201, UUID v4 id, trimmed name, is_active defaults to 1', async () => {
	const res = await admin.post('/api/players', { name: '  Anna Alpha  ', number: 7, position: 'LW' });
	expectStatus(res, 201);
	expectJsonType(res);
	assert.match(String(res.json.id), UUID_V4, `generated id "${res.json.id}" is not a UUID v4`);
	annaId = res.json.id;
	const expected = { id: annaId, name: 'Anna Alpha', number: 7, position: 'LW', is_active: 1 };
	assert.deepStrictEqual(res.json, expected);
	model.players.set(annaId, expected);
});
await check('create with id and is_active 0 -> 201 exact row (number/is_active are JSON numbers)', async () => {
	await createPlayer({ id: 'p-bert', name: 'Bert', number: 7, position: 'CB', is_active: 0 }, { id: 'p-bert', name: 'Bert', number: 7, position: 'CB', is_active: 0 });
});
await check('create with is_active 1 -> 201', async () => {
	await createPlayer({ id: 'p-adam', name: 'adam', number: 7, position: 'RB', is_active: 1 }, { id: 'p-adam', name: 'adam', number: 7, position: 'RB', is_active: 1 });
});
await check('create more players (number 0, 999, inactive)', async () => {
	await createPlayer({ id: 'p-zed', name: 'Zed', number: 7, position: 'RW', is_active: 0 }, { id: 'p-zed', name: 'Zed', number: 7, position: 'RW', is_active: 0 });
	await createPlayer({ id: 'p-carl', name: 'Carl', number: 0, position: 'GK' }, { id: 'p-carl', name: 'Carl', number: 0, position: 'GK', is_active: 1 });
	await createPlayer({ id: 'p-dora', name: 'Dora', number: 999, position: 'PV' }, { id: 'p-dora', name: 'Dora', number: 999, position: 'PV', is_active: 1 });
	await createPlayer({ id: 'p-pos', name: 'Pos', number: 5, position: 'LB' }, { id: 'p-pos', name: 'Pos', number: 5, position: 'LB', is_active: 1 });
});
await check('create with unicode name and id containing space/plus/umlaut; raw JSON keeps UTF-8 unescaped', async () => {
	const res = await createPlayer({ id: 'p ü+1', name: 'Jörg Ünal', number: 12, position: 'RB' }, { id: 'p ü+1', name: 'Jörg Ünal', number: 12, position: 'RB', is_active: 1 });
	assert.ok(res.text.includes('Jörg Ünal'), `raw body should contain unescaped UTF-8 (JSON_UNESCAPED_UNICODE): ${res.text}`);
});
await check('unknown keys are ignored on create', async () => {
	await createPlayer({ id: 'p-extra', name: 'Extra', number: 44, position: 'LB', foo: 'bar', is_home: true }, { id: 'p-extra', name: 'Extra', number: 44, position: 'LB', is_active: 1 });
});
await check('idempotent re-create with existing id -> 201 with the EXISTING row (unchanged)', async () => {
	const res = await admin.post('/api/players', { id: 'p-bert', name: 'Other Name', number: 50, position: 'LW', is_active: 1 });
	expectJson(res, 201, { id: 'p-bert', name: 'Bert', number: 7, position: 'CB', is_active: 0 });
});
await check('surrounding tabs/newlines are trimmed from name', async () => {
	await createPlayer({ id: 'p-tim', name: '\n\tTim \r', number: 22, position: 'CB' }, { id: 'p-tim', name: 'Tim', number: 22, position: 'CB', is_active: 1 });
});
await check('[edge] name trim uses JS semantics: non-breaking spaces are trimmed', async () => {
	await createPlayer({ id: 'p-nbsp', name: ' Bob ', number: 21, position: 'CB' }, { id: 'p-nbsp', name: 'Bob', number: 21, position: 'CB', is_active: 1 });
});
await check('[edge] name of 100 "ö" (100 chars, 200 bytes) is accepted (length is not counted in bytes)', async () => {
	const name = 'ö'.repeat(100);
	await createPlayer({ id: 'p-umlaut100', name, number: 33, position: 'LW' }, { id: 'p-umlaut100', name, number: 33, position: 'LW', is_active: 1 });
});
await check('[edge] name of 100 emoji (100 code points, 200 UTF-16 units, 400 bytes) is accepted: length = code points', async () => {
	const name = '😀'.repeat(100);
	await createPlayer({ id: 'p-emoji100', name, number: 50, position: 'LW' }, { id: 'p-emoji100', name, number: 50, position: 'LW', is_active: 1 });
});
await check('[edge] number 7.0 in raw JSON is an integer -> 201 with number 7', async () => {
	const res = await admin.req('POST', '/api/players', { raw: '{"id":"p-float","name":"Float","number":7.0,"position":"LW"}' });
	const expected = { id: 'p-float', name: 'Float', number: 7, position: 'LW', is_active: 1 };
	expectJson(res, 201, expected);
	model.players.set('p-float', expected);
});

const playerInvalid = [
	['name empty', { name: '', number: 1, position: 'LW' }],
	['name whitespace-only', { name: '   ', number: 1, position: 'LW' }],
	['[edge] name only a non-breaking space', { name: ' ', number: 1, position: 'LW' }],
	['name 101 chars', { name: 'a'.repeat(101), number: 1, position: 'LW' }],
	['[edge] name 101 emoji (101 code points)', { name: '😀'.repeat(101), number: 1, position: 'LW' }],
	['[edge] name 101 "ö" (101 code points)', { name: 'ö'.repeat(101), number: 1, position: 'LW' }],
	['name missing', { number: 1, position: 'LW' }],
	['name null', { name: null, number: 1, position: 'LW' }],
	['name is a number', { name: 123, number: 1, position: 'LW' }],
	['number 1000', { name: 'X', number: 1000, position: 'LW' }],
	['number -1', { name: 'X', number: -1, position: 'LW' }],
	['number "7" (string)', { name: 'X', number: '7', position: 'LW' }],
	['number 1.5 (float)', { name: 'X', number: 1.5, position: 'LW' }],
	['number null', { name: 'X', number: null, position: 'LW' }],
	['number true', { name: 'X', number: true, position: 'LW' }],
	['number missing', { name: 'X', position: 'LW' }],
	['position "XX"', { name: 'X', number: 1, position: 'XX' }],
	['position "lw" (wrong case)', { name: 'X', number: 1, position: 'lw' }],
	['position missing', { name: 'X', number: 1 }],
	['is_active 2', { name: 'X', number: 1, position: 'LW', is_active: 2 }],
	['is_active true', { name: 'X', number: 1, position: 'LW', is_active: true }],
	['is_active "1"', { name: 'X', number: 1, position: 'LW', is_active: '1' }],
	['is_active null', { name: 'X', number: 1, position: 'LW', is_active: null }],
	['id empty string', { id: '', name: 'X', number: 1, position: 'LW' }],
	['id 101 chars', { id: 'i'.repeat(101), name: 'X', number: 1, position: 'LW' }],
	['id is a number', { id: 5, name: 'X', number: 1, position: 'LW' }],
	['id null', { id: null, name: 'X', number: 1, position: 'LW' }]
];
for (const [label, body] of playerInvalid) {
	await check(`create validation: ${label} -> 400 invalid`, async () => {
		expectInvalid(await admin.post('/api/players', body));
	});
}

await check('GET /api/players -> all players ordered by number, then name (binary collation), invalid ones absent', async () => {
	expectJson(await admin.get('/api/players'), 200, expectedPlayers());
});
await check('GET /api/players?active=1 -> only is_active=1, same order', async () => {
	const expected = expectedPlayers({ activeOnly: true });
	assert.ok(expected.length < model.players.size);
	expectJson(await admin.get('/api/players?active=1'), 200, expected);
});
await check('GET /api/players?active=true and ?active=0 -> no filter (only "1" filters)', async () => {
	expectJson(await admin.get('/api/players?active=true'), 200, expectedPlayers());
	expectJson(await admin.get('/api/players?active=0'), 200, expectedPlayers());
});

async function patchPlayer(id, patch, changes) {
	const res = await admin.patch(`/api/players/${encodeURIComponent(id)}`, patch);
	const expected = { ...model.players.get(id), ...changes };
	expectJson(res, 200, expected);
	model.players.set(id, expected);
}

await check('PATCH name (trimmed) + is_active -> 200 full player', async () => {
	await patchPlayer('p-bert', { name: '  Berta ', is_active: 1 }, { name: 'Berta', is_active: 1 });
});
await check('PATCH number only -> other fields unchanged', async () => {
	await patchPlayer('p-bert', { number: 8 }, { number: 8 });
});
await check('PATCH every position value', async () => {
	for (const position of POSITIONS) await patchPlayer('p-pos', { position }, { position });
});
await check('PATCH is_active 0', async () => {
	await patchPlayer('p-pos', { is_active: 0 }, { is_active: 0 });
});
await check('PATCH {} -> 200 unchanged player', async () => {
	await patchPlayer('p-bert', {}, {});
});
await check('PATCH ignores id/unknown keys (id cannot be changed)', async () => {
	await patchPlayer('p-bert', { id: 'hijacked', foo: 1 }, {});
	expectJson(await admin.patch('/api/players/hijacked', {}), 404, { error: 'not_found' });
});
await check('PATCH via percent-encoded id "p ü+1" (+ is not a space)', async () => {
	await patchPlayer('p ü+1', { number: 13 }, { number: 13 });
});
await check('[edge] PATCH number 1e2 (raw JSON) -> 100', async () => {
	const res = await admin.req('PATCH', '/api/players/p-float', { raw: '{"number":1e2}' });
	const expected = { ...model.players.get('p-float'), number: 100 };
	expectJson(res, 200, expected);
	model.players.set('p-float', expected);
});
await check('PATCH unknown id -> 404 not_found', async () => {
	expectError(await admin.patch('/api/players/nope', { name: 'X' }), 404, 'not_found');
});
await check('PATCH unknown id with {} -> 404 not_found', async () => {
	expectError(await admin.patch('/api/players/nope', {}), 404, 'not_found');
});
await check('[edge] PATCH unknown id with invalid body -> 400 (validation runs before lookup)', async () => {
	expectInvalid(await admin.patch('/api/players/nope', { number: 'x' }));
});
for (const [label, body] of [
	['name empty', { name: '' }],
	['name whitespace-only', { name: '  ' }],
	['name null', { name: null }],
	['number 1000', { number: 1000 }],
	['number "7"', { number: '7' }],
	['number 1.5', { number: 1.5 }],
	['number null', { number: null }],
	['position "XX"', { position: 'XX' }],
	['is_active 2', { is_active: 2 }],
	['is_active false', { is_active: false }]
]) {
	await check(`PATCH validation: ${label} -> 400 invalid`, async () => {
		expectInvalid(await admin.patch('/api/players/p-bert', body));
	});
}
await check('PATCH validation errors left players unchanged', async () => {
	expectJson(await admin.get('/api/players'), 200, expectedPlayers());
});
await check('GET /api/players/:id is not a route -> 404 not_found', async () => {
	expectError(await admin.get('/api/players/p-bert'), 404, 'not_found');
});
await check('DELETE unused player -> 204 empty body', async () => {
	expectNoContent(await admin.del('/api/players/p-extra'));
	model.players.delete('p-extra');
	expectJson(await admin.get('/api/players'), 200, expectedPlayers());
});
await check('DELETE same player again -> 404 not_found', async () => {
	expectError(await admin.del('/api/players/p-extra'), 404, 'not_found');
});
await check('DELETE missing player -> 404 not_found', async () => {
	expectError(await admin.del('/api/players/nope'), 404, 'not_found');
});

// ════════════════════════════════════════════════════════════════════
// Seasons
// ════════════════════════════════════════════════════════════════════

section('Seasons');

let newSeasonId = null;

await check('create with id and end_date, trimmed name -> 201 exact', async () => {
	const res = await admin.post('/api/seasons', { id: 's-2025', name: ' 2025/26 ', start_date: '2025-08-01', end_date: '2026-06-30' });
	const expected = { id: 's-2025', name: '2025/26', start_date: '2025-08-01', end_date: '2026-06-30' };
	expectJson(res, 201, expected);
	assert.ok(res.text.includes('2025/26'), `raw JSON should not escape "/" (JSON_UNESCAPED_SLASHES): ${res.text}`);
	model.seasons.set('s-2025', expected);
});
await check('create without id and end_date -> 201, UUID v4 id, end_date ""', async () => {
	const res = await admin.post('/api/seasons', { name: '2026/27', start_date: '2026-08-01' });
	expectStatus(res, 201);
	expectJsonType(res);
	assert.match(String(res.json.id), UUID_V4);
	newSeasonId = res.json.id;
	const expected = { id: newSeasonId, name: '2026/27', start_date: '2026-08-01', end_date: '' };
	assert.deepStrictEqual(res.json, expected);
	model.seasons.set(newSeasonId, expected);
});
await check('create with end_date "" and unknown keys -> 201', async () => {
	const expected = { id: 's-2024', name: '2024/25', start_date: '2024-08-01', end_date: '' };
	expectJson(await admin.post('/api/seasons', { ...expected, foo: 'bar' }), 201, expected);
	model.seasons.set('s-2024', expected);
});
await check('idempotent re-create with existing id -> 201 with the EXISTING row', async () => {
	expectJson(await admin.post('/api/seasons', { id: 's-2025', name: 'Changed', start_date: '2000-01-01', end_date: 'x' }), 201, model.seasons.get('s-2025'));
});
for (const [label, body] of [
	['name empty', { name: '', start_date: '2025-01-01' }],
	['name whitespace-only', { name: '   ', start_date: '2025-01-01' }],
	['name missing', { start_date: '2025-01-01' }],
	['name 101 chars', { name: 'n'.repeat(101), start_date: '2025-01-01' }],
	['start_date empty', { name: 'S', start_date: '' }],
	['start_date missing', { name: 'S' }],
	['start_date 41 chars', { name: 'S', start_date: 'd'.repeat(41) }],
	['start_date is a number', { name: 'S', start_date: 2025 }],
	['end_date 41 chars', { name: 'S', start_date: '2025-01-01', end_date: 'd'.repeat(41) }],
	['end_date null', { name: 'S', start_date: '2025-01-01', end_date: null }],
	['id empty', { id: '', name: 'S', start_date: '2025-01-01' }],
	['id 101 chars', { id: 'i'.repeat(101), name: 'S', start_date: '2025-01-01' }]
]) {
	await check(`create validation: ${label} -> 400 invalid`, async () => {
		expectInvalid(await admin.post('/api/seasons', body));
	});
}
await check('GET /api/seasons -> ordered by start_date (not insertion), invalid ones absent', async () => {
	expectJson(await admin.get('/api/seasons'), 200, expectedSeasons());
});
for (const [method, path] of [['GET', '/api/seasons/s-2025'], ['PATCH', '/api/seasons/s-2025'], ['DELETE', '/api/seasons/s-2025']]) {
	await check(`${method} ${path} is not a route -> 404 not_found`, async () => {
		expectError(await admin.req(method, path, method === 'PATCH' ? { json: { name: 'x' } } : {}), 404, 'not_found');
	});
}

// ════════════════════════════════════════════════════════════════════
// Games
// ════════════════════════════════════════════════════════════════════

section('Games');

function gameInput(overrides = {}) {
	return {
		id: 'g-x',
		season_id: 's-2025',
		date: '2025-10-01',
		opponent: 'Opp',
		is_home: true,
		location: '',
		status: 'setup',
		player_ids: [],
		...overrides
	};
}

async function createGame(input, expectedGame, roster) {
	const res = await admin.post('/api/games', input);
	expectJson(res, 201, { game: expectedGame });
	model.games.set(expectedGame.id, { game: { ...expectedGame }, seq: model.gameSeq++, roster: new Set(roster) });
	return res;
}

await check('create g-1 (trimmed opponent, notes default "", duplicate player_ids) -> 201 {game} with is_home true', async () => {
	const res = await createGame(
		{ id: 'g-1', season_id: 's-2025', date: '2025-09-01', opponent: '  TSV Example ', is_home: true, location: 'Halle 1/2', status: 'finished', player_ids: [annaId, 'p-bert', annaId, 'p-carl'] },
		{ id: 'g-1', season_id: 's-2025', date: '2025-09-01', opponent: 'TSV Example', is_home: true, location: 'Halle 1/2', notes: '', status: 'finished' },
		[annaId, 'p-bert', 'p-carl']
	);
	assert.ok(res.text.includes('Halle 1/2'), `raw JSON should not escape "/": ${res.text}`);
});
await check('create g-2 (is_home false, notes given, empty roster) -> is_home false', async () => {
	await createGame(
		{ id: 'g-2', season_id: 's-2025', date: '2025-09-15', opponent: 'HC Muster', is_home: false, location: '', notes: 'n', status: 'setup', player_ids: [] },
		{ id: 'g-2', season_id: 's-2025', date: '2025-09-15', opponent: 'HC Muster', is_home: false, location: '', notes: 'n', status: 'setup' },
		[]
	);
});
await check('create g-3 in other season with same date as g-2', async () => {
	await createGame(
		{ id: 'g-3', season_id: newSeasonId, date: '2025-09-15', opponent: 'SG Test', is_home: true, location: 'X', status: 'first_half', player_ids: ['p-dora'], extra: 1 },
		{ id: 'g-3', season_id: newSeasonId, date: '2025-09-15', opponent: 'SG Test', is_home: true, location: 'X', notes: '', status: 'first_half' },
		['p-dora']
	);
});
await check('create with unknown season -> 400 {error:"invalid", details:"unknown season_id"}', async () => {
	expectInvalid(await admin.post('/api/games', gameInput({ id: 'g-bad1', season_id: 'nope' })), 'unknown season_id');
});
await check('create with unknown player -> 400 {error:"invalid", details:"unknown player_ids"}', async () => {
	expectInvalid(await admin.post('/api/games', gameInput({ id: 'g-bad2', player_ids: ['p-carl', 'ghost'] })), 'unknown player_ids');
});
await check('create with unknown season AND unknown player -> season is checked first', async () => {
	expectInvalid(await admin.post('/api/games', gameInput({ id: 'g-bad3', season_id: 'nope', player_ids: ['ghost'] })), 'unknown season_id');
});
await check('create with duplicated unknown player -> still "unknown player_ids"', async () => {
	expectInvalid(await admin.post('/api/games', gameInput({ id: 'g-bad4', player_ids: ['ghost', 'ghost'] })), 'unknown player_ids');
});
for (const [label, overrides] of [
	['id missing', { id: undefined }],
	['id empty', { id: '' }],
	['id 101 chars', { id: 'g'.repeat(101) }],
	['season_id empty', { season_id: '' }],
	['season_id missing', { season_id: undefined }],
	['date empty', { date: '' }],
	['date 41 chars', { date: 'd'.repeat(41) }],
	['opponent whitespace-only', { opponent: '   ' }],
	['opponent 101 chars', { opponent: 'o'.repeat(101) }],
	['is_home "true" (string)', { is_home: 'true' }],
	['is_home 1 (number)', { is_home: 1 }],
	['is_home missing', { is_home: undefined }],
	['location missing', { location: undefined }],
	['location null', { location: null }],
	['location 201 chars', { location: 'l'.repeat(201) }],
	['notes 10001 chars', { notes: 'n'.repeat(10001) }],
	['notes null', { notes: null }],
	['status invalid', { status: 'bad' }],
	['status missing', { status: undefined }],
	['player_ids missing', { player_ids: undefined }],
	['player_ids is a string', { player_ids: 'p-carl' }],
	['player_ids contains ""', { player_ids: [''] }],
	['player_ids contains a number', { player_ids: [5] }],
	['player_ids 101 items', { player_ids: Array.from({ length: 101 }, (_, i) => `p${i}`) }]
]) {
	await check(`create validation: ${label} -> 400 invalid`, async () => {
		const body = gameInput({ id: 'g-invalid', ...overrides });
		for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
		expectInvalid(await admin.post('/api/games', body));
	});
}
await check('rejected creates did not create games', async () => {
	for (const id of ['g-bad1', 'g-bad2', 'g-bad3', 'g-bad4', 'g-invalid']) {
		expectError(await admin.get(`/api/games/${id}`), 404, 'not_found');
	}
});
await check('idempotent re-create g-1 with different data -> 201 {game} with the EXISTING game', async () => {
	const res = await admin.post('/api/games', gameInput({ id: 'g-1', opponent: 'Changed', is_home: false, status: 'setup', player_ids: [annaId] }));
	expectJson(res, 201, { game: model.games.get('g-1').game });
});
await check('re-create g-2 with new player_ids adds roster rows (INSERT OR IGNORE)', async () => {
	const res = await admin.post('/api/games', gameInput({ id: 'g-2', player_ids: ['p-dora'] }));
	expectJson(res, 201, { game: model.games.get('g-2').game });
	model.games.get('g-2').roster.add('p-dora');
	expectJson(await admin.get('/api/games/g-2'), 200, expectedDetail('g-2'));
});
await check('GET /api/games -> date DESC, then newest first; own_score/opp_score 0 as numbers', async () => {
	const expected = expectedGames();
	assert.deepStrictEqual(expected.map((g) => g.id), ['g-3', 'g-2', 'g-1']);
	expectJson(await admin.get('/api/games'), 200, expected);
});
await check('GET /api/games?season_id=s-2025', async () => {
	expectJson(await admin.get('/api/games?season_id=s-2025'), 200, expectedGames({ season_id: 's-2025' }));
});
await check('GET /api/games?status=setup', async () => {
	expectJson(await admin.get('/api/games?status=setup'), 200, expectedGames({ status: 'setup' }));
});
await check('GET /api/games?season_id=s-2025&status=finished', async () => {
	const expected = expectedGames({ season_id: 's-2025', status: 'finished' });
	assert.equal(expected.length, 1);
	expectJson(await admin.get('/api/games?season_id=s-2025&status=finished'), 200, expected);
});
await check('GET /api/games?season_id=nope -> []', async () => {
	expectJson(await admin.get('/api/games?season_id=nope'), 200, []);
});
await check('GET /api/games?season_id= (empty) -> no filter', async () => {
	expectJson(await admin.get('/api/games?season_id='), 200, expectedGames());
});
await check('GET /api/games?status=bad -> 400 invalid', async () => {
	expectInvalid(await admin.get('/api/games?status=bad'));
});
await check('[edge] GET /api/games?status= (empty) -> 400 invalid', async () => {
	expectInvalid(await admin.get('/api/games?status='));
});
await check('GET /api/games/g-1 -> {game, roster sorted by number/name, events: []}', async () => {
	const expected = expectedDetail('g-1');
	assert.deepStrictEqual(expected.roster.map((p) => p.id), ['p-carl', annaId, 'p-bert']);
	expectJson(await admin.get('/api/games/g-1'), 200, expected);
});
await check('GET /api/games/missing -> 404 not_found', async () => {
	expectError(await admin.get('/api/games/missing'), 404, 'not_found');
});

async function patchGame(id, patch, changes) {
	const res = await admin.patch(`/api/games/${id}`, patch);
	const expected = { ...model.games.get(id).game, ...changes };
	expectJson(res, 200, expected);
	model.games.get(id).game = expected;
}

await check('PATCH status -> 200 full game', async () => {
	await patchGame('g-2', { status: 'first_half' }, { status: 'first_half' });
});
await check('PATCH notes', async () => {
	await patchGame('g-2', { notes: 'Neue Notiz' }, { notes: 'Neue Notiz' });
});
await check('PATCH opponent (trimmed)', async () => {
	await patchGame('g-2', { opponent: '  HC Neu ' }, { opponent: 'HC Neu' });
});
await check('PATCH date', async () => {
	await patchGame('g-2', { date: '2025-09-20' }, { date: '2025-09-20' });
});
await check('PATCH location', async () => {
	await patchGame('g-2', { location: 'Sporthalle Süd' }, { location: 'Sporthalle Süd' });
});
await check('PATCH is_home true', async () => {
	await patchGame('g-2', { is_home: true }, { is_home: true });
});
await check('PATCH is_home false -> stored false (GET detail confirms)', async () => {
	await patchGame('g-2', { is_home: false }, { is_home: false });
	const res = await admin.get('/api/games/g-2');
	expectStatus(res, 200);
	assert.strictEqual(res.json.game.is_home, false);
});
await check('PATCH several fields at once (incl. empty notes/location)', async () => {
	await patchGame('g-2', { status: 'half_time', notes: '', location: '' }, { status: 'half_time', notes: '', location: '' });
});
await check('PATCH {} -> 200 unchanged', async () => {
	await patchGame('g-2', {}, {});
});
await check('PATCH ignores id, season_id and unknown keys', async () => {
	await patchGame('g-2', { id: 'g-hijack', season_id: 's-2024', foo: 1 }, {});
});
await check('PATCH missing game -> 404 not_found', async () => {
	expectError(await admin.patch('/api/games/missing', { status: 'finished' }), 404, 'not_found');
	expectError(await admin.patch('/api/games/missing', {}), 404, 'not_found');
});
for (const [label, body] of [
	['status bad', { status: 'bad' }],
	['opponent whitespace-only', { opponent: '  ' }],
	['opponent null', { opponent: null }],
	['is_home "false"', { is_home: 'false' }],
	['is_home 0', { is_home: 0 }],
	['notes null', { notes: null }],
	['date empty', { date: '' }],
	['location 201 chars', { location: 'l'.repeat(201) }]
]) {
	await check(`PATCH validation: ${label} -> 400 invalid`, async () => {
		expectInvalid(await admin.patch('/api/games/g-2', body));
	});
}
await check('games unchanged after rejected patches; list order follows patched date', async () => {
	const expected = expectedGames();
	assert.deepStrictEqual(expected.map((g) => g.id), ['g-2', 'g-3', 'g-1']);
	expectJson(await admin.get('/api/games'), 200, expected);
});
await check('DELETE player on a game roster -> 409 player_has_data', async () => {
	expectError(await admin.del('/api/players/p-bert'), 409, 'player_has_data');
	expectError(await admin.del('/api/players/p-dora'), 409, 'player_has_data');
	expectJson(await admin.get('/api/players'), 200, expectedPlayers());
});

// ════════════════════════════════════════════════════════════════════
// Events
// ════════════════════════════════════════════════════════════════════

section('Events');

function ev(overrides = {}) {
	return { id: 'e-x', player_id: annaId, timestamp: '2025-09-01T18:00:00.000Z', half: 1, event_type: 'goal', shot_zone: null, ...overrides };
}

const g1Batch = () => [
	{ id: 'e-1', player_id: annaId, timestamp: '2025-09-01T18:05:00.000Z', half: 1, event_type: 'goal', shot_zone: 'LW' },
	{ id: 'e-2', player_id: 'p-bert', timestamp: '2025-09-01T18:03:00.000Z', half: 1, event_type: 'goal_7m', shot_zone: null },
	{ id: 'e-3', player_id: null, timestamp: '2025-09-01T18:05:00.000Z', half: 1, event_type: 'opponent_goal', shot_zone: null },
	{ id: 'e-4', player_id: null, timestamp: '2025-09-01T18:40:00.000Z', half: 2, event_type: 'opponent_7m', shot_zone: null },
	{ id: 'e-5', player_id: 'p-carl', timestamp: '2025-09-01T18:41:00.000Z', half: 2, event_type: 'miss', shot_zone: 'RB' }
];

await check('POST events {events: []} -> 400 invalid', async () => {
	expectInvalid(await admin.post('/api/games/g-1/events', { events: [] }));
});
await check('POST events without "events" key -> 400 invalid', async () => {
	expectInvalid(await admin.post('/api/games/g-1/events', {}));
});
await check('POST events with "events" not an array -> 400 invalid', async () => {
	expectInvalid(await admin.post('/api/games/g-1/events', { events: ev() }));
});
await check('POST 201 events -> 400 invalid', async () => {
	const events = Array.from({ length: 201 }, (_, i) => ev({ id: `e-many-${i}`, player_id: null, event_type: 'tech_mistake' }));
	expectInvalid(await admin.post('/api/games/g-1/events', { events }));
});
for (const [label, overrides] of [
	['half 3', { half: 3 }],
	['half 0', { half: 0 }],
	['half "1" (string)', { half: '1' }],
	['half 1.5', { half: 1.5 }],
	['event_type unknown', { event_type: 'bad' }],
	['shot_zone "GK" (a position, not a shot zone)', { shot_zone: 'GK' }],
	['shot_zone ""', { shot_zone: '' }],
	['shot_zone key missing (nullable but required)', { shot_zone: undefined }],
	['player_id key missing (nullable but required)', { player_id: undefined }],
	['player_id ""', { player_id: '' }],
	['player_id is a number', { player_id: 5 }],
	['timestamp ""', { timestamp: '' }],
	['timestamp 41 chars', { timestamp: 't'.repeat(41) }],
	['timestamp null', { timestamp: null }],
	['id ""', { id: '' }],
	['id missing', { id: undefined }],
	['id 101 chars', { id: 'e'.repeat(101) }]
]) {
	await check(`POST events validation: ${label} -> 400 invalid`, async () => {
		const e = ev({ id: 'e-invalid', ...overrides });
		for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
		expectInvalid(await admin.post('/api/games/g-1/events', { events: [e] }));
	});
}
await check('POST events for player not on roster -> 400 {error:"invalid", details:"player not on game roster"}', async () => {
	expectInvalid(await admin.post('/api/games/g-1/events', { events: [ev({ id: 'e-off', player_id: 'p-dora' })] }), 'player not on game roster');
});
await check('POST events for unknown player id -> 400 "player not on game roster"', async () => {
	expectInvalid(await admin.post('/api/games/g-1/events', { events: [ev({ id: 'e-ghost', player_id: 'ghost' })] }), 'player not on game roster');
});
await check('mixed batch with one off-roster event -> 400 and nothing inserted', async () => {
	const res = await admin.post('/api/games/g-1/events', { events: [ev({ id: 'e-ok' }), ev({ id: 'e-off2', player_id: 'p-zed' })] });
	expectInvalid(res, 'player not on game roster');
	expectJson(await admin.get('/api/games/g-1'), 200, expectedDetail('g-1'));
});
await check('POST events to missing game -> 404 not_found', async () => {
	expectError(await admin.post('/api/games/missing/events', { events: [ev({ id: 'e-missing', player_id: null })] }), 404, 'not_found');
});
await check('[edge] POST invalid events to missing game -> 400 (validation runs before lookup)', async () => {
	expectInvalid(await admin.post('/api/games/missing/events', { events: [] }));
});
await check('POST valid batch (opponent events with player_id null) -> 201 {ids} in request order', async () => {
	const batch = g1Batch();
	expectJson(await admin.post('/api/games/g-1/events', { events: batch }), 201, { ids: ['e-1', 'e-2', 'e-3', 'e-4', 'e-5'] });
	addEvents(batch.map((e) => ({ ...e, game_id: 'g-1' })));
});
await check('re-POST the same batch -> 201 same ids, no duplicates', async () => {
	expectJson(await admin.post('/api/games/g-1/events', { events: g1Batch() }), 201, { ids: ['e-1', 'e-2', 'e-3', 'e-4', 'e-5'] });
	expectJson(await admin.get('/api/games/g-1'), 200, expectedDetail('g-1'));
});
await check('POST event with timestamp equal to existing ones -> ordered after them (insertion order)', async () => {
	const e6 = { id: 'e-6', player_id: 'p-carl', timestamp: '2025-09-01T18:05:00.000Z', half: 1, event_type: 'save', shot_zone: 'CB' };
	expectJson(await admin.post('/api/games/g-1/events', { events: [e6] }), 201, { ids: ['e-6'] });
	addEvents([{ ...e6, game_id: 'g-1' }]);
});
await check('GET /api/games/g-1 events ordered by timestamp, then insertion; event JSON shape exact', async () => {
	const expected = expectedDetail('g-1');
	assert.deepStrictEqual(expected.events.map((e) => e.id), ['e-2', 'e-1', 'e-3', 'e-6', 'e-4', 'e-5']);
	expectJson(await admin.get('/api/games/g-1'), 200, expected);
});

const g3Events = EVENT_TYPES.map((type, i) => ({
	id: `e3-${String(i).padStart(2, '0')}`,
	player_id: type.startsWith('opponent_') ? null : 'p-dora',
	timestamp: `2025-09-15T17:${String(10 + i).padStart(2, '0')}:00.000Z`,
	half: i < 7 ? 1 : 2,
	event_type: type,
	shot_zone: SHOT_ZONES[i % SHOT_ZONES.length]
}));
g3Events.push({ id: 'e3-extra-goal', player_id: 'p-dora', timestamp: '2025-09-15T17:59:00.000Z', half: 2, event_type: 'goal', shot_zone: null });

await check('POST every event type and shot zone to g-3 -> 201', async () => {
	expectJson(await admin.post('/api/games/g-3/events', { events: g3Events }), 201, { ids: g3Events.map((e) => e.id) });
	addEvents(g3Events.map((e) => ({ ...e, game_id: 'g-3' })));
});
await check('GET /api/games scores: goal+goal_7m count for us, opponent_goal+opponent_7m against (g-1 2:2, g-3 3:2, g-2 0:0)', async () => {
	const expected = expectedGames();
	const byId = Object.fromEntries(expected.map((g) => [g.id, [g.own_score, g.opp_score]]));
	assert.deepStrictEqual(byId, { 'g-1': [2, 2], 'g-2': [0, 0], 'g-3': [3, 2] });
	expectJson(await admin.get('/api/games'), 200, expected);
});
await check('GET /api/games/g-3 -> all events with exact shapes', async () => {
	expectJson(await admin.get('/api/games/g-3'), 200, expectedDetail('g-3'));
});
await check('GET /api/events -> all events across games ordered by timestamp, then insertion', async () => {
	expectJson(await admin.get('/api/events'), 200, expectedEventsWhere());
});
await check('GET /api/events?season_id=s-2025', async () => {
	const expected = expectedEventsWhere({ season_id: 's-2025' });
	assert.ok(expected.length > 0 && expected.every((e) => e.game_id === 'g-1'));
	expectJson(await admin.get('/api/events?season_id=s-2025'), 200, expected);
});
await check('GET /api/events?season_id=<generated season>', async () => {
	expectJson(await admin.get(`/api/events?season_id=${newSeasonId}`), 200, expectedEventsWhere({ season_id: newSeasonId }));
});
await check('GET /api/events?status=first_half (game status filter)', async () => {
	const expected = expectedEventsWhere({ status: 'first_half' });
	assert.ok(expected.length > 0 && expected.every((e) => e.game_id === 'g-3'));
	expectJson(await admin.get('/api/events?status=first_half'), 200, expected);
});
await check('GET /api/events?season_id=s-2025&status=finished', async () => {
	expectJson(await admin.get('/api/events?season_id=s-2025&status=finished'), 200, expectedEventsWhere({ season_id: 's-2025', status: 'finished' }));
});
await check('GET /api/events?season_id=s-2025&status=first_half -> []', async () => {
	expectJson(await admin.get('/api/events?season_id=s-2025&status=first_half'), 200, []);
});
await check('GET /api/events?status=bad -> 400 invalid', async () => {
	expectInvalid(await admin.get('/api/events?status=bad'));
});
await check('POST exactly 200 events -> 201 (upper bound)', async () => {
	const events = Array.from({ length: 200 }, (_, i) => ({ id: `bulk-${i}`, player_id: null, timestamp: `2025-09-20T10:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`, half: 1, event_type: 'tech_mistake', shot_zone: null }));
	expectJson(await admin.post('/api/games/g-2/events', { events }), 201, { ids: events.map((e) => e.id) });
	addEvents(events.map((e) => ({ ...e, game_id: 'g-2' })));
	expectJson(await admin.get('/api/games/g-2'), 200, expectedDetail('g-2'));
});
await check('DELETE events with exactly 200 ids -> 204 and removed', async () => {
	const ids = Array.from({ length: 200 }, (_, i) => `bulk-${i}`);
	expectNoContent(await admin.del(`/api/games/g-2/events?ids=${ids.join(',')}`));
	for (const id of ids) model.events.delete(id);
	expectJson(await admin.get('/api/games/g-2'), 200, expectedDetail('g-2'));
	assert.deepStrictEqual(expectedDetail('g-2').events, []);
});
await check('DELETE events with 201 ids -> 400 {error:"invalid", details:"too many ids"}', async () => {
	const ids = Array.from({ length: 201 }, (_, i) => `x-${i}`);
	expectInvalid(await admin.del(`/api/games/g-1/events?ids=${ids.join(',')}`), 'too many ids');
});
await check('DELETE events ?ids=e-1,,e-6,unknown -> 204, empty entries ignored, both removed', async () => {
	expectNoContent(await admin.del('/api/games/g-1/events?ids=e-1,,e-6,unknown'));
	model.events.delete('e-1');
	model.events.delete('e-6');
	expectJson(await admin.get('/api/games/g-1'), 200, expectedDetail('g-1'));
});
await check('score in list follows deleted events (g-1 now 1:2)', async () => {
	const expected = expectedGames();
	assert.deepStrictEqual(expected.find((g) => g.id === 'g-1').own_score, 1);
	expectJson(await admin.get('/api/games'), 200, expected);
});
await check('DELETE events is scoped to the game: ids of another game are not removed', async () => {
	expectNoContent(await admin.del('/api/games/g-1/events?ids=e3-00,e3-01'));
	expectJson(await admin.get('/api/games/g-3'), 200, expectedDetail('g-3'));
});
await check('DELETE events without ids parameter -> 204, nothing removed', async () => {
	expectNoContent(await admin.del('/api/games/g-1/events'));
	expectNoContent(await admin.del('/api/games/g-1/events?ids='));
	expectJson(await admin.get('/api/events'), 200, expectedEventsWhere());
});
await check('DELETE events of a missing game -> 204', async () => {
	expectNoContent(await admin.del('/api/games/missing/events?ids=e-2'));
	expectJson(await admin.get('/api/events'), 200, expectedEventsWhere());
});

// ════════════════════════════════════════════════════════════════════
// Game deletion
// ════════════════════════════════════════════════════════════════════

section('Game deletion');

await check('DELETE /api/games/g-1 -> 204 empty body', async () => {
	expectNoContent(await admin.del('/api/games/g-1'));
	model.games.delete('g-1');
	for (const [id, { event }] of model.events) if (event.game_id === 'g-1') model.events.delete(id);
});
await check('DELETE /api/games/g-1 again -> 204', async () => {
	expectNoContent(await admin.del('/api/games/g-1'));
});
await check('DELETE /api/games/never-existed -> 204', async () => {
	expectNoContent(await admin.del('/api/games/never-existed'));
});
await check('GET /api/games/g-1 after delete -> 404 not_found', async () => {
	expectError(await admin.get('/api/games/g-1'), 404, 'not_found');
});
await check('game list and /api/events no longer contain g-1 or its events', async () => {
	expectJson(await admin.get('/api/games'), 200, expectedGames());
	expectJson(await admin.get('/api/events'), 200, expectedEventsWhere());
});
await check('roster rows were deleted with the game: player only on g-1 can now be deleted (204)', async () => {
	expectNoContent(await admin.del('/api/players/p-bert'));
	model.players.delete('p-bert');
	expectJson(await admin.get('/api/players'), 200, expectedPlayers());
});
await check('POST events to deleted game -> 404 not_found', async () => {
	expectError(await admin.post('/api/games/g-1/events', { events: [ev({ id: 'e-late', player_id: null })] }), 404, 'not_found');
});
await check('PATCH deleted game -> 404 not_found', async () => {
	expectError(await admin.patch('/api/games/g-1', { status: 'finished' }), 404, 'not_found');
});

// ════════════════════════════════════════════════════════════════════
// Routing
// ════════════════════════════════════════════════════════════════════

section('Routing');

for (const [method, path] of [
	['GET', '/api/x'],
	['GET', '/api/players/p-carl/extra'],
	['PUT', '/api/players'],
	['DELETE', '/api/players'],
	['PATCH', '/api/players'],
	['POST', '/api/games/g-2'],
	['PUT', '/api/games/g-2'],
	['GET', '/api/games/g-2/events'],
	['PATCH', '/api/games/g-2/events'],
	['POST', '/api/events'],
	['DELETE', '/api/events'],
	['POST', '/api/health'],
	['POST', '/api/config'],
	['GET', '/api/auth/login'],
	['POST', '/api/auth/me'],
	['GET', '/api/auth/unknown']
]) {
	await check(`${method} ${path} (admin) -> 404 not_found`, async () => {
		const opts = ['POST', 'PUT', 'PATCH'].includes(method) ? { json: {} } : {};
		expectError(await admin.req(method, path, opts), 404, 'not_found');
	});
}
await check('[edge] GET /api/players/ (trailing slash) -> 404 not_found', async () => {
	expectError(await admin.get('/api/players/'), 404, 'not_found');
});
await check('[edge] GET /api/auth/login without session -> 401 (unmatched auth paths fall through to the auth guard)', async () => {
	expectError(await anon.get('/api/auth/login'), 401, 'unauthorized');
});
await check('unknown /api path without session -> 401 unauthorized (auth before 404)', async () => {
	expectError(await anon.get('/api/x'), 401, 'unauthorized');
});
await check('404 response carries security headers', async () => {
	const res = await admin.get('/api/x');
	expectStatus(res, 404);
	expectHeader(res, 'x-content-type-options', 'nosniff');
});

// ════════════════════════════════════════════════════════════════════
// Rate limiting (must run last: locks this IP out of login for 15 min)
// ════════════════════════════════════════════════════════════════════

section('Login rate limit');

if (args['skip-ratelimit']) {
	skip('login rate limit', '--skip-ratelimit');
} else {
	const rl = new Client('ratelimit');
	await check('successful login resets the failure counter (start clean)', async () => {
		expectNoContent(await rl.post('/api/auth/login', { password: ADMIN_PW }));
	});
	await check('invalid login bodies (400) do not count as failures', async () => {
		for (let i = 0; i < 3; i++) expectInvalid(await rl.post('/api/auth/login', { password: 1 }));
	});
	await check('4 wrong passwords -> 401 each', async () => {
		for (let i = 0; i < 4; i++) expectError(await rl.post('/api/auth/login', { password: `wrong-${i}` }), 401, 'invalid_password');
	});
	await check('correct password after 4 failures -> 204 (and resets the counter)', async () => {
		expectNoContent(await rl.post('/api/auth/login', { password: ADMIN_PW }));
	});
	await check('5 wrong passwords -> 401 each (counter was reset)', async () => {
		for (let i = 0; i < 5; i++) expectError(await rl.post('/api/auth/login', { password: `wrong-again-${i}` }), 401, 'invalid_password');
	});
	await check('6th attempt -> 429 {error:"rate_limited", retry_after:<int 1..900>} + Retry-After header', async () => {
		const res = await rl.post('/api/auth/login', { password: 'wrong-final' });
		expectStatus(res, 429);
		expectJsonType(res);
		assert.deepStrictEqual(Object.keys(res.json).sort(), ['error', 'retry_after']);
		assert.equal(res.json.error, 'rate_limited');
		const n = res.json.retry_after;
		assert.ok(Number.isInteger(n) && n >= 1 && n <= 900, `retry_after must be an integer in 1..900, got ${JSON.stringify(n)}`);
		expectHeader(res, 'retry-after', String(n));
	});
	await check('correct password while blocked -> still 429, no cookie', async () => {
		const c = new Client('blocked');
		const res = await c.post('/api/auth/login', { password: ADMIN_PW });
		expectStatus(res, 429);
		assert.equal(res.json?.error, 'rate_limited');
		assert.equal(res.setCookies.length, 0);
	});
	await check('existing sessions keep working while login is blocked', async () => {
		expectJson(await admin.get('/api/auth/me'), 200, { role: 'admin' });
		expectJson(await rl.get('/api/auth/me'), 200, { role: 'admin' });
	});
}

// ── Summary ──

const passed = results.filter((r) => r.status === 'pass').length;
const failed = results.filter((r) => r.status === 'fail');
const skipped = results.filter((r) => r.status === 'skip').length;

console.log('\n' + '─'.repeat(60));
if (failed.length) {
	console.log('Failures:');
	for (const f of failed) console.log(`  - [${f.section}] ${f.name}`);
	console.log('─'.repeat(60));
}
console.log(`${failed.length ? 'FAILED' : 'PASSED'}: ${passed} passed, ${failed.length} failed, ${skipped} skipped (${results.length} checks) against ${BASE}`);
process.exit(failed.length ? 1 : 0);
