import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Role } from '../../shared/types.js';
import { config } from './config.js';

type Env = { Variables: { role: Role } };

const COOKIE_NAME = 'session';
const COOKIE_PREFIX = config.COOKIE_SECURE ? 'host' : undefined;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const RENEW_AFTER_SECONDS = 24 * 60 * 60;

// ── Passwords ──

function sha256(value: string): Buffer {
	return createHash('sha256').update(value).digest();
}

function passwordMatches(input: string, password: string): boolean {
	return timingSafeEqual(sha256(input), sha256(password));
}

function passwordFor(role: Role): string {
	return role === 'admin' ? config.APP_PASSWORD : config.VIEWER_PASSWORD;
}

/** Returns the role a password grants, or null. */
export function checkPassword(input: string): Role | null {
	const isAdmin = passwordMatches(input, config.APP_PASSWORD);
	const isViewer = config.VIEWER_PASSWORD !== '' && passwordMatches(input, config.VIEWER_PASSWORD);
	if (isAdmin) return 'admin';
	if (isViewer) return 'viewer';
	return null;
}

// ── Session cookie ──

// Changing a role's password changes its tag and thereby invalidates its sessions.
function passwordTag(role: Role): string {
	return createHmac('sha256', config.SESSION_SECRET)
		.update(`pw:${role}:${passwordFor(role)}`)
		.digest('hex')
		.slice(0, 16);
}

function now(): number {
	return Math.floor(Date.now() / 1000);
}

export async function issueSession(c: Context, role: Role) {
	const exp = now() + SESSION_SECONDS;
	await setSignedCookie(c, COOKIE_NAME, `v1.${role}.${exp}.${passwordTag(role)}`, config.SESSION_SECRET, {
		httpOnly: true,
		secure: config.COOKIE_SECURE,
		sameSite: 'Strict',
		path: '/',
		maxAge: SESSION_SECONDS,
		prefix: COOKIE_PREFIX
	});
}

export function clearSession(c: Context) {
	deleteCookie(c, COOKIE_NAME, {
		path: '/',
		secure: config.COOKIE_SECURE,
		prefix: COOKIE_PREFIX
	});
}

/** Validates the session cookie and renews it when older than a day. */
export async function getSession(c: Context): Promise<Role | null> {
	const value = await getSignedCookie(c, config.SESSION_SECRET, COOKIE_NAME, COOKIE_PREFIX);
	if (!value) return null;
	const [version, role, exp, tag] = value.split('.');
	if (version !== 'v1' || (role !== 'admin' && role !== 'viewer')) return null;
	const expiresAt = parseInt(exp);
	if (!Number.isFinite(expiresAt) || expiresAt <= now()) return null;
	const expected = passwordTag(role);
	if (!tag || tag.length !== expected.length || !timingSafeEqual(Buffer.from(tag), Buffer.from(expected))) {
		return null;
	}
	if (SESSION_SECONDS - (expiresAt - now()) > RENEW_AFTER_SECONDS) {
		await issueSession(c, role);
	}
	return role;
}

export const requireAuth = createMiddleware<Env>(async (c, next) => {
	const role = await getSession(c);
	if (!role) return c.json({ error: 'unauthorized' }, 401);
	c.set('role', role);
	await next();
});

/** Viewers may only read. */
export const requireAdminForWrites = createMiddleware<Env>(async (c, next) => {
	const method = c.req.method;
	if (method !== 'GET' && method !== 'HEAD' && c.get('role') !== 'admin') {
		return c.json({ error: 'forbidden' }, 403);
	}
	await next();
});

// ── Login rate limiting (in memory) ──

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IP = 5;
const MAX_FAILURES_GLOBAL = 30;

interface Bucket {
	count: number;
	resetAt: number;
}

const ipFailures = new Map<string, Bucket>();
const globalFailures: Bucket = { count: 0, resetAt: 0 };

setInterval(() => {
	const t = Date.now();
	for (const [ip, b] of ipFailures) if (b.resetAt <= t) ipFailures.delete(ip);
}, 60 * 1000).unref();

export function clientIp(c: Context): string {
	if (config.TRUST_PROXY) {
		const forwarded = c.req.header('x-forwarded-for');
		if (forwarded) {
			const last = forwarded.split(',').pop()?.trim();
			if (last) return last;
		}
	}
	try {
		return getConnInfo(c).remote.address ?? 'unknown';
	} catch {
		return 'unknown';
	}
}

/** Seconds until login is allowed again, or 0 if allowed. */
export function loginRetryAfter(ip: string): number {
	const t = Date.now();
	let until = 0;
	const b = ipFailures.get(ip);
	if (b && b.resetAt > t && b.count >= MAX_FAILURES_PER_IP) until = b.resetAt;
	if (globalFailures.resetAt > t && globalFailures.count >= MAX_FAILURES_GLOBAL) {
		until = Math.max(until, globalFailures.resetAt);
	}
	return until ? Math.ceil((until - t) / 1000) : 0;
}

export function recordLoginFailure(ip: string) {
	const t = Date.now();
	let b = ipFailures.get(ip);
	if (!b || b.resetAt <= t) {
		b = { count: 0, resetAt: t + WINDOW_MS };
		ipFailures.set(ip, b);
	}
	b.count++;
	if (globalFailures.resetAt <= t) {
		globalFailures.count = 0;
		globalFailures.resetAt = t + WINDOW_MS;
	}
	globalFailures.count++;
}

export function resetLoginFailures(ip: string) {
	ipFailures.delete(ip);
}
