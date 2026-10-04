<?php

// Copy to config.php (next to this file, outside the web root) and fill in.
// Environment variables with the upper-case names (APP_PASSWORD, ...) override these values.
// Generate passwords and the secret with:  openssl rand -base64 24  /  openssl rand -hex 32

return [
	// Required: admin password (full access). Use 12+ characters.
	'app_password' => '',

	// Optional: read-only viewer password. Must differ from app_password.
	'viewer_password' => '',

	// Optional: secret for signing session cookies. If empty, one is generated
	// and stored in data_dir/.session-secret.
	'session_secret' => '',

	// Club name shown in the app.
	'club_name' => 'Handball Stats',

	// Directory for the database, the generated secret and backups.
	// Empty: the data/ directory next to this file. Relative paths are relative to this file.
	'data_dir' => '',

	// SQLite file. Empty: data_dir/handball.db
	'db_path' => '',

	// Send the session cookie over HTTPS only (cookie name __Host-session).
	// Set to false only for local tests over plain HTTP.
	'cookie_secure' => true,

	// Trust X-Forwarded-For / X-Forwarded-Host. Only enable behind a reverse proxy that sets them.
	'trust_proxy' => false,
];
