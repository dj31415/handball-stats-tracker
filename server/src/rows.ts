import type { Row } from '@libsql/client';
import type { Game, GameEvent, GameListItem, Player, Season } from '../../shared/types.js';

// Map DB rows to the shared API types (is_home is stored as 0/1).

export function toPlayer(r: Row): Player {
	return {
		id: r.id as string,
		name: r.name as string,
		number: Number(r.number),
		position: r.position as Player['position'],
		is_active: Number(r.is_active)
	};
}

export function toSeason(r: Row): Season {
	return {
		id: r.id as string,
		name: r.name as string,
		start_date: r.start_date as string,
		end_date: r.end_date as string
	};
}

export function toGame(r: Row): Game {
	return {
		id: r.id as string,
		season_id: r.season_id as string,
		date: r.date as string,
		opponent: r.opponent as string,
		is_home: Boolean(r.is_home),
		location: r.location as string,
		notes: r.notes as string,
		status: r.status as Game['status']
	};
}

export function toGameListItem(r: Row): GameListItem {
	return { ...toGame(r), own_score: Number(r.own_score), opp_score: Number(r.opp_score) };
}

export function toEvent(r: Row): GameEvent {
	return {
		id: r.id as string,
		game_id: r.game_id as string,
		player_id: (r.player_id as string | null) ?? null,
		timestamp: r.timestamp as string,
		half: Number(r.half) as GameEvent['half'],
		event_type: r.event_type as GameEvent['event_type'],
		shot_zone: (r.shot_zone as GameEvent['shot_zone']) ?? null
	};
}
