import { goto } from '$app/navigation';
import type {
	ApiErrorBody,
	CreateGameInput,
	GameDetail,
	GameListItem,
	GamePatch,
	GameStatus,
	Game,
	GameEvent,
	NewGameEventInput,
	Player,
	PlayerInput,
	PlayerPatch,
	PublicConfig,
	Role,
	Season,
	SeasonInput
} from '@shared/types';

export class ApiError extends Error {
	constructor(
		public status: number,
		public code: string,
		public body: ApiErrorBody | null
	) {
		super(`API error ${status}: ${code}`);
	}
}

export interface RequestOptions {
	timeoutMs?: number;
	/** Redirect to the login page on 401 (default true). */
	redirectOn401?: boolean;
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
	const { timeoutMs = 8000, redirectOn401 = true } = opts;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let res: Response;
	try {
		res = await fetch(path, {
			method,
			credentials: 'same-origin',
			headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
			body: body !== undefined ? JSON.stringify(body) : undefined,
			signal: controller.signal
		});
	} finally {
		clearTimeout(timer);
	}

	if (res.status === 204) return undefined as T;

	let parsed: unknown = null;
	try {
		parsed = await res.json();
	} catch {
		/* non-JSON body */
	}

	if (!res.ok) {
		const errBody = (parsed && typeof parsed === 'object' ? parsed : null) as ApiErrorBody | null;
		const code = errBody?.error ?? `http_${res.status}`;
		if (res.status === 401 && redirectOn401 && !path.startsWith('/api/auth/')) {
			const here = location.pathname + location.search;
			if (!location.pathname.startsWith('/login')) {
				void goto(`/login?next=${encodeURIComponent(here)}`);
			}
		}
		throw new ApiError(res.status, code, errBody);
	}
	return parsed as T;
}

/** True for failures that are worth retrying (network problems, timeouts, server trouble). */
export function isRetryable(e: unknown): boolean {
	if (e instanceof ApiError) return e.status >= 500 || e.status === 408 || e.status === 429;
	return e instanceof TypeError || (e instanceof DOMException && e.name === 'AbortError');
}

function query(params: Record<string, string | undefined>): string {
	const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
	return entries.length ? '?' + new URLSearchParams(entries).toString() : '';
}

export const api = {
	config: () => request<PublicConfig>('GET', '/api/config'),
	auth: {
		login: (password: string) => request<void>('POST', '/api/auth/login', { password }),
		logout: () => request<void>('POST', '/api/auth/logout'),
		me: () => request<{ role: Role }>('GET', '/api/auth/me')
	},
	players: {
		list: (opts: { active?: boolean } = {}) =>
			request<Player[]>('GET', '/api/players' + query({ active: opts.active ? '1' : undefined })),
		create: (input: PlayerInput) => request<Player>('POST', '/api/players', input),
		update: (id: string, patch: PlayerPatch) => request<Player>('PATCH', `/api/players/${id}`, patch),
		remove: (id: string) => request<void>('DELETE', `/api/players/${id}`)
	},
	seasons: {
		list: () => request<Season[]>('GET', '/api/seasons'),
		create: (input: SeasonInput) => request<Season>('POST', '/api/seasons', input)
	},
	games: {
		list: (opts: { season_id?: string; status?: GameStatus } = {}) =>
			request<GameListItem[]>('GET', '/api/games' + query(opts)),
		get: (id: string) => request<GameDetail>('GET', `/api/games/${id}`),
		create: (input: CreateGameInput) => request<{ game: Game }>('POST', '/api/games', input),
		update: (id: string, patch: GamePatch, opts?: RequestOptions) =>
			request<Game>('PATCH', `/api/games/${id}`, patch, opts),
		remove: (id: string) => request<void>('DELETE', `/api/games/${id}`)
	},
	events: {
		list: (opts: { season_id?: string; status?: GameStatus } = {}) =>
			request<GameEvent[]>('GET', '/api/events' + query(opts)),
		add: (gameId: string, events: NewGameEventInput[], opts?: RequestOptions) =>
			request<{ ids: string[] }>('POST', `/api/games/${gameId}/events`, { events }, opts),
		remove: (gameId: string, ids: string[], opts?: RequestOptions) =>
			request<void>('DELETE', `/api/games/${gameId}/events?ids=${ids.map(encodeURIComponent).join(',')}`, undefined, opts)
	}
};

/** Group a flat event list by game id. */
export function groupEventsByGame(events: GameEvent[]): Map<string, GameEvent[]> {
	const map = new Map<string, GameEvent[]>();
	for (const e of events) {
		const list = map.get(e.game_id);
		if (list) list.push(e);
		else map.set(e.game_id, [e]);
	}
	return map;
}

/** True when the request never got an HTTP response (offline, timeout, DNS, ...). */
export function isNetworkError(e: unknown): boolean {
	return !(e instanceof ApiError);
}
