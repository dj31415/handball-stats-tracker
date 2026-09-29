// ── Enums ──

export const POSITIONS = ['LW', 'LB', 'CB', 'RB', 'RW', 'PV', 'GK'] as const;
export type Position = (typeof POSITIONS)[number];

export const SHOT_ZONES = ['LW', 'PV', 'RW', 'LB', 'CB', 'RB'] as const;
export type ShotZone = (typeof SHOT_ZONES)[number];

export const EVENT_TYPES = [
	'goal',
	'miss',
	'goal_7m',
	'miss_7m',
	'tech_mistake',
	'suspension_2min',
	'yellow_card',
	'red_card',
	'save',
	'save_7m',
	'conceded',
	'conceded_7m',
	'opponent_goal',
	'opponent_7m'
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const GAME_STATUSES = ['setup', 'first_half', 'half_time', 'second_half', 'finished'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const HALVES = [1, 2] as const;
export type Half = (typeof HALVES)[number];

// ── Entities ──

export interface Player {
	id: string;
	name: string;
	number: number;
	position: Position;
	is_active: number;
}

export interface Season {
	id: string;
	name: string;
	start_date: string;
	end_date: string;
}

export interface Game {
	id: string;
	season_id: string;
	date: string;
	opponent: string;
	is_home: boolean;
	location: string;
	notes: string;
	status: GameStatus;
}

export interface GameRoster {
	game_id: string;
	player_id: string;
}

export interface GameEvent {
	id: string;
	game_id: string;
	player_id: string | null;
	timestamp: string;
	half: Half;
	event_type: EventType;
	shot_zone: ShotZone | null;
}

// ── Helpers ──

export const THROW_EVENTS: EventType[] = ['goal', 'miss'];
export const SEVEN_M_EVENTS: EventType[] = ['goal_7m', 'miss_7m'];
export const GOALIE_EVENTS: EventType[] = ['save', 'save_7m', 'conceded', 'conceded_7m'];
export const OPPONENT_EVENTS: EventType[] = ['opponent_goal', 'opponent_7m'];
export const CARD_EVENTS: EventType[] = ['yellow_card', 'red_card'];

export function isGoaliePosition(position: Position): boolean {
	return position === 'GK';
}

// ── API ──

export const ROLES = ['admin', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export interface PublicConfig {
	club_name: string;
}

export interface ApiErrorBody {
	error: string;
	details?: unknown;
	retry_after?: number;
}

export interface GameListItem extends Game {
	own_score: number;
	opp_score: number;
}

export interface GameDetail {
	game: Game;
	roster: Player[];
	events: GameEvent[];
}

export interface PlayerInput {
	id?: string;
	name: string;
	number: number;
	position: Position;
	is_active?: number;
}

export interface PlayerPatch {
	name?: string;
	number?: number;
	position?: Position;
	is_active?: number;
}

export interface SeasonInput {
	id?: string;
	name: string;
	start_date: string;
	end_date?: string;
}

export interface NewGameEventInput {
	id: string;
	player_id: string | null;
	timestamp: string;
	half: Half;
	event_type: EventType;
	shot_zone: ShotZone | null;
}

export interface CreateGameInput {
	id: string;
	season_id: string;
	date: string;
	opponent: string;
	is_home: boolean;
	location: string;
	notes?: string;
	status: GameStatus;
	player_ids: string[];
}

export interface GamePatch {
	status?: GameStatus;
	notes?: string;
	opponent?: string;
	date?: string;
	location?: string;
	is_home?: boolean;
}

// ── Stats (computed, never stored) ──

export interface PlayerGameStats {
	player_id: string;
	goals: number;
	misses: number;
	goals_7m: number;
	misses_7m: number;
	tech_mistakes: number;
	suspensions_2min: number;
	yellow_cards: number;
	red_cards: number;
	// goalie-specific
	saves: number;
	saves_7m: number;
	conceded: number;
	conceded_7m: number;
}

export function emptyPlayerGameStats(player_id: string): PlayerGameStats {
	return {
		player_id,
		goals: 0,
		misses: 0,
		goals_7m: 0,
		misses_7m: 0,
		tech_mistakes: 0,
		suspensions_2min: 0,
		yellow_cards: 0,
		red_cards: 0,
		saves: 0,
		saves_7m: 0,
		conceded: 0,
		conceded_7m: 0
	};
}

export function computePlayerStats(events: GameEvent[], playerId: string): PlayerGameStats {
	const stats = emptyPlayerGameStats(playerId);
	for (const e of events) {
		if (e.player_id !== playerId) continue;
		switch (e.event_type) {
			case 'goal': stats.goals++; break;
			case 'miss': stats.misses++; break;
			case 'goal_7m': stats.goals_7m++; break;
			case 'miss_7m': stats.misses_7m++; break;
			case 'tech_mistake': stats.tech_mistakes++; break;
			case 'suspension_2min': stats.suspensions_2min++; break;
			case 'yellow_card': stats.yellow_cards++; break;
			case 'red_card': stats.red_cards++; break;
			case 'save': stats.saves++; break;
			case 'save_7m': stats.saves_7m++; break;
			case 'conceded': stats.conceded++; break;
			case 'conceded_7m': stats.conceded_7m++; break;
		}
	}
	return stats;
}

export function throwSuccessRate(stats: PlayerGameStats): number | null {
	const total = stats.goals + stats.misses + stats.goals_7m + stats.misses_7m;
	if (total === 0) return null;
	return (stats.goals + stats.goals_7m) / total;
}

export function fieldThrowRate(stats: PlayerGameStats): number | null {
	const total = stats.goals + stats.misses;
	if (total === 0) return null;
	return stats.goals / total;
}

export function sevenMRate(stats: PlayerGameStats): number | null {
	const total = stats.goals_7m + stats.misses_7m;
	if (total === 0) return null;
	return stats.goals_7m / total;
}

export function saveRate(stats: PlayerGameStats): number | null {
	const total = stats.saves + stats.conceded;
	if (total === 0) return null;
	return stats.saves / total;
}

export function saveRate7m(stats: PlayerGameStats): number | null {
	const total = stats.saves_7m + stats.conceded_7m;
	if (total === 0) return null;
	return stats.saves_7m / total;
}

export function overallSaveRate(stats: PlayerGameStats): number | null {
	const totalSaves = stats.saves + stats.saves_7m;
	const totalConceded = stats.conceded + stats.conceded_7m;
	const total = totalSaves + totalConceded;
	if (total === 0) return null;
	return totalSaves / total;
}

export function teamScore(events: GameEvent[]): number {
	return events.filter(e => e.event_type === 'goal' || e.event_type === 'goal_7m').length;
}

export function opponentScore(events: GameEvent[]): number {
	return events.filter(e => e.event_type === 'opponent_goal' || e.event_type === 'opponent_7m').length;
}
