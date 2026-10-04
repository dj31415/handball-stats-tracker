<?php

declare(strict_types=1);

// Minimal request/response types for the API front controller.

namespace Handball;

\defined('HANDBALL_APP') || exit;

final class Request
{
	private ?string $body = null;

	/**
	 * @param string $path URL path without query string, relative to the app root (e.g. /api/players)
	 * @param array<string, list<string>> $query decoded query parameters, every value of repeated keys
	 * @param array<string, string> $headers lower-case header names
	 */
	public function __construct(
		public readonly string $method,
		public readonly string $path,
		public readonly array $query,
		public readonly array $headers,
		public readonly string $remoteAddr,
	) {
	}

	public static function fromGlobals(): self
	{
		$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
		$uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');

		$queryPos = strpos($uri, '?');
		$rawPath = $queryPos === false ? $uri : substr($uri, 0, $queryPos);
		$rawQuery = $queryPos === false ? '' : substr($uri, $queryPos + 1);
		$hashPos = strpos($rawQuery, '#');
		if ($hashPos !== false) {
			$rawQuery = substr($rawQuery, 0, $hashPos);
		}

		// When installed below the domain root, strip the prefix (SCRIPT_NAME ends with /api/index.php).
		$script = (string) ($_SERVER['SCRIPT_NAME'] ?? '');
		if (str_ends_with($script, '/api/index.php')) {
			$base = substr($script, 0, -\strlen('/api/index.php'));
			if ($base !== '' && str_starts_with($rawPath, $base . '/')) {
				$rawPath = substr($rawPath, \strlen($base));
			}
		}

		$headers = [];
		foreach ($_SERVER as $key => $value) {
			if (!\is_string($value)) {
				continue;
			}
			if (str_starts_with((string) $key, 'HTTP_')) {
				$headers[strtolower(str_replace('_', '-', substr((string) $key, 5)))] = $value;
			} elseif ($key === 'CONTENT_TYPE' || $key === 'CONTENT_LENGTH') {
				$headers[strtolower(str_replace('_', '-', (string) $key))] = $value;
			}
		}

		return new self(
			method: $method,
			path: $rawPath === '' ? '/' : $rawPath,
			query: self::parseQuery($rawQuery),
			headers: $headers,
			remoteAddr: (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
		);
	}

	/**
	 * Parses a query string like URLSearchParams ("+" is a space, repeated keys are kept),
	 * without PHP's renaming of "." and "[]" in keys.
	 *
	 * @return array<string, list<string>>
	 */
	public static function parseQuery(string $raw): array
	{
		$result = [];
		if ($raw === '') {
			return $result;
		}
		foreach (explode('&', $raw) as $pair) {
			if ($pair === '') {
				continue;
			}
			$eq = strpos($pair, '=');
			$name = urldecode($eq === false ? $pair : substr($pair, 0, $eq));
			$value = $eq === false ? '' : urldecode(substr($pair, $eq + 1));
			$result[$name][] = $value;
		}
		return $result;
	}

	public function header(string $name): ?string
	{
		return $this->headers[strtolower($name)] ?? null;
	}

	/** First value of a query parameter, like Hono's c.req.query(name). */
	public function queryParam(string $name): ?string
	{
		return $this->query[$name][0] ?? null;
	}

	/** Raw request body, read at most $limit + 1 bytes (enough to detect an oversized body). */
	public function body(int $limit): string
	{
		if ($this->body === null) {
			$data = file_get_contents('php://input', false, null, 0, $limit + 1);
			$this->body = $data === false ? '' : $data;
		}
		return $this->body;
	}
}

final class Response
{
	/** Headers sent on every API response (Hono's secureHeaders() defaults plus noindex and no-store). */
	private const DEFAULT_HEADERS = [
		'Cross-Origin-Resource-Policy' => 'same-origin',
		'Cross-Origin-Opener-Policy' => 'same-origin',
		'Origin-Agent-Cluster' => '?1',
		'Referrer-Policy' => 'no-referrer',
		'X-Content-Type-Options' => 'nosniff',
		'X-DNS-Prefetch-Control' => 'off',
		'X-Download-Options' => 'noopen',
		'X-Frame-Options' => 'SAMEORIGIN',
		'X-Permitted-Cross-Domain-Policies' => 'none',
		'X-XSS-Protection' => '0',
		'X-Robots-Tag' => 'noindex',
		'Cache-Control' => 'no-store',
	];

	/** @var list<string> Set-Cookie header values queued during the request */
	private static array $cookies = [];

	/** @param array<string, string> $headers */
	public function __construct(
		public readonly int $status,
		public readonly ?string $body = null,
		public array $headers = [],
	) {
	}

	public static function json(mixed $data, int $status = 200): self
	{
		$body = json_encode(
			$data,
			JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR
		);
		return new self($status, $body, ['Content-Type' => 'application/json']);
	}

	/** @param array<string, mixed> $extra */
	public static function error(int $status, string $error, array $extra = []): self
	{
		return self::json(['error' => $error] + $extra, $status);
	}

	public static function noContent(): self
	{
		return new self(204);
	}

	public static function addCookie(string $setCookie): void
	{
		self::$cookies[] = $setCookie;
	}

	public function send(): void
	{
		// Discard anything printed by accident so it cannot corrupt the response.
		while (ob_get_level() > 0) {
			ob_end_clean();
		}
		http_response_code($this->status);
		header_remove('X-Powered-By');
		foreach ($this->headers + self::DEFAULT_HEADERS as $name => $value) {
			header($name . ': ' . $value);
		}
		foreach (self::$cookies as $cookie) {
			header('Set-Cookie: ' . $cookie, false);
		}
		if ($this->body !== null && $this->status !== 204) {
			header('Content-Length: ' . \strlen($this->body));
			echo $this->body;
		}
	}
}

/** Thrown to end request handling early with a response (validation errors, 4xx). */
final class HttpException extends \RuntimeException
{
	public function __construct(public readonly Response $response)
	{
		parent::__construct('HTTP ' . $response->status);
	}
}
