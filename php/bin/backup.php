<?php

declare(strict_types=1);

// Consistent online backup of the SQLite database using VACUUM INTO (command line only).
// Usage: php bin/backup.php [--keep=N]
// Writes DATA_DIR/backups/handball-YYYY-MM-DDTHH-MM-SS.db (UTC) and keeps the newest N (default 14).
// Env (optional, as for the Node server): BACKUP_DIR, BACKUP_KEEP; DATA_DIR / DB_PATH as in config.php.

if (isset($_SERVER['REQUEST_METHOD'])) {
	// Never run over HTTP (bin/.htaccess denies access as well).
	http_response_code(404);
	exit;
}

require __DIR__ . '/../src/bootstrap.php';

use Handball\Config;
use Handball\Db;

try {
	$config = Config::load(false);

	$keep = 14;
	$keepEnv = getenv('BACKUP_KEEP');
	if (is_string($keepEnv) && ctype_digit($keepEnv)) {
		$keep = (int) $keepEnv;
	}
	foreach (array_slice($argv ?? [], 1) as $arg) {
		if (preg_match('/^--keep=(\d+)$/D', $arg, $m) === 1) {
			$keep = (int) $m[1];
		} else {
			fwrite(STDERR, "Unknown argument: $arg\nUsage: php bin/backup.php [--keep=N]\n");
			exit(2);
		}
	}
	$keep = max(1, $keep);

	$backupDirEnv = getenv('BACKUP_DIR');
	$backupDir = is_string($backupDirEnv) && $backupDirEnv !== '' ? rtrim($backupDirEnv, '/') : $config->dataDir . '/backups';

	if (!is_file($config->dbPath)) {
		fwrite(STDERR, "Database not found: {$config->dbPath}\n");
		exit(1);
	}

	Config::ensureDir($backupDir);
	$target = $backupDir . '/handball-' . gmdate('Y-m-d\TH-i-s') . '.db';
	if (file_exists($target)) {
		fwrite(STDERR, "Backup already exists: $target\n");
		exit(1);
	}

	$pdo = Db::open($config->dbPath);
	Db::run('VACUUM INTO ?', [$target], $pdo);
	$pdo = null;
	echo "Backup written: $target\n";

	$backups = array_values(array_filter(
		scandir($backupDir) ?: [],
		static fn (string $f): bool => preg_match('/^handball-.*\.db$/D', $f) === 1
	));
	sort($backups, SORT_STRING);
	$old = array_slice($backups, 0, max(0, count($backups) - $keep));
	foreach ($old as $file) {
		unlink($backupDir . '/' . $file);
	}
	if ($old !== []) {
		echo 'Removed ' . count($old) . " old backup(s)\n";
	}
} catch (\Throwable $e) {
	fwrite(STDERR, 'Backup failed: ' . $e->getMessage() . "\n");
	exit(1);
}
