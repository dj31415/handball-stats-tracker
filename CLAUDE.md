# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Handball Statistics Tracker: a web app (static SPA + REST API) for tracking handball games courtside in real time and analysing statistics. It is online-only, with no offline mode and no service worker. Monorepo with four modules: `client/`, `server/` (Node API), `php/` (PHP twin of the API for shared hosting), `shared/`. The repository is public (AGPL-3.0-only): never commit hostnames, IPs, credentials, personal data or real club data.

## Commands

```bash
# Server (Hono + SQLite) — http://localhost:3001
cd server && npm install
APP_PASSWORD=devpassword npm run dev   # tsx watch
npm run typecheck                      # tsc --noEmit
npm run build                          # esbuild -> dist/index.js and dist/backup.js
npm run start                          # node dist/index.js
npm run seed:demo                      # fictional demo data; refuses if DB exists, -- --force wipes
npm run backup                         # VACUUM INTO backup (BACKUP_DIR, BACKUP_KEEP)

# Client (SvelteKit 5, static adapter) — http://localhost:5173, /api proxied to :3001
cd client && npm install
npm run dev
npm run check                          # svelte-check + TypeScript
npm run build                          # static build to client/build

# Docker
docker compose up -d --build           # app + Caddy (needs .env and Caddyfile)

# PHP backend (needs Docker, not a local PHP) — http://localhost:8080
php/dev.sh                             # Apache + real .htaccess, APP_PASSWORD=devpassword; stop|logs|builtin|lint
php/dev.sh lint                        # php -l on all PHP files (8.2 and 8.3)
php/build.sh                           # client build + php/dist/ bundle for upload
node php/tests/contract.mjs --base http://localhost:8080 --password devpassword   # fresh data dir; also runs against :3001
```

No test runner or linter is configured. Type safety relies on `strict` TypeScript, `svelte-check` and `tsc`. `php/tests/contract.mjs` is a black-box API contract test that must pass against both backends.

## Architecture

- **Client**: SvelteKit 5, Svelte 5 runes (`$state`, `$derived`, `$effect`; not legacy `$:`), adapter-static SPA (`ssr = false`), Tailwind CSS v4 + DaisyUI, Chart.js.
- **Server**: Hono + `@libsql/client` (SQLite), zod validation. In production it serves the API and the built client (`STATIC_DIR`) from one origin over plain HTTP; TLS is terminated by a reverse proxy (Caddy).
- **Shared**: `shared/types.ts` is the single source of truth for enums, interfaces and stat functions (`computePlayerStats`, `teamScore`). Never add compiled `.js`/`.d.ts` files next to it.
- **Data access**: `client/src/lib/api.ts` is the only fetch layer (relative URLs, same-origin cookies, 401 redirects to `/login`).
- **Outbox**: only the live game page queues writes (`client/src/lib/outbox.svelte.ts`), persisted in localStorage and retried with backoff so short connection drops do not lose events. Everything else calls the API directly.
- **Stats** are computed client-side from events via `shared/types.ts`; nothing derived is stored.
- **IDs** are generated on the client (`client/src/lib/id.ts`, `crypto.randomUUID()` with a fallback for plain HTTP), and inserts are idempotent (`INSERT OR IGNORE`), so retries are safe.
- Live tracking is a single-device workflow; two devices tracking the same game is out of scope.
- **PHP backend** (`php/`): plain PHP 8.2+ with PDO SQLite, no Composer and no dependencies, for Apache shared hosting (STRATO). `public/` is the document root (`.htaccess` routes `/api/*` to `api/index.php`, serves the built client with SPA fallback); code in `src/` mirrors `server/src` file by file. Config from `php/config.php`, env vars override. Both backends must keep the API contract (paths, status codes, JSON shapes and types, error codes, validation rules) and the SQLite schema identical: change them together and run the contract test against both. Login rate-limit state lives in a separate `ratelimit.db`, never in the main database.

### Auth model

- `APP_PASSWORD` (admin, required) and optional `VIEWER_PASSWORD` (read-only; must differ).
- `POST /api/auth/login` sets a signed httpOnly, SameSite=Strict session cookie (`__Host-session` when `COOKIE_SECURE`, else `session`), 30-day sliding. Changing a role's password invalidates that role's sessions.
- All `/api/*` except `health`, `config` and `auth/*` require a session (401). Viewers get 403 on any non-GET. Non-GET requests with a mismatching `Origin` are rejected.
- Login is rate limited (5 failures per IP per 15 min, 30 global) with 429.
- The SPA shell is public and contains no data.

### API (all under `/api`)

`GET health`, `GET config` (`{club_name}`), `POST auth/login|logout`, `GET auth/me`, `players` (GET, POST, PATCH/:id, DELETE/:id; 409 `player_has_data`), `seasons` (GET, POST), `games` (GET list, GET/:id, POST, PATCH/:id, DELETE/:id), `POST games/:id/events`, `DELETE games/:id/events?ids=`, `GET events`. Errors are JSON `{error, ...}`. Exact shapes live in `shared/types.ts` and `server/src/routes/`.

### Database

SQLite at `DB_PATH` (default `DATA_DIR/handball.db`), schema created by `initDB()` in `server/src/db.ts` with `CREATE TABLE IF NOT EXISTS` (copied verbatim into `php/src/Db.php`). Existing databases must keep opening unchanged: schema changes in future must be migrations guarded by `PRAGMA user_version`, never destructive. Foreign keys are off.

### Environment variables

`APP_PASSWORD` (required), `VIEWER_PASSWORD`, `SESSION_SECRET` (else generated in `DATA_DIR/.session-secret`), `CLUB_NAME` (default "Handball Stats"), `PORT` (3001), `HOST`, `DATA_DIR`, `DB_PATH`, `STATIC_DIR`, `COOKIE_SECURE` (default true when `NODE_ENV=production`), `TRUST_PROXY` (default false; enable only behind a proxy). See `.env.example` and `server/src/config.ts`.

### Docker

Multi-stage `Dockerfile` (client build, server bundle, slim runtime running as `node` with data in `/data`). `docker-compose.yml` runs the app plus Caddy (`Caddyfile` copied from `Caddyfile.example`, git-ignored). Deployment guide: `DEPLOYMENT.md`. Shared hosting with the PHP backend: `DEPLOYMENT-STRATO.md`.

## I18n

Custom type-safe i18n in `client/src/lib/i18n/`. German is the default language. Translation keys are compile-time checked. Add every string to both `de.ts` and `en.ts`.
