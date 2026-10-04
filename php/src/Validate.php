<?php

declare(strict_types=1);

// Request validation mirroring the zod schemas of the Node server.
// Failures answer 400 {"error":"invalid","details":[{code, path, message}, ...]};
// a body that is not valid JSON answers details "Malformed JSON in request body" like Hono.

namespace Handball;

\defined('HANDBALL_APP') || exit;

/** Characters removed by JavaScript's String.prototype.trim() (zod's .trim()). */
const JS_WHITESPACE = '\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';

function js_trim(string $value): string
{
	$trimmed = preg_replace('/^[' . JS_WHITESPACE . ']+|[' . JS_WHITESPACE . ']+$/uD', '', $value);
	return $trimmed ?? $value;
}

/** String length in Unicode code points, as zod's min/max count it (no mbstring needed). */
function str_length(string $value): int
{
	// Code points = bytes that are not UTF-8 continuation bytes (json_decode guarantees valid UTF-8).
	return \strlen($value) - (int) preg_match_all('/[\x80-\xBF]/', $value);
}

final class Validator
{
	/** Same rule as Hono's validator: other content types are validated as an empty object. */
	private const JSON_CONTENT_TYPE = '/^application\/([a-z-\.]+\+)?json(;\s*[a-zA-Z0-9\-]+\=([^;]+))*$/D';

	/** @var \ArrayObject<int, array{code: string, path: list<string|int>, message: string}> */
	private \ArrayObject $issues;

	/** @var array<string, mixed>|null fields of the validated object, null if it is not an object */
	private ?array $fields = null;

	/** @param list<string|int> $path */
	public function __construct(mixed $data, private readonly array $path = [], ?\ArrayObject $issues = null)
	{
		$this->issues = $issues ?? new \ArrayObject();
		if ($data instanceof \stdClass) {
			$this->fields = get_object_vars($data);
		} else {
			$this->issue($path, 'invalid_type', 'Invalid input: expected object, received ' . self::typeName($data));
		}
	}

	/** Validator for the JSON request body (which must be an object). */
	public static function jsonBody(Request $req): self
	{
		$contentType = $req->header('content-type');
		if ($contentType === null || preg_match(self::JSON_CONTENT_TYPE, $contentType) !== 1) {
			return new self(new \stdClass());
		}
		try {
			$data = json_decode($req->body(BODY_LIMIT), false, 512, JSON_THROW_ON_ERROR);
		} catch (\JsonException) {
			// Same body as Hono's validator (details is a string here).
			throw new HttpException(Response::error(400, 'invalid', ['details' => 'Malformed JSON in request body']));
		}
		return new self($data);
	}

	/** Validator for query parameters (repeated keys become arrays and fail string checks). */
	public static function query(Request $req): self
	{
		$data = new \stdClass();
		foreach ($req->query as $name => $values) {
			if ($name === '' || str_contains($name, "\0")) {
				continue; // not a valid property name, and never a known parameter
			}
			$data->{$name} = \count($values) === 1 ? $values[0] : $values;
		}
		return new self($data);
	}

	/** Child validator for a nested object, sharing this validator's issue list. */
	public function nested(mixed $data, array $path): self
	{
		return new self($data, $path, $this->issues);
	}

	/** Throws 400 if any check failed. */
	public function check(): void
	{
		if (\count($this->issues) > 0) {
			throw new HttpException(Response::error(400, 'invalid', ['details' => $this->issues->getArrayCopy()]));
		}
	}

	// ── Field checks: return the (possibly trimmed) value, or null when absent or invalid ──

	public function string(
		string $key,
		int $min = 0,
		?int $max = null,
		bool $trim = false,
		bool $optional = false,
		bool $nullable = false,
	): ?string {
		$field = $this->field($key, $optional);
		return $field === null ? null : $this->checkString($field[0], $field[1], $min, $max, $trim, $nullable);
	}

	public function int(string $key, int $min, int $max, bool $optional = false): ?int
	{
		$field = $this->field($key, $optional);
		if ($field === null) {
			return null;
		}
		[$value, $path] = $field;
		$int = self::toInt($value);
		if ($int === null) {
			$this->issue($path, 'invalid_type', 'Invalid input: expected int, received ' . self::typeName($value));
			return null;
		}
		if ($int < $min) {
			$this->issue($path, 'too_small', "Too small: expected number to be >=$min");
		}
		if ($int > $max) {
			$this->issue($path, 'too_big', "Too big: expected number to be <=$max");
		}
		return $int;
	}

	/** @param list<int> $allowed numeric literals, e.g. [0, 1] */
	public function literal(string $key, array $allowed, bool $optional = false): ?int
	{
		$field = $this->field($key, $optional);
		if ($field === null) {
			return null;
		}
		[$value, $path] = $field;
		$int = self::toInt($value);
		if ($int === null || !\in_array($int, $allowed, true)) {
			$this->issue($path, 'invalid_value', 'Invalid input: expected ' . implode(' | ', $allowed));
			return null;
		}
		return $int;
	}

	public function bool(string $key, bool $optional = false): ?bool
	{
		$field = $this->field($key, $optional);
		if ($field === null) {
			return null;
		}
		[$value, $path] = $field;
		if (!\is_bool($value)) {
			$this->issue($path, 'invalid_type', 'Invalid input: expected boolean, received ' . self::typeName($value));
			return null;
		}
		return $value;
	}

	/** @param list<string> $allowed */
	public function enum(string $key, array $allowed, bool $optional = false, bool $nullable = false): ?string
	{
		$field = $this->field($key, $optional);
		if ($field === null) {
			return null;
		}
		[$value, $path] = $field;
		if ($value === null && $nullable) {
			return null;
		}
		if (!\is_string($value) || !\in_array($value, $allowed, true)) {
			$this->issue($path, 'invalid_value', 'Invalid option: expected one of ' . implode('|', array_map(
				static fn (string $v): string => '"' . $v . '"',
				$allowed
			)));
			return null;
		}
		return $value;
	}

	/**
	 * An array whose items are checked by $item(value, path).
	 *
	 * @param callable(mixed, list<string|int>): mixed $item
	 * @return list<mixed>|null
	 */
	public function list(string $key, int $min, int $max, callable $item, bool $optional = false): ?array
	{
		$field = $this->field($key, $optional);
		if ($field === null) {
			return null;
		}
		[$value, $path] = $field;
		if (!\is_array($value)) {
			$this->issue($path, 'invalid_type', 'Invalid input: expected array, received ' . self::typeName($value));
			return null;
		}
		$count = \count($value);
		if ($count < $min) {
			$this->issue($path, 'too_small', "Too small: expected array to have >=$min items");
		}
		if ($count > $max) {
			$this->issue($path, 'too_big', "Too big: expected array to have <=$max items");
		}
		$result = [];
		foreach (array_values($value) as $i => $itemValue) {
			$result[] = $item($itemValue, [...$path, $i]);
		}
		return $result;
	}

	/** @param list<string|int> $path */
	public function checkString(
		mixed $value,
		array $path,
		int $min = 0,
		?int $max = null,
		bool $trim = false,
		bool $nullable = false,
	): ?string {
		if ($value === null && $nullable) {
			return null;
		}
		if (!\is_string($value)) {
			$this->issue($path, 'invalid_type', 'Invalid input: expected string, received ' . self::typeName($value));
			return null;
		}
		if ($trim) {
			$value = js_trim($value);
		}
		$length = str_length($value);
		if ($length < $min) {
			$this->issue($path, 'too_small', "Too small: expected string to have >=$min characters");
		}
		if ($max !== null && $length > $max) {
			$this->issue($path, 'too_big', "Too big: expected string to have <=$max characters");
		}
		return $value;
	}

	// ── Internals ──

	/**
	 * The field's value and path, or null when it is absent (recording an issue unless optional)
	 * or when the container itself is not an object (already recorded).
	 *
	 * @return array{0: mixed, 1: list<string|int>}|null
	 */
	private function field(string $key, bool $optional): ?array
	{
		if ($this->fields === null) {
			return null;
		}
		$path = [...$this->path, $key];
		if (!\array_key_exists($key, $this->fields)) {
			if (!$optional) {
				$this->issue($path, 'invalid_type', 'Invalid input: expected a value, received undefined');
			}
			return null;
		}
		return [$this->fields[$key], $path];
	}

	/** Integer value of a JSON number with no fractional part (1 and 1.0 alike), else null. */
	private static function toInt(mixed $value): ?int
	{
		if (\is_int($value)) {
			return $value;
		}
		if (\is_float($value) && is_finite($value) && floor($value) === $value && abs($value) <= 9007199254740991) {
			return (int) $value;
		}
		return null;
	}

	private static function typeName(mixed $value): string
	{
		return match (true) {
			$value === null => 'null',
			\is_bool($value) => 'boolean',
			\is_int($value), \is_float($value) => 'number',
			\is_string($value) => 'string',
			\is_array($value) => 'array',
			default => 'object',
		};
	}

	/** @param list<string|int> $path */
	private function issue(array $path, string $code, string $message): void
	{
		$this->issues[] = ['code' => $code, 'path' => $path, 'message' => $message];
	}
}
