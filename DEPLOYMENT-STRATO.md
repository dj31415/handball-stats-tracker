# Deployment on shared hosting (STRATO and similar)

For web hosting packages without Node or Docker, the repository contains a second backend in PHP (`php/`). It implements the same API and uses the same SQLite schema as the Node server, so the client is unchanged and a database file can move between both. The steps below use STRATO as the example; any host with Apache and PHP works the same way.

The Docker setup in [DEPLOYMENT.md](DEPLOYMENT.md) remains the recommended option when you have a server.

## Requirements

- PHP 8.2 or newer with PDO SQLite (`pdo_sqlite`); no Composer, no other extensions
- Apache 2.4 with `mod_rewrite` and `.htaccess` support (`mod_headers` is used when available)
- HTTPS for the domain (the session cookie is HTTPS-only by default)
- The app must be served at the root of a domain or subdomain (for example `https://stats.example.org/`), not in a sub-path
- SFTP access to the webspace
- To build: Node.js 22 or newer and bash on your own machine

## Build

```bash
git clone <repository-url> statistics-tracker
cd statistics-tracker
php/build.sh
```

This builds the client (`npm ci && npm run build` in `client/`) and assembles `php/dist/`:

```
dist/
  public/              document root: built client, .htaccess, api/index.php
  src/                 PHP code (not web-accessible)
  bin/backup.php       backup script (command line only)
  data/                database, generated secret, backups (not web-accessible)
  config.example.php
```

`dist/` never contains `config.php` or data.

## Upload

1. Upload the contents of `php/dist/` via SFTP into a new directory of the webspace, for example `/handball/`, so that `/handball/public`, `/handball/src`, `/handball/data` and so on exist.
2. In the hosting customer area, set the domain's (or subdomain's) target directory to `/handball/public`. Then `src/`, `data/` and `config.php` are outside the web root. The `.htaccess` files in `src/`, `bin/` and `data/` deny access as a second line of defence, should a directory end up inside the web root anyway.
3. Select PHP 8.2 or newer for the domain and enable HTTPS (SSL certificate and redirect from HTTP to HTTPS).

## Configuration

Copy `config.example.php` to `config.php` in the same directory (`/handball/config.php`, not inside `public/`) and edit it. Generate strong passwords locally:

```bash
openssl rand -base64 24    # use for app_password (and viewer_password)
openssl rand -hex 32       # use for session_secret (optional)
```

- `app_password`: admin password (required)
- `viewer_password`: optional read-only password, must differ from `app_password`
- `session_secret`: optional; if empty it is generated and stored in `data/.session-secret`
- `club_name`: optional, shown in the app (default `Handball Stats`)
- `data_dir`, `db_path`: optional; default `data/` next to `config.php` and `data/handball.db`
- `cookie_secure`: keep `true` (HTTPS). `trust_proxy`: keep `false` unless the host puts a reverse proxy in front of PHP that sets `X-Forwarded-For` (then all users would otherwise share one IP for the login rate limit)

`data/` must be writable for PHP. On STRATO, PHP runs with your account's permissions, so the default permissions of uploaded directories work; elsewhere set `chmod 750` (or `770`) as needed. PHP creates `handball.db`, `ratelimit.db` (login rate limit state) and `.session-secret` there on first use.

## First login

```bash
curl https://your-domain/api/health                # {"ok":true}
```

Open `https://your-domain/` and log in with `app_password`.

## Updates

```bash
git pull
php/build.sh
```

Upload `dist/public/`, `dist/src/` and `dist/bin/` again, replacing the old files (you may delete the old `public/_app/` first; stale files there are harmless). Never overwrite `data/` or `config.php`, and never leave copies such as `config.php.bak` or `config.php~` on the server: only `config.php` itself is protected from being served. The database schema is kept backwards compatible; existing data is preserved.

## Backups

`bin/backup.php` writes a consistent copy of the database with `VACUUM INTO` to `data/backups/handball-YYYY-MM-DDTHH-MM-SS.db` and keeps the newest 14 (`--keep=N` to change). It runs only from the command line, never over HTTP.

- If your package has cronjobs, add a daily job that runs `/handball/bin/backup.php` with PHP 8.2 or newer.
- Download `data/backups/` regularly via SFTP; a backup on the same webspace does not protect against losing the account.
- Without cronjobs, download `data/handball.db` via SFTP while nobody is tracking a game (if a `handball.db-journal` file exists, a write is in progress; download again later).

### Restore

Upload the backup as `data/handball.db`, replacing the old file, and delete `data/handball.db-journal`, `data/handball.db-wal` and `data/handball.db-shm` if present.

## Importing the database from the Node deployment

Both backends use the same schema, so the SQLite file can be copied as it is:

```bash
# On the Docker host: write a consistent copy and fetch it
docker compose exec app node dist/backup.js
docker compose cp app:/data/backups/handball-YYYY-MM-DDTHH-MM-SS.db ./handball.db
```

Upload it as `data/handball.db` (before the first login, or replacing the existing file) and make sure no `handball.db-wal`, `handball.db-shm` or `handball.db-journal` file is next to it. If you copy the live `/data/handball.db` instead of a backup, stop the app first so its `-wal` file is checkpointed into the database. Everyone has to log in again unless you also copy the `SESSION_SECRET` (or `/data/.session-secret`) into `session_secret` and keep the same passwords.

## Rotating passwords and the secret

- Change `app_password` or `viewer_password` in `config.php`. Sessions of that role are invalidated (users must log in again).
- Change `session_secret` (or delete `data/.session-secret` if you did not set one) to log out everyone.

## Local testing

`php/dev.sh` runs the PHP backend in Docker (Apache with the real `.htaccess` files) on `http://localhost:8080` with `APP_PASSWORD=devpassword`; see the comments in the script and [php/README.md](php/README.md).

## Troubleshooting

- **500 with `{"error":"internal"}` on every API request**: `config.php` is missing or `app_password` is empty, `viewer_password` equals `app_password`, or `data/` is not writable. The PHP error log (customer area, or the host's log directory) has a line starting with `[handball]` naming the cause.
- **404 (an HTML page, not JSON) on `/api/...`, or reloading a page such as `/games` gives 404**: `.htaccess` files are not applied. Check that `mod_rewrite` is available and `.htaccess` overrides are allowed (`AllowOverride All`), and that the hidden `.htaccess` files were uploaded (some SFTP clients skip dot files).
- **500 for every request including the start page**: the host does not allow a directive used in `public/.htaccess`; the web server error log names it.
- **Login succeeds but you are immediately logged out / cookie not set**: the session cookie is `Secure` (HTTPS only) while `cookie_secure` is `true`. Use HTTPS. Set `cookie_secure` to `false` only for local tests over plain HTTP.
- **429 on login**: too many failed attempts (5 per IP per 15 minutes, 30 globally). Wait for the `Retry-After` period, or delete `data/ratelimit.db` to reset.
- **403 on writes from the browser**: requests with an `Origin` that does not match the `Host` are rejected. Open the app under the same domain the requests go to.
- **The app is reachable under a sub-path only**: not supported; the client is built for `/`. Use a subdomain instead.
