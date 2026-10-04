<?php

declare(strict_types=1);

// /api/events: all events, optionally filtered by season and game status. Mirrors server/src/routes/events.ts.

namespace Handball;

\defined('HANDBALL_APP') || exit;

return static function (Router $r): void {
	$r->get('/api/events', static function (Request $req): Response {
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
			'SELECT e.* FROM game_events e JOIN games g ON g.id = e.game_id '
			. ($where !== [] ? 'WHERE ' . implode(' AND ', $where) . ' ' : '')
			. 'ORDER BY e.timestamp, e.rowid',
			$args
		);
		return Response::json(Db::mapRows($rows, Db::toEvent(...)));
	});
};
