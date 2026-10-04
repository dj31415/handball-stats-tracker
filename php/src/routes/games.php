<?php

declare(strict_types=1);

// /api/games and /api/games/:id/events. Mirrors server/src/routes/games.ts.

namespace Handball;

\defined('HANDBALL_APP') || exit;

/** @return array<string, mixed>|null */
function find_game(string $id): ?array
{
	$row = Db::one('SELECT * FROM games WHERE id = ?', [$id]);
	return $row === null ? null : Db::toGame($row);
}

return static function (Router $r): void {
	$r->get('/api/games', static function (Request $req): Response {
		$v = Validator::query($req);
		$seasonId = $v->string('season_id', optional: true);
		$status = $v->enum('status', GAME_STATUSES, optional: true);
		$v->check();

		$where = [];
		$args = [];
		if ($seasonId !== null && $seasonId !== '') {
			$where[] = 'g.season_id = ?';
			$args[] = $seasonId;
		}
		if ($status !== null) {
			$where[] = 'g.status = ?';
			$args[] = $status;
		}
		$rows = Db::all(
			"SELECT g.*,
			   COALESCE(SUM(e.event_type IN ('goal', 'goal_7m')), 0) AS own_score,
			   COALESCE(SUM(e.event_type IN ('opponent_goal', 'opponent_7m')), 0) AS opp_score
			 FROM games g LEFT JOIN game_events e ON e.game_id = g.id "
			. ($where !== [] ? 'WHERE ' . implode(' AND ', $where) . ' ' : '')
			. 'GROUP BY g.id ORDER BY g.date DESC, g.rowid DESC',
			$args
		);
		return Response::json(Db::mapRows($rows, Db::toGameListItem(...)));
	});

	$r->get('/api/games/:id', static function (Request $req, array $params): Response {
		$id = $params['id'];
		$game = find_game($id);
		if ($game === null) {
			return Response::error(404, 'not_found');
		}
		$events = Db::all('SELECT * FROM game_events WHERE game_id = ? ORDER BY timestamp, rowid', [$id]);
		$roster = Db::all(
			'SELECT p.* FROM players p
			 JOIN game_rosters gr ON gr.player_id = p.id
			 WHERE gr.game_id = ? ORDER BY p.number, p.name',
			[$id]
		);
		return Response::json([
			'game' => $game,
			'roster' => Db::mapRows($roster, Db::toPlayer(...)),
			'events' => Db::mapRows($events, Db::toEvent(...)),
		]);
	});

	$r->post('/api/games', static function (Request $req): Response {
		$v = Validator::jsonBody($req);
		$id = (string) $v->string('id', 1, 100);
		$seasonId = (string) $v->string('season_id', 1, 100);
		$date = $v->string('date', 1, 40);
		$opponent = $v->string('opponent', 1, 100, trim: true);
		$isHome = $v->bool('is_home');
		$location = $v->string('location', 0, 200);
		$notes = $v->string('notes', 0, 10000, optional: true);
		$status = $v->enum('status', GAME_STATUSES);
		$playerIds = $v->list(
			'player_ids',
			0,
			100,
			static fn (mixed $value, array $path): ?string => $v->checkString($value, $path, 1, 100)
		);
		$v->check();

		if (Db::one('SELECT 1 FROM seasons WHERE id = ?', [$seasonId]) === null) {
			return Response::error(400, 'invalid', ['details' => 'unknown season_id']);
		}
		/** @var list<string> $playerIds */
		$playerIds = array_values(array_unique((array) $playerIds));
		if ($playerIds !== []) {
			$known = Db::all('SELECT id FROM players WHERE id IN (' . placeholders(\count($playerIds)) . ')', $playerIds);
			if (\count($known) !== \count($playerIds)) {
				return Response::error(400, 'invalid', ['details' => 'unknown player_ids']);
			}
		}

		Db::transaction(static function () use ($id, $seasonId, $date, $opponent, $isHome, $location, $notes, $status, $playerIds): void {
			Db::run(
				'INSERT OR IGNORE INTO games (id, season_id, date, opponent, is_home, location, notes, status)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
				[$id, $seasonId, $date, $opponent, $isHome ? 1 : 0, $location, $notes ?? '', $status]
			);
			foreach ($playerIds as $playerId) {
				Db::run('INSERT OR IGNORE INTO game_rosters (game_id, player_id) VALUES (?, ?)', [$id, $playerId]);
			}
		});
		return Response::json(['game' => find_game($id)], 201);
	});

	$r->patch('/api/games/:id', static function (Request $req, array $params): Response {
		$id = $params['id'];
		$v = Validator::jsonBody($req);
		$isHome = $v->bool('is_home', optional: true);
		$patch = [
			'status' => $v->enum('status', GAME_STATUSES, optional: true),
			'notes' => $v->string('notes', 0, 10000, optional: true),
			'opponent' => $v->string('opponent', 1, 100, trim: true, optional: true),
			'date' => $v->string('date', 1, 40, optional: true),
			'location' => $v->string('location', 0, 200, optional: true),
			'is_home' => $isHome === null ? null : ($isHome ? 1 : 0),
		];
		$v->check();

		$sets = [];
		$args = [];
		foreach ($patch as $key => $value) {
			if ($value !== null) {
				$sets[] = "$key = ?";
				$args[] = $value;
			}
		}
		if ($sets !== []) {
			Db::run('UPDATE games SET ' . implode(', ', $sets) . ' WHERE id = ?', [...$args, $id]);
		}
		$game = find_game($id);
		if ($game === null) {
			return Response::error(404, 'not_found');
		}
		return Response::json($game);
	});

	$r->delete('/api/games/:id', static function (Request $req, array $params): Response {
		$id = $params['id'];
		Db::transaction(static function () use ($id): void {
			Db::run('DELETE FROM game_events WHERE game_id = ?', [$id]);
			Db::run('DELETE FROM game_rosters WHERE game_id = ?', [$id]);
			Db::run('DELETE FROM games WHERE id = ?', [$id]);
		});
		return Response::noContent();
	});

	$r->post('/api/games/:id/events', static function (Request $req, array $params): Response {
		$gameId = $params['id'];
		$v = Validator::jsonBody($req);
		$events = $v->list('events', 1, 200, static function (mixed $value, array $path) use ($v): array {
			$e = $v->nested($value, $path);
			return [
				'id' => $e->string('id', 1, 100),
				'player_id' => $e->string('player_id', 1, 100, nullable: true),
				'timestamp' => $e->string('timestamp', 1, 40),
				'half' => $e->literal('half', HALVES),
				'event_type' => $e->enum('event_type', EVENT_TYPES),
				'shot_zone' => $e->enum('shot_zone', SHOT_ZONES, nullable: true),
			];
		});
		$v->check();
		/** @var list<array{id: string, player_id: ?string, timestamp: string, half: int, event_type: string, shot_zone: ?string}> $events */
		$events = (array) $events;

		if (find_game($gameId) === null) {
			return Response::error(404, 'not_found');
		}

		// Players must be on this game's roster (opponent events have no player).
		$roster = [];
		foreach (Db::all('SELECT player_id FROM game_rosters WHERE game_id = ?', [$gameId]) as $row) {
			$roster[(string) $row['player_id']] = true;
		}
		foreach ($events as $event) {
			if ($event['player_id'] !== null && !isset($roster[$event['player_id']])) {
				return Response::error(400, 'invalid', ['details' => 'player not on game roster']);
			}
		}

		Db::transaction(static function () use ($events, $gameId): void {
			foreach ($events as $e) {
				Db::run(
					'INSERT OR IGNORE INTO game_events (id, game_id, player_id, timestamp, half, event_type, shot_zone)
					 VALUES (?, ?, ?, ?, ?, ?, ?)',
					[$e['id'], $gameId, $e['player_id'], $e['timestamp'], $e['half'], $e['event_type'], $e['shot_zone']]
				);
			}
		});
		return Response::json(['ids' => array_map(static fn (array $e): string => $e['id'], $events)], 201);
	});

	$r->delete('/api/games/:id/events', static function (Request $req, array $params): Response {
		$gameId = $params['id'];
		$ids = array_values(array_filter(
			explode(',', $req->queryParam('ids') ?? ''),
			static fn (string $id): bool => $id !== ''
		));
		if (\count($ids) > 200) {
			return Response::error(400, 'invalid', ['details' => 'too many ids']);
		}
		if ($ids !== []) {
			Db::run(
				'DELETE FROM game_events WHERE game_id = ? AND id IN (' . placeholders(\count($ids)) . ')',
				[$gameId, ...$ids]
			);
		}
		return Response::noContent();
	});
};
