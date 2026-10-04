<?php

declare(strict_types=1);

// Router script for PHP's built-in web server (local development and tests only):
//   php -S localhost:8080 -t public public/router.php
// Emulates public/.htaccess. On Apache (production) this file is not used and access is denied.

if (PHP_SAPI !== 'cli-server') {
	http_response_code(404);
	exit;
}

$uriPath = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
$path = rawurldecode(is_string($uriPath) ? $uriPath : '/');

// API
if ($path === '/api' || str_starts_with($path, '/api/')) {
	require __DIR__ . '/api/index.php';
	return true;
}

$notFound = static function (): bool {
	http_response_code(404);
	header('Content-Type: text/plain; charset=UTF-8');
	echo 'Not found';
	return true;
};

$base = basename($path);
if (str_contains($path, '..') || str_contains($path, "\0")
	|| preg_match('/^(\.ht|\.session-secret|config\.php$|router\.php$)|\.db(-wal|-shm|-journal)?$|\.php$/', $base) === 1) {
	return $notFound();
}

$securityHeaders = static function (): void {
	header('X-Content-Type-Options: nosniff');
	header('X-Frame-Options: SAMEORIGIN');
	header('Referrer-Policy: no-referrer');
	header('X-Robots-Tag: noindex');
};

// Existing files. The built-in server drops headers set here when it serves a file itself
// (return false), so common types are sent from here to get the cache headers right.
$file = __DIR__ . $path;
if ($path !== '/' && is_file($file)) {
	$types = [
		'html' => 'text/html; charset=UTF-8',
		'js' => 'text/javascript; charset=UTF-8',
		'css' => 'text/css; charset=UTF-8',
		'json' => 'application/json',
		'webmanifest' => 'application/manifest+json',
		'svg' => 'image/svg+xml',
		'png' => 'image/png',
		'ico' => 'image/x-icon',
		'woff2' => 'font/woff2',
		'txt' => 'text/plain; charset=UTF-8',
	];
	$type = $types[strtolower(pathinfo($file, PATHINFO_EXTENSION))] ?? null;
	if ($type === null) {
		return false;
	}
	$securityHeaders();
	header('Content-Type: ' . $type);
	if (str_starts_with($path, '/_app/immutable/')) {
		header('Cache-Control: public, max-age=31536000, immutable');
	} elseif (str_ends_with($path, '.html')) {
		header('Cache-Control: no-cache');
	}
	header('Content-Length: ' . filesize($file));
	readfile($file);
	return true;
}

// Missing build assets and files with an extension: 404, not the app shell.
if (str_starts_with($path, '/_app/') || preg_match('/[^\/]\.[^\/]*$/', $path) === 1) {
	return $notFound();
}

// SPA fallback
$index = __DIR__ . '/index.html';
if (!is_file($index)) {
	return $notFound();
}
$securityHeaders();
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-cache');
readfile($index);
return true;
