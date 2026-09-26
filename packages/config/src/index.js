const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

/**
 * Canonical Google Workspace identities for Vercentlabs.
 *
 * Keep customer-facing copy and automated delivery on role accounts so the
 * company does not expose a founder's mailbox or lose continuity as the team
 * grows. `sales` is the primary B2B contact; the other addresses own their
 * respective operational or regulated workflows.
 */
export const WORKSPACE_EMAILS = Object.freeze({
  primary: "sales@vercentlabs.com",
  sales: "sales@vercentlabs.com",
  support: "support@vercentlabs.com",
  privacy: "privacy@vercentlabs.com",
  security: "security@vercentlabs.com",
  careers: "careers@vercentlabs.com",
  billing: "billing@vercentlabs.com",
  authentication: "auth@vercentlabs.com",
  operations: "operations@vercentlabs.com",
  dmarc: "dmarc@vercentlabs.com",
});

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

export function validateRuntimeEnvironment(target, environment = process.env) {
  const production = environment.NODE_ENV === "production";
  const result = { target, production };
  if (target === "web" || target === "worker") {
    result.database = databaseConfig(environment);
    result.appUrl = stringValue(environment, "APP_URL", { required: production });
    result.allowedOrigins = originList(environment, "FORM_ALLOWED_ORIGINS", { required: production, httpsOnly: production });
    if (target === "worker") {
      result.worker = {
        enabled: booleanValue(environment, "WORKER_ENABLED", true),
        concurrency: integerValue(environment, "WORKER_CONCURRENCY", { defaultValue: 4, minimum: 1, maximum: 32 }),
        pollIntervalMilliseconds: integerValue(environment, "WORKER_POLL_INTERVAL_MS", { defaultValue: 5_000, minimum: 500, maximum: 60_000 }),
        leaseMilliseconds: integerValue(environment, "WORKER_LEASE_MS", { defaultValue: 120_000, minimum: 5_000, maximum: 3_600_000 }),
        batchSize: integerValue(environment, "WORKER_BATCH_SIZE", { defaultValue: 10, minimum: 1, maximum: 100 }),
        schedulerTickMilliseconds: integerValue(environment, "WORKER_SCHEDULER_TICK_MS", { defaultValue: 300_000, minimum: 30_000, maximum: 3_600_000 }),
        webhookTimeoutMilliseconds: integerValue(environment, "WORKER_WEBHOOK_TIMEOUT_MS", { defaultValue: 10_000, minimum: 1_000, maximum: 60_000 }),
        allowPrivateWebhookTargets: booleanValue(environment, "WORKER_ALLOW_PRIVATE_WEBHOOK_TARGETS", false),
        // Platform billing maintenance (webhook processing, checkout/seat/cancellation recovery, reconciliation).
        billingMaintenanceEnabled: booleanValue(environment, "BILLING_MAINTENANCE_ENABLED", true),
        billingMaintenanceIntervalMilliseconds: integerValue(environment, "BILLING_MAINTENANCE_INTERVAL_MS", { defaultValue: 15_000, minimum: 1_000, maximum: 600_000 }),
        billingBatchSize: integerValue(environment, "BILLING_MAINTENANCE_BATCH_SIZE", { defaultValue: 20, minimum: 1, maximum: 100 }),
      };
    }
  } else if (target === "landing") {
    result.siteUrl = stringValue(environment, "NEXT_PUBLIC_SITE_URL", { required: production });
    result.allowedOrigins = originList(environment, "FORM_ALLOWED_ORIGINS", { required: production, httpsOnly: production });
  } else if (target === "migration") {
    result.database = databaseConfig(environment, { name: "MIGRATION_DATABASE_URL", defaultPoolMaximum: 1 });
  } else {
    throw new ConfigurationError(["Target must be web, worker, landing or migration."]);
  }
  return Object.freeze(result);
}
