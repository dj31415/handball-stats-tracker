<?php

declare(strict_types=1);

// PHP backend for shared hosting: a twin of the Node server in server/src.
// Loaded by public/api/index.php and bin/backup.php; never requested directly.

namespace Handball;

\define('HANDBALL_APP', true);

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('log_errors', '1');

/** Write a line to the PHP error log (the web server's error log on most hosts). */
function log_message(string $message): void
{
	error_log('[handball] ' . $message);
}

function log_exception(\Throwable $e): void
{
	log_message(sprintf('%s: %s in %s:%d', $e::class, $e->getMessage(), $e->getFile(), $e->getLine()));
}

// Warnings and notices become exceptions (answered with 500 by the front controller),
// so they never leak into a response. Deprecations are only logged.
set_error_handler(static function (int $severity, string $message, string $file = '', int $line = 0): bool {
	if ((error_reporting() & $severity) === 0) {
		return true; // silenced with @
	}
	if (($severity & (E_DEPRECATED | E_USER_DEPRECATED)) !== 0) {
		log_message("Deprecated: $message in $file:$line");
		return true;
	}
	throw new \ErrorException($message, 0, $severity, $file, $line);
});

require __DIR__ . '/Config.php';
require __DIR__ . '/Db.php';
require __DIR__ . '/Http.php';
require __DIR__ . '/Validate.php';
require __DIR__ . '/Auth.php';
require __DIR__ . '/Router.php';

// ── Enums (mirror shared/types.ts) ──

const POSITIONS = ['LW', 'LB', 'CB', 'RB', 'RW', 'PV', 'GK'];
const SHOT_ZONES = ['LW', 'PV', 'RW', 'LB', 'CB', 'RB'];
const EVENT_TYPES = [
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
	'opponent_7m',
];
const GAME_STATUSES = ['setup', 'first_half', 'half_time', 'second_half', 'finished'];
const HALVES = [1, 2];

/** Maximum request body size for /api requests (bytes). */
const BODY_LIMIT = 256 * 1024;

// ── Helpers ──

/** Random UUID v4, like crypto.randomUUID(). */
function uuid_v4(): string
{
	$b = random_bytes(16);
	$b[6] = \chr((\ord($b[6]) & 0x0f) | 0x40);
	$b[8] = \chr((\ord($b[8]) & 0x3f) | 0x80);
	$h = bin2hex($b);
	return substr($h, 0, 8) . '-' . substr($h, 8, 4) . '-' . substr($h, 12, 4) . '-' . substr($h, 16, 4) . '-' . substr($h, 20);
}

/** "?, ?, ?" for an IN (...) list. */
function placeholders(int $count): string
{
	return implode(', ', array_fill(0, $count, '?'));
}
