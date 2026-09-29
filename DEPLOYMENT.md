# Deployment

Recommended: a small VPS with Docker Compose and Caddy, which obtains and renews TLS certificates automatically.

## Requirements

- A Linux server with Docker and the Docker Compose plugin
- A domain name whose DNS A/AAAA record points to the server
- Ports 80 and 443 open (both are needed for certificate issuance)

## Setup

```bash
git clone <repository-url> statistics-tracker
cd statistics-tracker

cp .env.example .env
cp Caddyfile.example Caddyfile
```

Edit `.env`. Generate strong passwords:

```bash
openssl rand -base64 24    # use for APP_PASSWORD (and VIEWER_PASSWORD)
openssl rand -hex 32       # use for SESSION_SECRET (optional)
```

- `APP_PASSWORD`: admin password (required)
- `VIEWER_PASSWORD`: optional read-only password, must differ from `APP_PASSWORD`
- `SESSION_SECRET`: optional; if empty it is generated and stored in the data volume
- `CLUB_NAME`: optional, shown in the app (default `Handball Stats`)

Edit `Caddyfile` and replace `stats.example.org` with your domain. Then start:

```bash
docker compose up -d --build
docker compose ps                                  # app should become "healthy"
curl https://your-domain/api/health                # {"ok":true}
```

Open `https://your-domain/` and log in with `APP_PASSWORD`. Compose sets `TRUST_PROXY=true` and `COOKIE_SECURE=true` for the app; the app is also published on `127.0.0.1:3001` for local checks (`curl http://127.0.0.1:3001/api/health`).

Data lives in the Docker volume `handball-data` (mounted at `/data`, database `/data/handball.db`).

## Updates

```bash
git pull
docker compose up -d --build
```

The database schema is kept backwards compatible; existing data is preserved.

## Backups

The image includes a backup script that writes a consistent copy of the database with `VACUUM INTO` and keeps the newest 14 (`BACKUP_DIR` default `/data/backups`, `BACKUP_KEEP` default `14`):

```bash
docker compose exec app node dist/backup.js
```

Nightly at 03:00 via host cron (`crontab -e`), copying the backups out of the volume so they also live on the host:

```cron
0 3 * * * cd /path/to/statistics-tracker && docker compose exec -T app node dist/backup.js >/dev/null && docker compose cp app:/data/backups /path/to/offsite-or-backup-dir
```

Copy backups to a different machine or storage as well; a backup on the same disk does not protect against disk loss.

### Restore

```bash
docker compose stop app
docker compose cp /path/to/handball-YYYY-MM-DDTHH-MM-SS.db app:/data/handball.db
docker compose run --rm --no-deps -u root --entrypoint sh app -c 'rm -f /data/handball.db-wal /data/handball.db-shm /data/handball.db-journal; chown node:node /data/handball.db'
docker compose start app
```

## Rotating passwords and the secret

- Change `APP_PASSWORD` or `VIEWER_PASSWORD` in `.env`, then `docker compose up -d`. Sessions of that role are invalidated (users must log in again).
- Change `SESSION_SECRET` (or delete `/data/.session-secret` if you did not set one) and restart to log out everyone.

## Importing data from another instance

Use the admin API: log in via `POST /api/auth/login`, then create players, seasons, games and events with the `POST` endpoints. IDs you supply are preserved and inserts are idempotent, so a partial import can be safely re-run.

## PaaS hosting

Any platform that runs a Dockerfile works.

- Build from the repository root `Dockerfile`; the app listens on `PORT` (default 3001).
- Attach a persistent volume mounted at `/data`. Without it, data is lost on redeploy.
- Set `APP_PASSWORD` (and optionally `VIEWER_PASSWORD`, `SESSION_SECRET`, `CLUB_NAME`) as environment variables.
- Let the platform terminate TLS and set `TRUST_PROXY=true` and `COOKIE_SECURE=true`. Run a single instance (SQLite, in-memory login rate limit).
- Health check path: `/api/health`.

## Other reverse proxies

Run the app container with `TRUST_PROXY=true` and `COOKIE_SECURE=true`, and forward `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`. The proxy must overwrite, not pass through, client-supplied `X-Forwarded-*` headers. nginx:

```nginx
server {
    listen 443 ssl;
    server_name stats.example.org;
    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If not using the bundled Caddy service, remove it from `docker-compose.yml` (or run only `docker compose up -d app`).

## Troubleshooting

- **Login succeeds but you are immediately logged out / cookie not set**: the session cookie is `Secure` (HTTPS only) when `COOKIE_SECURE` is true, which is the default in the container. Over plain HTTP set `COOKIE_SECURE=false` in the app environment (test setups only), or use HTTPS.
- **429 on login**: too many failed attempts (5 per IP per 15 minutes, 30 globally). Wait for the `Retry-After` period, or restart the app to reset. Behind a proxy make sure `TRUST_PROXY=true`, otherwise all users share the proxy's IP.
- **403 on writes from the browser**: requests with an `Origin` that does not match the `Host` are rejected. Make sure the proxy passes the original `Host` header.
- **Certificate not issued**: check DNS, that ports 80/443 are reachable, and `docker compose logs caddy`.
- **`Permission denied` on `/data` with a bind mount**: the container runs as uid 1000 (`node`). Use `chown 1000:1000 ./data` on the host directory, or use the default named volume.
- **App exits at start**: `docker compose logs app`; typical causes are a missing `APP_PASSWORD` or `VIEWER_PASSWORD` equal to `APP_PASSWORD`.
