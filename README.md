# Handball Statistics Tracker

A web app for tracking handball games courtside in real time and analysing player and season statistics afterwards. Self-hosted: one small Node server, one SQLite file, one password.

## Features

- Live game tracking: goals with shot zones, saves, discipline, opponent events, undo
- Roster, seasons and game history
- Per-player and per-season statistics with charts (computed from the raw events)
- Two roles: admin (full access) and an optional read-only viewer
- German (default) and English UI
- Live tracking survives short connection drops: events are queued locally and re-sent

The app needs a connection to the server; there is no offline mode.

## Stack

- Client: SvelteKit 5 (static SPA, Svelte runes), Tailwind CSS v4 + DaisyUI, Chart.js
- Server: Hono on Node, SQLite via `@libsql/client`, zod validation
- Alternative server for shared hosting: plain PHP 8.2+ with PDO SQLite (`php/`), same API and database schema, no dependencies
- `shared/types.ts`: types and stat functions shared by client and server

## Development

Requires Node.js 22 or newer.

```bash
# Terminal 1: API server on http://localhost:3001
cd server
npm install
APP_PASSWORD=devpassword npm run dev

# Optional: fill a fresh database with fictional demo data
npm run seed:demo          # refuses to overwrite an existing DB; use -- --force to wipe

# Terminal 2: client on http://localhost:5173 (proxies /api to :3001)
cd client
npm install
npm run dev
```

Log in with the `APP_PASSWORD` you started the server with. Type checks: `npm run check` (client), `npm run typecheck` (server). There is no test runner or linter.

## Configuration

Set via environment variables (see `.env.example`). The PHP backend reads the same settings from `php/config.php` (see `php/config.example.php`).

| Variable | Default | Description |
| --- | --- | --- |
| `APP_PASSWORD` | required | Admin password. Use 12+ characters. |
| `VIEWER_PASSWORD` | empty | Optional read-only password. Must differ from `APP_PASSWORD`. |
| `SESSION_SECRET` | generated | Signs session cookies. If unset, generated and stored in `DATA_DIR/.session-secret`. |
| `CLUB_NAME` | `Handball Stats` | Name shown in the app (for example `HSG Schleswig`). |
| `PORT` | `3001` | Listen port. |
| `HOST` | `0.0.0.0` | Listen address. |
| `DATA_DIR` | `./data` | Directory for the database and generated secret. |
| `DB_PATH` | `DATA_DIR/handball.db` | SQLite file. |
| `STATIC_DIR` | `../client/build` | Built client served by the server. |
| `COOKIE_SECURE` | `true` if `NODE_ENV=production` | Send the session cookie over HTTPS only. |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For`/`X-Forwarded-Host` from a reverse proxy. Only enable behind one. |

## Deployment

Docker Compose with Caddy (automatic HTTPS) is the recommended setup. See [DEPLOYMENT.md](DEPLOYMENT.md).

Without a server, on shared web hosting with Apache and PHP (for example STRATO), use the PHP backend. See [DEPLOYMENT-STRATO.md](DEPLOYMENT-STRATO.md).

## Repository layout

```
client/   SvelteKit SPA
server/   Hono API + static file server, scripts/ (demo seed, backup)
php/      PHP twin of the API for shared hosting (build.sh, dev.sh, contract test)
shared/   types.ts shared by client and server
Dockerfile, docker-compose.yml, Caddyfile.example
```

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). If you run a modified version as a network service, you must offer its source to its users.
