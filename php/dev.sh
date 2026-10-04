#!/usr/bin/env bash
# Run the PHP backend locally in Docker (development and tests only).
#
#   ./dev.sh [start]   Apache + PHP 8.3 with the real .htaccess files on http://localhost:8080
#   ./dev.sh builtin   PHP's built-in server with public/router.php instead (foreground)
#   ./dev.sh stop      stop the Apache container
#   ./dev.sh logs      follow the Apache/PHP error and access logs
#   ./dev.sh lint      php -l on every PHP file (PHP 8.2 and 8.3)
#   ./dev.sh shell     shell in the running container (sqlite3 is installed)
#
# Environment: PORT (8080), HANDBALL_DEV_DATA (data directory, default php/data),
# APP_PASSWORD (devpassword), VIEWER_PASSWORD, CLUB_NAME, COOKIE_SECURE (false), TRUST_PROXY.
# php/ is mounted read-only at /app, so PHP changes apply without a restart. If client/build exists,
# it is copied into public/ (git-ignored) so the SPA is served as well; run `npm run build` in
# client/ first to include the current client.
set -euo pipefail

PHP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$PHP_DIR")"
IMAGE=handball-php-dev
CONTAINER=handball-php-dev
PORT="${PORT:-8080}"
DATA="${HANDBALL_DEV_DATA:-$PHP_DIR/data}"

copy_client() {
	local build="$ROOT_DIR/client/build"
	if [[ -f "$build/index.html" ]]; then
		rm -rf "$PHP_DIR/public/_app"
		cp -a "$build/." "$PHP_DIR/public/"
		echo "Copied client/build into php/public/"
	else
		echo "client/build not found: API only (build the client to serve the app too)"
	fi
}

env_args() {
	local args=(
		-e "APP_PASSWORD=${APP_PASSWORD:-devpassword}"
		-e "COOKIE_SECURE=${COOKIE_SECURE:-false}"
		-e "DATA_DIR=/data"
	)
	local name
	for name in VIEWER_PASSWORD CLUB_NAME TRUST_PROXY SESSION_SECRET; do
		if [[ -n "${!name:-}" ]]; then args+=(-e "$name=${!name}"); fi
	done
	printf '%s\n' "${args[@]}"
}

cmd="${1:-start}"
case "$cmd" in
	start)
		mkdir -p "$DATA"
		copy_client
		docker build -q -t "$IMAGE" "$PHP_DIR/docker" >/dev/null
		docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
		mapfile -t envs < <(env_args)
		# Apache runs as the calling user so files in the data directory stay yours.
		docker run -d --name "$CONTAINER" -p "$PORT:80" \
			-e "HOST_UID=$(id -u)" -e "HOST_GID=$(id -g)" \
			"${envs[@]}" \
			-v "$PHP_DIR:/app:ro" -v "$(cd "$DATA" && pwd):/data" \
			"$IMAGE" >/dev/null
		echo "Running on http://localhost:$PORT (data: $DATA). Stop with: $0 stop"
		;;
	builtin)
		mkdir -p "$DATA"
		copy_client
		mapfile -t envs < <(env_args)
		tty=(); if [[ -t 0 ]]; then tty=(-it); fi
		exec docker run --rm "${tty[@]}" --name "$CONTAINER-builtin" -p "$PORT:8080" \
			-u "$(id -u):$(id -g)" "${envs[@]}" \
			-v "$PHP_DIR:/app:ro" -v "$(cd "$DATA" && pwd):/data" -w /app \
			php:8.3-cli php -S 0.0.0.0:8080 -t public public/router.php
		;;
	stop)
		docker rm -f "$CONTAINER" >/dev/null 2>&1 && echo "Stopped" || echo "Not running"
		;;
	logs)
		exec docker logs -f "$CONTAINER"
		;;
	lint)
		status=0
		for version in 8.2 8.3; do
			echo "PHP $version"
			docker run --rm -v "$PHP_DIR:/app:ro" -w /app "php:$version-cli" sh -c '
				status=0; count=0
				for f in $(find . -path ./dist -prune -o -path ./public/_app -prune -o -name "*.php" -print | sort); do
					count=$((count + 1))
					out=$(php -l "$f" 2>&1) || { echo "$out"; status=1; }
				done
				echo "  $count files checked"
				exit $status' || status=1
		done
		exit $status
		;;
	shell)
		exec docker exec -it "$CONTAINER" bash
		;;
	*)
		sed -n '2,16p' "$0"
		exit 1
		;;
esac
