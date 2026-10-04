#!/usr/bin/env bash
# Builds the client and assembles a deployable bundle for shared hosting in php/dist/:
#
#   dist/
#     public/          <- set the domain's document root here
#       .htaccess  api/  index.html  _app/  ...
#     src/  bin/  data/.htaccess
#     config.example.php   (copy to config.php on the server)
#
# Usage: php/build.sh      (SKIP_CLIENT_BUILD=1 reuses an existing client/build)
# See ../DEPLOYMENT-STRATO.md.
set -euo pipefail

PHP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$PHP_DIR")"
DIST="$PHP_DIR/dist"

if [[ "${SKIP_CLIENT_BUILD:-}" == "1" ]]; then
	echo "Skipping client build (SKIP_CLIENT_BUILD=1), using existing client/build"
else
	echo "Building client ..."
	(cd "$ROOT_DIR/client" && npm ci && npm run build)
fi
if [[ ! -f "$ROOT_DIR/client/build/index.html" ]]; then
	echo "client/build/index.html not found" >&2
	exit 1
fi

echo "Assembling $DIST ..."
rm -rf "$DIST"
mkdir -p "$DIST/public" "$DIST/data"
cp -a "$ROOT_DIR/client/build/." "$DIST/public/"
cp -a "$PHP_DIR/public/.htaccess" "$PHP_DIR/public/.user.ini" "$PHP_DIR/public/router.php" "$PHP_DIR/public/api" "$DIST/public/"
cp -a "$PHP_DIR/src" "$PHP_DIR/bin" "$DIST/"
cp "$PHP_DIR/config.example.php" "$DIST/"
cp "$PHP_DIR/data/.htaccess" "$DIST/data/"

cat <<MSG

Done: $DIST

Upload (SFTP) the contents of dist/ to a directory on the host, e.g. /handball/, so that you get
/handball/public, /handball/src, /handball/bin, /handball/data and /handball/config.example.php.
Then:
  1. Point the domain's document root at /handball/public.
  2. Copy config.example.php to config.php (next to it, not in public/) and set app_password.
  3. Make data/ writable for PHP.
On updates upload public/, src/ and bin/ again; never overwrite data/ or config.php.
Details: DEPLOYMENT-STRATO.md
MSG
