<?php

declare(strict_types=1);

// Minimal method + path router. Patterns use ":name" segments, e.g. /api/games/:id/events.

namespace Handball;

\defined('HANDBALL_APP') || exit;

final class Router
{
	/** @var list<array{string, list<string>, callable(Request, array<string, string>): Response}> */
	private array $routes = [];

	/** @param callable(Request, array<string, string>): Response $handler */
	public function add(string $method, string $pattern, callable $handler): void
	{
		$this->routes[] = [$method, explode('/', trim($pattern, '/')), $handler];
	}

	public function get(string $pattern, callable $handler): void
	{
		$this->add('GET', $pattern, $handler);
	}

	public function post(string $pattern, callable $handler): void
	{
		$this->add('POST', $pattern, $handler);
	}

	public function patch(string $pattern, callable $handler): void
	{
		$this->add('PATCH', $pattern, $handler);
	}

	public function delete(string $pattern, callable $handler): void
	{
		$this->add('DELETE', $pattern, $handler);
	}

	/**
	 * Finds the handler for a request; HEAD is routed like GET. Returns null when nothing matches.
	 *
	 * @return array{callable(Request, array<string, string>): Response, array<string, string>}|null
	 */
	public function match(string $method, string $path): ?array
	{
		$method = $method === 'HEAD' ? 'GET' : $method;
		if ($path === '' || $path[0] !== '/') {
			return null;
		}
		$segments = explode('/', substr($path, 1));
		foreach ($this->routes as [$routeMethod, $parts, $handler]) {
			if ($routeMethod !== $method || \count($parts) !== \count($segments)) {
				continue;
			}
			$params = [];
			foreach ($parts as $i => $part) {
				$segment = rawurldecode($segments[$i]);
				if (str_starts_with($part, ':')) {
					if ($segment === '') {
						continue 2;
					}
					$params[substr($part, 1)] = $segment;
				} elseif ($part !== $segment) {
					continue 2;
				}
			}
			return [$handler, $params];
		}
		return null;
	}
}
