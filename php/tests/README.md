# API contract test

`contract.mjs` is a black-box test of the REST API. It talks HTTP only, so the same run must pass
against the Node reference server (`server/`) and the PHP backend (`php/`). The Node server is the
reference: if a check fails against Node, the check is wrong.

No dependencies: Node 22+ (built-in `fetch`), nothing to install.

```bash
node php/tests/contract.mjs --base <url> --password <admin password> \
     [--viewer-password <viewer password>] [--skip-ratelimit]
```

| Option | Meaning |
| --- | --- |
| `--base` | Server origin, default `http://localhost:3001`. Must reach the server directly: the Origin (CSRF) checks compare against the `Host` header the server sees. |
| `--password` | `APP_PASSWORD` / `app_password` of the server. |
| `--viewer-password` | Optional. Enables the read-only viewer checks (the server must have the same viewer password). |
| `--skip-ratelimit` | Leave out the login rate-limit section. |

Exit code: `0` all checks passed, `1` at least one check failed, `2` aborted (server unreachable,
database not empty, login already rate limited, missing arguments).

## Preconditions

- **Fresh, empty database.** The suite asserts exact list contents and aborts if players, seasons,
  games or events already exist. Start every run with a new data directory.
- **Untouched login rate limiter.** The last section makes 5 failed logins and checks the 429, which
  locks the client IP out of `/api/auth/login` for 15 minutes; a run adds about 10 failures to the
  global counter (30 per 15 minutes). The Node server keeps this in memory (restart it); the PHP
  server keeps it in `<data_dir>/ratelimit.db` (a fresh data directory resets it). A second run
  without that reset aborts in the preflight with a clear message. Use `--skip-ratelimit` when
  you cannot reset.
- Session cookies can be `session` (cookie_secure off) or `__Host-session` (on); both are accepted.
  The test keeps its own cookie jar, so `__Host-session` also works over plain HTTP.

## Against the Node server

```bash
cd server && npm install && npm run build
rm -rf /tmp/contract-data
DATA_DIR=/tmp/contract-data APP_PASSWORD=devpassword VIEWER_PASSWORD=viewerpass123 \
  COOKIE_SECURE=false node dist/index.js &
cd .. && node php/tests/contract.mjs --base http://localhost:3001 \
  --password devpassword --viewer-password viewerpass123
kill %1
```

`npm run dev` / `npx tsx src/index.ts` works too where tsx can load `shared/types.ts`.

## Against the PHP backend

With PHP's built-in server (router script emulates the `.htaccess` rules):

```bash
rm -rf /tmp/contract-php-data
DATA_DIR=/tmp/contract-php-data APP_PASSWORD=devpassword VIEWER_PASSWORD=viewerpass123 \
  COOKIE_SECURE=false php -S localhost:8080 -t php/public php/public/router.php &
node php/tests/contract.mjs --base http://localhost:8080 \
  --password devpassword --viewer-password viewerpass123
kill %1
```

Or against Apache with the real `.htaccess` via `php/dev.sh` (port 8080), using a fresh data dir.

## What it covers

Health and config; login, session cookie attributes and format, tampered cookies, `me`, logout,
viewer read-only role; Origin/CSRF check (also before auth and on login); 256 KiB body limit
(also before auth, exact boundary); malformed/non-object/non-JSON bodies; players, seasons, games
and events CRUD with exact JSON shapes and types, ordering, filters, idempotent re-creates and
validation (each rule separately); score aggregation; event ordering; game deletion cascade;
unknown routes and wrong methods; security headers; login rate limit.

Checks named `[edge]` pin down details of the reference behaviour that are easy to get wrong in
PHP (string lengths in Unicode code points, JS `trim()` whitespace, `7.0` as an integer,
validation before the 404 lookup, `?status=` empty, trailing slash, unmatched `/api/auth/*`
paths without session).
