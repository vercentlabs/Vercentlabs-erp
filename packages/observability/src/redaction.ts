/**
 * Field-name fragments that must never reach a log line or trace attribute in
 * clear text. Matching is case-insensitive and matches on substring, so
 * `userPassword`, `PASSWORD_HASH` and `dbPasswordConfirm` are all caught.
 */
export const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'secret',
  'token',
  'authorization',
  'apikey',
  'api_key',
  'credential',
  'privatekey',
  'private_key',
  'sessionid',
  'session_id',
  'cookie',
  'ssn',
  'creditcard',
  'credit_card',
  'cvv',
  'clientsecret',
  'client_secret',
] as const;

export const REDACTED_PLACEHOLDER = '[REDACTED]';

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/** Pino redaction paths for the fields most likely to appear on log bindings. */
export const PINO_REDACT_PATHS = [
  'password',
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.accessToken',
  '*.refreshToken',
  '*.clientSecret',
];

/**
 * Deep-clones `value` and replaces any object key matching
 * {@link isSensitiveKey} with {@link REDACTED_PLACEHOLDER}. Used for logging
 * or forwarding arbitrary payloads (webhooks, event bodies) that pino's
 * static redact paths cannot anticipate.
 */
export function redactSensitiveFields<T>(value: T): T {
  return redactRecursive(value, new WeakSet()) as T;
}

function redactRecursive(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactRecursive(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = isSensitiveKey(key) ? REDACTED_PLACEHOLDER : redactRecursive(val, seen);
  }
  return result;
}
