<?php

declare(strict_types=1);

// SQLite access and row mapping. Mirrors server/src/db.ts and server/src/rows.ts.
// The schema must stay identical to server/src/db.ts so one database file works with both backends.

namespace Handball;

\defined('HANDBALL_APP') || exit;

final class Db
{
	private static ?\PDO $pdo = null;

	private const SCHEMA = <<<'SQL'
		CREATE TABLE IF NOT EXISTS players (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			number INTEGER NOT NULL,
			position TEXT NOT NULL,
			is_active INTEGER NOT NULL DEFAULT 1
		);

		CREATE TABLE IF NOT EXISTS seasons (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			start_date TEXT NOT NULL,
			end_date TEXT NOT NULL DEFAULT ''
		);

		CREATE TABLE IF NOT EXISTS games (
			id TEXT PRIMARY KEY,
			season_id TEXT NOT NULL,
			date TEXT NOT NULL,
			opponent TEXT NOT NULL,
			is_home INTEGER NOT NULL DEFAULT 1,
			location TEXT NOT NULL DEFAULT '',
			notes TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'finished',
			FOREIGN KEY (season_id) REFERENCES seasons(id)
		);

		CREATE TABLE IF NOT EXISTS game_rosters (
			game_id TEXT NOT NULL,
			player_id TEXT NOT NULL,
			PRIMARY KEY (game_id, player_id),
			FOREIGN KEY (game_id) REFERENCES games(id),
			FOREIGN KEY (player_id) REFERENCES players(id)
		);

		CREATE TABLE IF NOT EXISTS game_events (
			id TEXT PRIMARY KEY,
			game_id TEXT NOT NULL,
			player_id TEXT,
			timestamp TEXT NOT NULL,
			half INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			shot_zone TEXT,
			FOREIGN KEY (game_id) REFERENCES games(id),
			FOREIGN KEY (player_id) REFERENCES players(id)
		);

		CREATE INDEX IF NOT EXISTS idx_events_game ON game_events(game_id);
		CREATE INDEX IF NOT EXISTS idx_events_player ON game_events(player_id);
		CREATE INDEX IF NOT EXISTS idx_rosters_game ON game_rosters(game_id);
SQL;

	/** Objects created by SCHEMA; initDB() runs only when one of them is missing. */
	private const SCHEMA_OBJECTS = [
		'players',
		'seasons',
		'games',
		'game_rosters',
		'game_events',
		'idx_events_game',
		'idx_events_player',
		'idx_rosters_game',
	];

	/** The application database (opened on first use, schema created if needed). */
	public static function get(): \PDO
	{
		if (self::$pdo === null) {
			$pdo = self::open(Config::get()->dbPath);
			self::initDB($pdo);
			self::$pdo = $pdo;
		}
		return self::$pdo;
	}

	/** Opens (and creates) an SQLite file with the settings used for every connection. */
	public static function open(string $path): \PDO
	{
		Config::ensureDir(\dirname($path));
		$pdo = new \PDO('sqlite:' . $path, null, null, [
			\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
			\PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
			\PDO::ATTR_TIMEOUT => 5,
		]);
		// Wait for concurrent writers instead of failing with SQLITE_BUSY.
		$pdo->exec('PRAGMA busy_timeout = 5000');
		$pdo->exec('PRAGMA foreign_keys = OFF');
		// The journal mode is left as it is (rollback journal for new files): WAL needs shared
		// memory, which is not reliable on the network file systems shared hosts often use.
		return $pdo;
	}

	public static function initDB(\PDO $pdo): void
	{
		$stmt = $pdo->prepare(
			'SELECT COUNT(*) FROM sqlite_master WHERE name IN (' . placeholders(\count(self::SCHEMA_OBJECTS)) . ')'
		);
		$stmt->execute(self::SCHEMA_OBJECTS);
		if ((int) $stmt->fetchColumn() === \count(self::SCHEMA_OBJECTS)) {
			return;
		}
		$pdo->exec(self::SCHEMA);
	}

	// ── Query helpers (prepared statements only) ──

	/**
	 * @param list<string|int|bool|null> $args
	 * @return list<array<string, mixed>>
	 */
	public static function all(string $sql, array $args = []): array
	{
		return self::run($sql, $args)->fetchAll();
	}

	/**
	 * @param list<string|int|bool|null> $args
	 * @return array<string, mixed>|null
	 */
	public static function one(string $sql, array $args = []): ?array
	{
		$row = self::run($sql, $args)->fetch();
		return \is_array($row) ? $row : null;
	}

	/** @param list<string|int|bool|null> $args */
	public static function run(string $sql, array $args = [], ?\PDO $pdo = null): \PDOStatement
	{
		$stmt = ($pdo ?? self::get())->prepare($sql);
		foreach (array_values($args) as $i => $value) {
			$type = match (true) {
				$value === null => \PDO::PARAM_NULL,
				\is_int($value) => \PDO::PARAM_INT,
				\is_bool($value) => \PDO::PARAM_INT,
				default => \PDO::PARAM_STR,
			};
			$stmt->bindValue($i + 1, \is_bool($value) ? (int) $value : $value, $type);
		}
		$stmt->execute();
		return $stmt;
	}

	/**
	 * Runs $fn inside a write transaction (BEGIN IMMEDIATE takes the write lock up front,
	 * so concurrent writers wait via busy_timeout instead of failing mid-transaction).
	 *
	 * @template T
	 * @param callable(): T $fn
	 * @return T
	 */
	public static function transaction(callable $fn, ?\PDO $pdo = null): mixed
	{
		$pdo ??= self::get();
		$pdo->exec('BEGIN IMMEDIATE');
		try {
			$result = $fn();
			$pdo->exec('COMMIT');
			return $result;
		} catch (\Throwable $e) {
			try {
				$pdo->exec('ROLLBACK');
			} catch (\Throwable) {
				// keep the original error
			}
			throw $e;
		}
	}

	// ── Row mapping (rows.ts); is_home is stored as 0/1 ──

	/** @param array<string, mixed> $r */
	public static function toPlayer(array $r): array
	{
		return [
			'id' => (string) $r['id'],
			'name' => (string) $r['name'],
			'number' => (int) $r['number'],
			'position' => (string) $r['position'],
			'is_active' => (int) $r['is_active'],
		];
	}

	/** @param array<string, mixed> $r */
	public static function toSeason(array $r): array
	{
		return [
			'id' => (string) $r['id'],
			'name' => (string) $r['name'],
			'start_date' => (string) $r['start_date'],
			'end_date' => (string) $r['end_date'],
		];
	}

	/** @param array<string, mixed> $r */
	public static function toGame(array $r): array
	{
		return [
			'id' => (string) $r['id'],
			'season_id' => (string) $r['season_id'],
			'date' => (string) $r['date'],
			'opponent' => (string) $r['opponent'],
			'is_home' => (bool) (int) $r['is_home'],
			'location' => (string) $r['location'],
			'notes' => (string) $r['notes'],
			'status' => (string) $r['status'],
		];
	}

	/** @param array<string, mixed> $r */
	public static function toGameListItem(array $r): array
	{
		return self::toGame($r) + [
			'own_score' => (int) $r['own_score'],
			'opp_score' => (int) $r['opp_score'],
		];
	}

	/** @param array<string, mixed> $r */
	public static function toEvent(array $r): array
	{
		return [
			'id' => (string) $r['id'],
			'game_id' => (string) $r['game_id'],
			'player_id' => $r['player_id'] === null ? null : (string) $r['player_id'],
			'timestamp' => (string) $r['timestamp'],
			'half' => (int) $r['half'],
			'event_type' => (string) $r['event_type'],
			'shot_zone' => $r['shot_zone'] === null ? null : (string) $r['shot_zone'],
		];
	}

	/**
	 * @param list<array<string, mixed>> $rows
	 * @param callable(array<string, mixed>): array<string, mixed> $map
	 * @return list<array<string, mixed>>
	 */
	public static function mapRows(array $rows, callable $map): array
	{
		return array_values(array_map($map, $rows));
	}
}
