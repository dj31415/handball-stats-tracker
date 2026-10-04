<?php

declare(strict_types=1);

// API front controller: every request under /api/ is rewritten here (see .htaccess).
// Middleware order mirrors server/src/index.ts.

use Handball\Auth;
use Handball\Config;
use Handball\Db;
use Handball\HttpException;
use Handball\Request;
use Handball\Response;
use Handball\Router;

use function Handball\log_exception;

use const Handball\BODY_LIMIT;

ob_start();

register_shutdown_function(static function (): void {
	// Fatal errors cannot be caught; still answer with JSON instead of an empty or HTML page.
	$error = error_get_last();
	$fatal = E_ERROR | E_PARSE | E_CORE_ERROR | E_COMPILE_ERROR | E_USER_ERROR | E_RECOVERABLE_ERROR;
	if ($error !== null && ($error['type'] & $fatal) !== 0) {
		while (ob_get_level() > 0) {
			ob_end_clean();
		}
		if (!headers_sent()) {
			http_response_code(500);
			header('Content-Type: application/json');
			header('Cache-Control: no-store');
			echo '{"error":"internal"}';
		}
	}
});

require __DIR__ . '/../../src/bootstrap.php';

$src = __DIR__ . '/../../src';

function handle(Request $req, string $src): Response
{
	$config = Config::get(); // throws (500) when config.php / APP_PASSWORD is missing or invalid
	$method = $req->method;

	// 1. Body limit
	$contentLength = $req->header('content-length');
	if (($contentLength !== null && ctype_digit($contentLength) && (int) $contentLength > BODY_LIMIT)
		|| \strlen($req->body(BODY_LIMIT)) > BODY_LIMIT) {
		return Response::error(413, 'payload_too_large');
	}

	// 2. Reject cross-origin writes: Origin (if sent) must match the Host.
	if ($method !== 'GET' && $method !== 'HEAD' && $method !== 'OPTIONS') {
		$origin = $req->header('origin');
		if ($origin !== null) {
			$expected = ($config->trustProxy ? $req->header('x-forwarded-host') : null) ?: $req->header('host');
			$host = origin_host($origin);
			if ($host === null || $host !== $expected) {
				return Response::error(403, 'forbidden');
			}
		}
	}

	// 3. Public routes
	$public = new Router();
	$public->get('/api/health', static function (): Response {
		Db::get()->query('SELECT 1');
		return Response::json(['ok' => true]);
	});
	$public->get('/api/config', static fn (): Response => Response::json(['club_name' => Config::get()->clubName]));
	(require $src . '/routes/auth.php')($public);
	$match = $public->match($method, $req->path);
	if ($match !== null) {
		return $match[0]($req, $match[1]);
	}

	// 4. Everything else needs a session; viewers are read-only.
	$role = Auth::getSession($req);
	if ($role === null) {
		return Response::error(401, 'unauthorized');
	}
	if ($method !== 'GET' && $method !== 'HEAD' && $role !== 'admin') {
		return Response::error(403, 'forbidden');
	}

	// 5. Protected routes
	$protected = new Router();
	foreach (['players', 'seasons', 'games', 'events'] as $name) {
		(require $src . '/routes/' . $name . '.php')($protected);
	}
	$match = $protected->match($method, $req->path);
	if ($match !== null) {
		return $match[0]($req, $match[1]);
	}
	return Response::error(404, 'not_found');
}

/** host[:port] of an Origin header like `new URL(origin).host`, or null if it cannot be parsed. */
function origin_host(string $origin): ?string
{
	$parts = parse_url($origin);
	if (!\is_array($parts) || !isset($parts['scheme'], $parts['host']) || $parts['host'] === '') {
		return null;
	}
	$scheme = strtolower($parts['scheme']);
	$host = strtolower($parts['host']);
	$defaultPorts = ['http' => 80, 'https' => 443, 'ws' => 80, 'wss' => 443, 'ftp' => 21];
	if (isset($parts['port']) && ($defaultPorts[$scheme] ?? null) !== $parts['port']) {
		$host .= ':' . $parts['port'];
	}
	return $host;
}

$request = Request::fromGlobals();
try {
	$response = handle($request, $src);
} catch (HttpException $e) {
	$response = $e->response;
} catch (\Throwable $e) {
	log_exception($e);
	$response = Response::error(500, 'internal');
}
$response->send();
