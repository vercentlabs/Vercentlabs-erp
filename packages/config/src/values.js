const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export class ConfigurationError extends Error {
  constructor(issues) {
    super(`Invalid configuration:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "ConfigurationError";
    this.issues = Object.freeze([...issues]);
  }
}

export function stringValue(environment, name, options = {}) {
  const value = String(environment[name] ?? "").trim();
  if (!value && options.required) throw new ConfigurationError([`${name} is required.`]);
  if (value && options.minimumLength && value.length < options.minimumLength) {
    throw new ConfigurationError([`${name} must contain at least ${options.minimumLength} characters.`]);
  }
  return value || options.defaultValue || "";
}

export function integerValue(environment, name, options = {}) {
  const raw = String(environment[name] ?? options.defaultValue ?? "").trim();
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new ConfigurationError([`${name} must be an integer.`]);
  if (options.minimum !== undefined && value < options.minimum)
    throw new ConfigurationError([`${name} must be at least ${options.minimum}.`]);
  if (options.maximum !== undefined && value > options.maximum)
    throw new ConfigurationError([`${name} must be at most ${options.maximum}.`]);
  return value;
}

export function booleanValue(environment, name, defaultValue = false) {
  const raw = String(environment[name] ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new ConfigurationError([`${name} must be true or false.`]);
}

export function originList(environment, name, options = {}) {
  const raw = stringValue(environment, name, options);
  if (!raw) return [];
  const origins = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  const issues = [];
  const normalized = [];
  for (const entry of origins) {
    try {
      const parsed = new URL(entry);
      if (parsed.origin !== entry || (options.httpsOnly && parsed.protocol !== "https:")) throw new Error();
      normalized.push(parsed.origin);
    } catch {
      issues.push(`${name} contains an invalid origin: ${entry}`);
    }
  }
  if (issues.length) throw new ConfigurationError(issues);
  return [...new Set(normalized)];
}

export function databaseConfig(environment, options = {}) {
  const name = options.name || "DATABASE_URL";
  const connectionString = stringValue(environment, name, { required: true });
  const issues = [];
  try {
    const parsed = new URL(connectionString);
    if (!POSTGRES_PROTOCOLS.has(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) throw new Error();
  } catch {
    issues.push(`${name} must be a valid PostgreSQL connection URL.`);
  }
  if (issues.length) throw new ConfigurationError(issues);
  return Object.freeze({
    connectionString,
    poolMaximum: integerValue(environment, "DATABASE_POOL_MAX", { defaultValue: options.defaultPoolMaximum ?? 12, minimum: 1, maximum: 100 }),
    idleTimeoutMilliseconds: integerValue(environment, "DATABASE_IDLE_TIMEOUT_MS", { defaultValue: 30_000, minimum: 1_000, maximum: 600_000 }),
    connectionTimeoutMilliseconds: integerValue(environment, "DATABASE_CONNECTION_TIMEOUT_MS", { defaultValue: 5_000, minimum: 500, maximum: 60_000 }),
    statementTimeoutMilliseconds: integerValue(environment, "DATABASE_STATEMENT_TIMEOUT_MS", { defaultValue: 15_000, minimum: 1_000, maximum: 300_000 }),
    queryTimeoutMilliseconds: integerValue(environment, "DATABASE_QUERY_TIMEOUT_MS", { defaultValue: 20_000, minimum: 1_000, maximum: 300_000 }),
  });
}
