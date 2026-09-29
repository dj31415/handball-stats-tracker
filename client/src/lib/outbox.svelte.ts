import type { GameDetail, GamePatch, NewGameEventInput } from '@shared/types';
import { api, ApiError, isRetryable } from '$lib/api';

/**
 * Persistent, ordered queue of write operations for the live game page.
 * Operations are idempotent on the server (client-generated event ids), so they can be
 * retried safely. Operations are sent one at a time, in order.
 */
export type OutboxOp =
	| { kind: 'addEvents'; gameId: string; events: NewGameEventInput[] }
	| { kind: 'deleteEvents'; gameId: string; ids: string[] }
	| { kind: 'updateGame'; gameId: string; patch: GamePatch };

const STORAGE_KEY = 'handball_outbox_v1';
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

function load(): OutboxOp[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function persist(ops: OutboxOp[]) {
	try {
		if (ops.length === 0) localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, JSON.stringify(ops));
	} catch {
		/* storage unavailable: keep working in memory */
	}
}

class Outbox {
	ops = $state<OutboxOp[]>([]);
	retrying = $state(false);
	/** Session expired (401): the queue is kept and paused until the user logs in again. */
	sessionExpired = $state(false);
	/** Set when an operation was rejected permanently (4xx) and dropped. */
	lastError = $state<string | null>(null);

	private sending = false;
	private attempt = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private started = false;

	get pending(): number {
		return this.ops.reduce((n, op) => n + (op.kind === 'addEvents' ? op.events.length : op.kind === 'deleteEvents' ? op.ids.length : 1), 0);
	}

	/** Load persisted operations and hook up retry triggers. Call once on app start. */
	start() {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;
		this.ops = load();
		window.addEventListener('online', () => this.kick());
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') this.kick();
		});
		window.addEventListener('beforeunload', (e) => {
			if (this.ops.length > 0) e.preventDefault();
		});
		this.kick();
	}

	enqueue(op: OutboxOp) {
		this.ops = [...this.ops, op];
		persist(this.ops);
		void this.flush();
	}

	/** Clear the paused state (e.g. after logging in again) and try to send. */
	resume() {
		this.sessionExpired = false;
		this.lastError = null;
		this.kick();
	}

	dismissError() {
		this.lastError = null;
	}

	/** Retry now (cancels a pending backoff timer). */
	kick() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.attempt = 0;
		void this.flush();
	}

	/** Resolves true once the queue is empty, false if it still has entries after timeoutMs. */
	async whenIdle(timeoutMs: number): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (this.ops.length > 0 && Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 100));
		}
		return this.ops.length === 0;
	}

	/** Apply queued operations for one game on top of data loaded from the server. */
	applyTo(detail: GameDetail): GameDetail {
		let events = [...detail.events];
		let game = { ...detail.game };
		for (const op of this.ops) {
			if (op.gameId !== game.id) continue;
			if (op.kind === 'addEvents') {
				const known = new Set(events.map((e) => e.id));
				for (const e of op.events) {
					if (!known.has(e.id)) events.push({ ...e, game_id: game.id });
				}
			} else if (op.kind === 'deleteEvents') {
				const del = new Set(op.ids);
				events = events.filter((e) => !del.has(e.id));
			} else {
				game = { ...game, ...op.patch };
			}
		}
		return { ...detail, game, events };
	}

	private async send(op: OutboxOp) {
		const opts = { redirectOn401: false };
		if (op.kind === 'addEvents') await api.events.add(op.gameId, op.events, opts);
		else if (op.kind === 'deleteEvents') await api.events.remove(op.gameId, op.ids, opts);
		else await api.games.update(op.gameId, op.patch, opts);
	}

	private async flush() {
		if (this.sending || this.sessionExpired || this.timer) return;
		this.sending = true;
		try {
			while (this.ops.length > 0 && !this.sessionExpired) {
				const op = this.ops[0];
				try {
					await this.send(op);
				} catch (e) {
					if (e instanceof ApiError && e.status === 401) {
						this.sessionExpired = true;
						this.retrying = false;
						return;
					}
					if (isRetryable(e)) {
						this.retrying = true;
						const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
						this.attempt++;
						this.timer = setTimeout(() => {
							this.timer = null;
							void this.flush();
						}, delay);
						return;
					}
					// Permanent rejection: drop the operation so it cannot block the queue forever.
					this.lastError = e instanceof ApiError ? e.code : 'unknown';
					console.error('Outbox: dropping rejected operation', op, e);
				}
				this.ops = this.ops.slice(1);
				persist(this.ops);
				this.retrying = false;
				this.attempt = 0;
			}
		} finally {
			this.sending = false;
		}
	}
}

export const outbox = new Outbox();
