<?php

declare(strict_types=1);

// /api/seasons. Mirrors server/src/routes/seasons.ts.

namespace Handball;

\defined('HANDBALL_APP') || exit;

return static function (Router $r): void {
	$r->get('/api/seasons', static function (): Response {
		$rows = Db::all('SELECT * FROM seasons ORDER BY start_date');
		return Response::json(Db::mapRows($rows, Db::toSeason(...)));
	});

	$r->post('/api/seasons', static function (Request $req): Response {
		$v = Validator::jsonBody($req);
		$id = $v->string('id', 1, 100, optional: true);
		$name = $v->string('name', 1, 100, trim: true);
		$startDate = $v->string('start_date', 1, 40);
		$endDate = $v->string('end_date', 0, 40, optional: true);
		$v->check();

		$id ??= uuid_v4();
		Db::run(
			'INSERT OR IGNORE INTO seasons (id, name, start_date, end_date) VALUES (?, ?, ?, ?)',
			[$id, $name, $startDate, $endDate ?? '']
		);
		$row = Db::one('SELECT * FROM seasons WHERE id = ?', [$id]);
		if ($row === null) {
			throw new \RuntimeException('season not found after insert');
		}
		return Response::json(Db::toSeason($row), 201);
	});
};
