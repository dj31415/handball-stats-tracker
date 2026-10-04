<?php

declare(strict_types=1);

// Passwords, signed session cookies and login rate limiting. Mirrors server/src/auth.ts.

namespace Handball;

\defined('HANDBALL_APP') || exit;

final class Auth
{
	private const SESSION_SECONDS = 30 * 24 * 60 * 60;
	private const RENEW_AFTER_SECONDS = 24 * 60 * 60;

	private const WINDOW_SECONDS = 15 * 60;
	private const MAX_FAILURES_PER_IP = 5;
	private const MAX_FAILURES_GLOBAL = 30;
	private const GLOBAL_KEY = '*';

	private static ?\PDO $rateDb = null;

	// ── Passwords ──

	private static function passwordMatches(string $input, string $password): bool
	{
		return hash_equals(hash('sha256', $password, true), hash('sha256', $input, true));
	}

	private static function passwordFor(string $role): string
	{
		$config = Config::get();
		return $role === 'admin' ? $config->appPassword : $config->viewerPassword;
	}

	/** Returns the role a password grants ('admin' or 'viewer'), or null. */
	public static function checkPassword(string $input): ?string
	{
		$config = Config::get();
		$isAdmin = self::passwordMatches($input, $config->appPassword);
		$isViewer = $config->viewerPassword !== '' && self::passwordMatches($input, $config->viewerPassword);
		if ($isAdmin) {
			return 'admin';
		}
		if ($isViewer) {
			return 'viewer';
		}
		return null;
	}

	// ── Session cookie ──
	// Value "v1.<role>.<exp>.<tag>", signed like Hono's signed cookies: value + "." + base64(HMAC-SHA256).

	/** Changing a role's password changes its tag and thereby invalidates its sessions. */
	private static function passwordTag(string $role): string
	{
		return substr(hash_hmac('sha256', 'pw:' . $role . ':' . self::passwordFor($role), Config::get()->sessionSecret()), 0, 16);
	}

	private static function sign(string $value): string
	{
		return base64_encode(hash_hmac('sha256', $value, Config::get()->sessionSecret(), true));
	}

	private static function cookieName(): string
	{
		return Config::get()->cookieSecure ? '__Host-session' : 'session';
	}

	private static function cookieAttributes(): string
	{
		return '; Path=/; HttpOnly' . (Config::get()->cookieSecure ? '; Secure' : '') . '; SameSite=Strict';
	}

	public static function issueSession(string $role): void
	{
		$value = 'v1.' . $role . '.' . (time() + self::SESSION_SECONDS) . '.' . self::passwordTag($role);
		$signed = rawurlencode($value . '.' . self::sign($value));
		Response::addCookie(self::cookieName() . '=' . $signed . '; Max-Age=' . self::SESSION_SECONDS . self::cookieAttributes());
	}

	public static function clearSession(): void
	{
		Response::addCookie(
			self::cookieName() . '=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT' . self::cookieAttributes()
		);
	}

	/** First cookie with this name from the Cookie header (parsed like Hono, not via $_COOKIE). */
	private static function readCookie(Request $req, string $name): ?string
	{
		$header = $req->header('cookie');
		if ($header === null || !str_contains($header, $name)) {
			return null;
		}
		foreach (explode(';', trim($header)) as $pair) {
			$pair = trim($pair);
			$eq = strpos($pair, '=');
			if ($eq === false || trim(substr($pair, 0, $eq)) !== $name) {
				continue;
			}
			$value = trim(substr($pair, $eq + 1));
			if (\strlen($value) >= 2 && str_starts_with($value, '"') && str_ends_with($value, '"')) {
				$value = substr($value, 1, -1);
			}
			if (preg_match('/^[ !#-:<-\[\]-~]*$/D', $value) !== 1) {
				continue;
			}
			return str_contains($value, '%') ? rawurldecode($value) : $value;
		}
		return null;
	}

	/** Validates the session cookie, renews it when older than a day, and returns the role or null. */
	public static function getSession(Request $req): ?string
	{
		$cookie = self::readCookie($req, self::cookieName());
		if ($cookie === null) {
			return null;
		}
		$dot = strrpos($cookie, '.');
		if ($dot === false || $dot < 1) {
			return null;
		}
		$value = substr($cookie, 0, $dot);
		$signature = substr($cookie, $dot + 1);
		if (\strlen($signature) !== 44 || !str_ends_with($signature, '=') || !hash_equals(self::sign($value), $signature)) {
			return null;
		}

		$parts = explode('.', $value);
		[$version, $role, $exp, $tag] = array_pad($parts, 4, '');
		if ($version !== 'v1' || ($role !== 'admin' && $role !== 'viewer')) {
			return null;
		}
		if (preg_match('/^\d{1,12}$/D', $exp) !== 1) {
			return null;
		}
		$expiresAt = (int) $exp;
		$now = time();
		if ($expiresAt <= $now) {
			return null;
		}
		$expected = self::passwordTag($role);
		if ($tag === '' || !hash_equals($expected, $tag)) {
			return null;
		}
		if (self::SESSION_SECONDS - ($expiresAt - $now) > self::RENEW_AFTER_SECONDS) {
			self::issueSession($role);
		}
		return $role;
	}

	// ── Login rate limiting (persisted in DATA_DIR/ratelimit.db, separate from the app database) ──

	public static function clientIp(Request $req): string
	{
		if (Config::get()->trustProxy) {
			$forwarded = $req->header('x-forwarded-for');
			if ($forwarded !== null && $forwarded !== '') {
				$parts = explode(',', $forwarded);
				$last = trim((string) end($parts));
				if ($last !== '') {
					return $last;
				}
			}
		}
		return $req->remoteAddr !== '' ? $req->remoteAddr : 'unknown';
	}

	private static function rateDb(): \PDO
	{
		if (self::$rateDb === null) {
			$pdo = Db::open(Config::get()->dataDir . '/ratelimit.db');
			$pdo->exec(
				'CREATE TABLE IF NOT EXISTS login_failures (ip TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)'
			);
			self::$rateDb = $pdo;
		}
		return self::$rateDb;
	}

	/**
	 * Checks the rate limit and the password and records the outcome, all inside one write
	 * transaction on ratelimit.db. PHP serves requests in parallel processes, so a separate
	 * check and record would let a burst of concurrent attempts through before the first
	 * failure is counted (Node does this synchronously in one event-loop turn).
	 *
	 * @return array{0: ?string, 1: int} [role or null, seconds until login is allowed again (0 = not limited)]
	 */
	public static function attemptLogin(string $ip, string $password): array
	{
		$pdo = self::rateDb();
		return Db::transaction(static function () use ($pdo, $ip, $password): array {
			$retryAfter = self::loginRetryAfter($ip, $pdo);
			if ($retryAfter > 0) {
				return [null, $retryAfter];
			}
			$role = self::checkPassword($password);
			if ($role === null) {
				self::recordLoginFailure($ip, $pdo);
			} else {
				Db::run('DELETE FROM login_failures WHERE ip = ?', [$ip], $pdo);
			}
			return [$role, 0];
		}, $pdo);
	}

	/** Seconds until login is allowed again, or 0 if allowed. */
	private static function loginRetryAfter(string $ip, \PDO $pdo): int
	{
		$now = time();
		$rows = Db::run(
			'SELECT ip, count, reset_at FROM login_failures WHERE ip IN (?, ?) AND reset_at > ?',
			[$ip, self::GLOBAL_KEY, $now],
			$pdo
		)->fetchAll();
		$until = 0;
		foreach ($rows as $row) {
			$limit = $row['ip'] === self::GLOBAL_KEY ? self::MAX_FAILURES_GLOBAL : self::MAX_FAILURES_PER_IP;
			if ((int) $row['count'] >= $limit) {
				$until = max($until, (int) $row['reset_at']);
			}
		}
		return $until > 0 ? $until - $now : 0;
	}

	/** Counts a failure for the IP and globally; must run inside attemptLogin's transaction. */
	private static function recordLoginFailure(string $ip, \PDO $pdo): void
	{
		$now = time();
		// Opportunistic cleanup of expired windows.
		Db::run('DELETE FROM login_failures WHERE reset_at <= ?', [$now], $pdo);
		foreach ([$ip, self::GLOBAL_KEY] as $key) {
			Db::run('UPDATE login_failures SET count = count + 1 WHERE ip = ?', [$key], $pdo);
			Db::run(
				'INSERT OR IGNORE INTO login_failures (ip, count, reset_at) VALUES (?, 1, ?)',
				[$key, $now + self::WINDOW_SECONDS],
				$pdo
			);
		}
	}
}
