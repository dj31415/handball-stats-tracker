<?php

declare(strict_types=1);

// /api/players. Mirrors server/src/routes/players.ts.

namespace Handball;

\defined('HANDBALL_APP') || exit;

/** @return array<string, mixed>|null */
function find_player(string $id): ?array
{
	$row = Db::one('SELECT * FROM players WHERE id = ?', [$id]);
	return $row === null ? null : Db::toPlayer($row);
}

return static function (Router $r): void {
	$r->get('/api/players', static function (Request $req): Response {
		$activeOnly = $req->queryParam('active') === '1';
		$rows = Db::all('SELECT * FROM players ' . ($activeOnly ? 'WHERE is_active = 1 ' : '') . 'ORDER BY number, name');
		return Response::json(Db::mapRows($rows, Db::toPlayer(...)));
	});

	$r->post('/api/players', static function (Request $req): Response {
		$v = Validator::jsonBody($req);
		$id = $v->string('id', 1, 100, optional: true);
		$name = $v->string('name', 1, 100, trim: true);
		$number = $v->int('number', 0, 999);
		$position = $v->enum('position', POSITIONS);
		$isActive = $v->literal('is_active', [0, 1], optional: true);
		$v->check();

		$id ??= uuid_v4();
		Db::run(
			'INSERT OR IGNORE INTO players (id, name, number, position, is_active) VALUES (?, ?, ?, ?, ?)',
			[$id, $name, $number, $position, $isActive ?? 1]
		);
		return Response::json(find_player($id), 201);
	});

	$r->patch('/api/players/:id', static function (Request $req, array $params): Response {
		$id = $params['id'];
		$v = Validator::jsonBody($req);
		$patch = [
			'name' => $v->string('name', 1, 100, trim: true, optional: true),
			'number' => $v->int('number', 0, 999, optional: true),
			'position' => $v->enum('position', POSITIONS, optional: true),
			'is_active' => $v->literal('is_active', [0, 1], optional: true),
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
			Db::run('UPDATE players SET ' . implode(', ', $sets) . ' WHERE id = ?', [...$args, $id]);
		}
		$player = find_player($id);
		if ($player === null) {
			return Response::error(404, 'not_found');
		}
		return Response::json($player);
	});

	$r->delete('/api/players/:id', static function (Request $req, array $params): Response {
		$id = $params['id'];
		if (find_player($id) === null) {
			return Response::error(404, 'not_found');
		}
		$used = Db::one(
			'SELECT 1 FROM game_events WHERE player_id = ?
			 UNION ALL SELECT 1 FROM game_rosters WHERE player_id = ? LIMIT 1',
			[$id, $id]
		);
		if ($used !== null) {
			return Response::error(409, 'player_has_data');
		}
		Db::run('DELETE FROM players WHERE id = ?', [$id]);
		return Response::noContent();
	});
};
