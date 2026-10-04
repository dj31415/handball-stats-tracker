<?php

declare(strict_types=1);

// Configuration: php/config.php (an array, see config.example.php), overridden by
// environment variables where set (useful for Docker and local tests).
// Mirrors server/src/config.ts.

namespace Handball;

\defined('HANDBALL_APP') || exit;

final class ConfigError extends \RuntimeException
{
}

final class Config
{
	private static ?Config $instance = null;
	private ?string $sessionSecretCache = null;

	private function __construct(
		public readonly string $appPassword,
		public readonly string $viewerPassword,
		private readonly string $sessionSecretSetting,
		public readonly string $clubName,
		public readonly string $dataDir,
		public readonly string $dbPath,
		public readonly bool $cookieSecure,
		public readonly bool $trustProxy,
	) {
	}

	/** The application root (the directory containing src/, public/ and config.php). */
	public static function rootDir(): string
	{
		return \dirname(__DIR__);
	}

	/** Config for serving requests; requires an admin password. */
	public static function get(): self
	{
		return self::$instance ??= self::load(true);
	}

	/** @throws ConfigError */
	public static function load(bool $requirePassword): self
	{
		$root = self::rootDir();
		$file = $root . '/config.php';
		$values = [];
		if (is_file($file)) {
			$loaded = require $file;
			if (!\is_array($loaded)) {
				throw new ConfigError('config.php must return an array');
			}
			$values = $loaded;
		}

		$str = static function (string $key, string $env) use ($values): string {
			$fromEnv = getenv($env);
			if (\is_string($fromEnv) && $fromEnv !== '') {
				return $fromEnv;
			}
			$value = $values[$key] ?? '';
			if (!\is_string($value)) {
				throw new ConfigError("$key must be a string");
			}
			return $value;
		};
		$bool = static function (string $key, string $env, bool $fallback) use ($values): bool {
			$fromEnv = getenv($env);
			if (\is_string($fromEnv) && $fromEnv !== '') {
				return self::parseBool($fromEnv);
			}
			$value = $values[$key] ?? null;
			if ($value === null || $value === '') {
				return $fallback;
			}
			if (\is_bool($value)) {
				return $value;
			}
			if (\is_int($value) || \is_string($value)) {
				return self::parseBool((string) $value);
			}
			throw new ConfigError("$key must be true or false");
		};

		$appPassword = $str('app_password', 'APP_PASSWORD');
		if ($appPassword === '' && $requirePassword) {
			throw new ConfigError('APP_PASSWORD/app_password is required. Set it in config.php to a long, random password.');
		}
		$viewerPassword = $str('viewer_password', 'VIEWER_PASSWORD');
		if ($viewerPassword !== '' && $viewerPassword === $appPassword) {
			throw new ConfigError('VIEWER_PASSWORD/viewer_password must differ from APP_PASSWORD/app_password.');
		}

		$clubName = trim($str('club_name', 'CLUB_NAME'));
		$dataDirSetting = $str('data_dir', 'DATA_DIR');
		$dataDir = self::resolvePath($dataDirSetting !== '' ? $dataDirSetting : $root . '/data', $root);
		$dbPathSetting = $str('db_path', 'DB_PATH');
		$dbPath = self::resolvePath($dbPathSetting !== '' ? $dbPathSetting : $dataDir . '/handball.db', $root);

		return new self(
			appPassword: $appPassword,
			viewerPassword: $viewerPassword,
			sessionSecretSetting: $str('session_secret', 'SESSION_SECRET'),
			clubName: $clubName !== '' ? $clubName : 'Handball Stats',
			dataDir: $dataDir,
			dbPath: $dbPath,
			cookieSecure: $bool('cookie_secure', 'COOKIE_SECURE', true),
			trustProxy: $bool('trust_proxy', 'TRUST_PROXY', false),
		);
	}

	private static function parseBool(string $value): bool
	{
		return \in_array(strtolower(trim($value)), ['1', 'true', 'yes', 'on'], true);
	}

	/** Relative paths are relative to the application root. */
	private static function resolvePath(string $path, string $root): string
	{
		$isAbsolute = str_starts_with($path, '/') || preg_match('#^[A-Za-z]:[\\\\/]#', $path) === 1;
		$full = $isAbsolute ? $path : $root . '/' . $path;
		$trimmed = rtrim($full, '/\\');
		return $trimmed !== '' ? $trimmed : '/';
	}

	/** Creates the data directory (with a deny-all .htaccess) if it does not exist yet. */
	public static function ensureDir(string $dir): void
	{
		if (is_dir($dir)) {
			return;
		}
		if (!mkdir($dir, 0750, true) && !is_dir($dir)) {
			throw new \RuntimeException("Cannot create directory $dir");
		}
		$htaccess = $dir . '/.htaccess';
		if (!file_exists($htaccess)) {
			file_put_contents($htaccess, "Require all denied\n");
		}
	}

	/**
	 * Secret for signing session cookies: the configured one, else DATA_DIR/.session-secret
	 * (generated on first use, 32 random bytes as hex, mode 0600).
	 */
	public function sessionSecret(): string
	{
		if ($this->sessionSecretCache !== null) {
			return $this->sessionSecretCache;
		}
		if ($this->sessionSecretSetting !== '') {
			return $this->sessionSecretCache = $this->sessionSecretSetting;
		}
		$file = $this->dataDir . '/.session-secret';
		$secret = self::readSecret($file);
		if ($secret === '') {
			self::ensureDir($this->dataDir);
			$tmp = $file . '.' . bin2hex(random_bytes(6)) . '.tmp';
			$oldUmask = umask(0077);
			try {
				file_put_contents($tmp, bin2hex(random_bytes(32)));
			} finally {
				umask($oldUmask);
			}
			// chmod() and link() are sometimes in disable_functions on shared hosts (calling them
			// would then throw an Error), so they are optional.
			if (\function_exists('chmod')) {
				@chmod($tmp, 0600);
			}
			// link() fails if another request created the file first; that secret wins.
			if (!(\function_exists('link') && @link($tmp, $file)) && !file_exists($file)) {
				rename($tmp, $file);
			}
			if (file_exists($tmp)) {
				unlink($tmp);
			}
			$secret = self::readSecret($file);
			if ($secret === '') {
				throw new \RuntimeException("Cannot create session secret in $file");
			}
		}
		return $this->sessionSecretCache = $secret;
	}

	private static function readSecret(string $file): string
	{
		if (!is_file($file)) {
			return '';
		}
		$content = file_get_contents($file);
		return $content === false ? '' : trim($content);
	}
}
