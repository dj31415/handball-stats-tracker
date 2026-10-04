<?php

declare(strict_types=1);

// /api/auth: login, logout, current role. Mirrors server/src/routes/auth.ts.

namespace Handball;

\defined('HANDBALL_APP') || exit;

return static function (Router $r): void {
	$r->post('/api/auth/login', static function (Request $req): Response {
		$v = Validator::jsonBody($req);
		$password = $v->string('password', max: 1000);
		$v->check();

		[$role, $retryAfter] = Auth::attemptLogin(Auth::clientIp($req), (string) $password);
		if ($retryAfter > 0) {
			$response = Response::error(429, 'rate_limited', ['retry_after' => $retryAfter]);
			$response->headers['Retry-After'] = (string) $retryAfter;
			return $response;
		}
		if ($role === null) {
			return Response::error(401, 'invalid_password');
		}
		if ($role === 'admin' && str_length(Config::get()->appPassword) < 12) {
			log_message('Warning: app_password is shorter than 12 characters. Use a longer password.');
		}
		Auth::issueSession($role);
		return Response::noContent();
	});

	$r->post('/api/auth/logout', static function (): Response {
		Auth::clearSession();
		return Response::noContent();
	});

	$r->get('/api/auth/me', static function (Request $req): Response {
		$role = Auth::getSession($req);
		if ($role === null) {
			return Response::error(401, 'unauthorized');
		}
		return Response::json(['role' => $role]);
	});
};
