# PHP backend

A second implementation of the API server for shared web hosting (Apache + PHP, no Node). It is a twin of `server/`: same endpoints, status codes, JSON shapes and SQLite schema, so the unchanged client runs on it and one database file works with both backends.

- PHP 8.2+, PDO SQLite, Apache 2.4 with `mod_rewrite`. No Composer, no dependencies.
- Configuration in `config.php` (copy `config.example.php`); environment variables with the upper-case names override it.
- Data in `data/` (`handball.db`, `ratelimit.db` for the login rate limit, `.session-secret`).

Deployment: [../DEPLOYMENT-STRATO.md](../DEPLOYMENT-STRATO.md).

## Layout

```
public/            document root on the host
  .htaccess        routing: /api/* -> api/index.php, static files, SPA fallback, headers, deny rules
  api/index.php    front controller (middleware order as in server/src/index.ts)
  router.php       router for PHP's built-in server (development only)
src/               Config, Db (schema + row mapping), Http, Auth, Validate, Router, routes/*.php
bin/backup.php     VACUUM INTO backup (command line only)
build.sh           builds the client and assembles dist/ for upload
dev.sh             runs the backend locally in Docker
docker/            dev/test image (Apache + PHP 8.3 + mod_rewrite + sqlite3), not for production
tests/             API contract test, runs against both backends (see tests/README.md)
```

## Development

Requires Docker; PHP does not need to be installed.

```bash
php/dev.sh                  # Apache + .htaccess on http://localhost:8080 (APP_PASSWORD=devpassword)
php/dev.sh builtin          # same with php -S and public/router.php
php/dev.sh lint             # php -l on all files with PHP 8.2 and 8.3
php/dev.sh logs | stop | shell
```

`dev.sh` mounts `php/` read-only (changes apply immediately), uses `php/data/` as the data directory (`HANDBALL_DEV_DATA` to change) and copies `client/build` into `public/` (git-ignored) if it exists, so the full app is served. Without Docker: `APP_PASSWORD=devpassword COOKIE_SECURE=false php -S localhost:8080 -t php/public php/public/router.php`.

Keep this backend in sync with `server/` when the API or the schema changes; `tests/contract.mjs` checks both.
