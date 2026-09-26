// Startup configuration: mounted-secret loading and the one complete
// validation every deployable runs BEFORE it serves requests or claims work.
// Optional features may stay off; a security-sensitive system that is only
// partly configured fails loudly here instead of at its first use.
import fs from "node:fs";

import { booleanValue, ConfigurationError, databaseConfig, integerValue, originList, stringValue } from "./values.js";

// Secret values that may be delivered as files (GKE Secret Manager CSI mounts
// them under /var/run/secrets/...): NAME_FILE=/path sets NAME from the file.
export const SECRET_ENV_KEYS = Object.freeze([
  "DATABASE_URL",
  "WORKER_DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "SMTP_PASSWORD",
  "AUTH_EMAIL_WEBHOOK_SECRET",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "RAZORPAY_WEBHOOK_SECRET_PREVIOUS",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "MICROSOFT_OAUTH_CLIENT_SECRET",
  "ATTACHMENT_SCAN_TOKEN",
  "CRM_CAPTURE_PROXY_SECRET",
  "CRM_INBOUND_EMAIL_SECRET",
  "CRM_PROVIDER_WEBHOOK_SECRET",
  "CRM_ACQUISITION_WEBHOOK_SECRET",
  "POS_SANDBOX_PAYMENT_WEBHOOK_SECRET",
  "SECRETS_LOCAL_MASTER_KEY",
  // Legacy key: decrypt-only while `pnpm secrets:migrate-legacy` runs.
  "INTEGRATION_TOKEN_ENCRYPTION_KEY",
]);

/** Loads NAME from NAME_FILE for registered secrets (never overrides an explicit NAME). */
export function loadSecretFiles(environment = process.env, readFile = (path) => fs.readFileSync(path, "utf8")) {
  const issues = [];
  for (const key of SECRET_ENV_KEYS) {
    const file = String(environment[`${key}_FILE`] ?? "").trim();
    if (!file || String(environment[key] ?? "").trim()) continue;
    try {
      environment[key] = readFile(file).replace(/\r?\n$/, "");
    } catch {
      issues.push(`${key}_FILE points to an unreadable file.`);
    }
  }
  if (issues.length) throw new ConfigurationError(issues);
  return environment;
}

const KMS_KEY_NAME = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/;
const GCS_BUCKET = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;

// Collect instead of throwing on the first problem: an operator fixes every
// issue from one failed start.
function collect(issues, read) {
  try {
    return read();
  } catch (error) {
    if (error instanceof ConfigurationError) issues.push(...error.issues);
    else throw error;
    return undefined;
  }
}

const present = (environment, name) => Boolean(String(environment[name] ?? "").trim());

function httpsUrl(environment, name, issues, { required = false } = {}) {
  const value = String(environment[name] ?? "").trim();
  if (!value) {
    if (required) issues.push(`${name} is required.`);
    return "";
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error();
  } catch {
    issues.push(`${name} must be an https:// URL.`);
  }
  return value;
}

function mailIssues(environment, production, issues) {
  const smtpKeys = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "AUTH_EMAIL_FROM"];
  const configured = smtpKeys.filter((key) => present(environment, key));
  if (configured.length && configured.length !== smtpKeys.length) {
    issues.push(`SMTP is partly configured: set all of ${smtpKeys.join(", ")} or none.`);
  }
  if (present(environment, "SMTP_PORT")) collect(issues, () => integerValue(environment, "SMTP_PORT", { minimum: 1, maximum: 65535 }));
  if (production) {
    httpsUrl(environment, "AUTH_EMAIL_WEBHOOK_URL", issues);
    if (configured.length !== smtpKeys.length && !present(environment, "AUTH_EMAIL_WEBHOOK_URL")) {
      issues.push("Authentication email is required in production: configure SMTP (SMTP_HOST, SMTP_USER, SMTP_PASSWORD, AUTH_EMAIL_FROM) or AUTH_EMAIL_WEBHOOK_URL.");
    }
    if (present(environment, "AUTH_EMAIL_CAPTURE_ENABLED")) issues.push("AUTH_EMAIL_CAPTURE_ENABLED is a test-only switch and must not be set in production.");
  }
}

function billingIssues(environment, production, issues) {
  const mode = String(environment.BILLING_ENFORCEMENT_MODE ?? "").trim().toLowerCase();
  if (mode && !["observe", "enforce"].includes(mode)) issues.push("BILLING_ENFORCEMENT_MODE must be observe or enforce.");
  if (production && mode === "observe") issues.push("BILLING_ENFORCEMENT_MODE=observe is not allowed in production.");
  const razorpayMode = String(environment.RAZORPAY_MODE ?? "").trim();
  if (razorpayMode && !["live", "test"].includes(razorpayMode)) issues.push("RAZORPAY_MODE must be live or test.");
  const checkout = collect(issues, () => booleanValue(environment, "BILLING_CHECKOUT_ENABLED", false));
  const keyId = String(environment.RAZORPAY_KEY_ID ?? "").trim();
  if (keyId && razorpayMode === "live" && !keyId.startsWith("rzp_live_")) issues.push("RAZORPAY_MODE=live requires a rzp_live_ key id.");
  if (checkout) {
    if (!keyId || !present(environment, "RAZORPAY_KEY_SECRET")) issues.push("BILLING_CHECKOUT_ENABLED requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
    if (!present(environment, "RAZORPAY_WEBHOOK_SECRET")) issues.push("BILLING_CHECKOUT_ENABLED requires RAZORPAY_WEBHOOK_SECRET.");
    if (production && razorpayMode !== "live") issues.push("Production checkout requires RAZORPAY_MODE=live.");
  }
  if (production && present(environment, "RAZORPAY_API_BASE")) issues.push("RAZORPAY_API_BASE (test stand-in) must not be set in production.");
}

function storageIssues(environment, production, issues) {
  const driver = String(environment.FILE_STORAGE_DRIVER ?? "").trim().toLowerCase();
  if (driver && !["local", "memory", "gcs"].includes(driver)) issues.push("FILE_STORAGE_DRIVER must be local, memory or gcs.");
  if (production && driver !== "gcs") issues.push("Production file storage requires FILE_STORAGE_DRIVER=gcs.");
  if (driver === "gcs") {
    const bucket = String(environment.FILE_STORAGE_GCS_BUCKET ?? "").trim();
    if (!GCS_BUCKET.test(bucket)) issues.push("FILE_STORAGE_GCS_BUCKET must be a valid Cloud Storage bucket name.");
    const prefix = String(environment.FILE_STORAGE_GCS_PREFIX ?? "").trim();
    if (prefix && (!/^[A-Za-z0-9/_-]+$/.test(prefix) || prefix.startsWith("/") || prefix.includes(".."))) issues.push("FILE_STORAGE_GCS_PREFIX may only contain letters, digits, '/', '_' and '-'.");
  }
  const scan = String(environment.ATTACHMENT_SCAN_MODE ?? "").trim().toLowerCase() || (production ? "required" : "local");
  if (!["local", "required"].includes(scan)) issues.push("ATTACHMENT_SCAN_MODE must be local or required.");
  if (scan === "required") {
    httpsUrl(environment, "ATTACHMENT_SCAN_URL", issues, { required: true });
    if (!present(environment, "ATTACHMENT_SCAN_TOKEN")) issues.push("ATTACHMENT_SCAN_MODE=required needs ATTACHMENT_SCAN_TOKEN.");
  }
}

function secretsIssues(environment, production, issues) {
  const provider = String(environment.SECRETS_ENCRYPTION_PROVIDER ?? "").trim().toLowerCase() || (production ? "" : "local");
  if (!["local", "gcp-kms"].includes(provider)) issues.push("SECRETS_ENCRYPTION_PROVIDER must be gcp-kms (production) or local (development and tests).");
  if (production && provider !== "gcp-kms") issues.push("Production requires SECRETS_ENCRYPTION_PROVIDER=gcp-kms.");
  if (provider === "gcp-kms" && !KMS_KEY_NAME.test(String(environment.SECRETS_KMS_KEY_NAME ?? "").trim())) {
    issues.push("SECRETS_KMS_KEY_NAME must be a Cloud KMS key name: projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>.");
  }
  if (provider === "local" && present(environment, "SECRETS_LOCAL_MASTER_KEY")) {
    const raw = String(environment.SECRETS_LOCAL_MASTER_KEY).trim();
    const bytes = /^[0-9a-f]{64}$/i.test(raw) ? 32 : Buffer.from(raw, "base64").length;
    if (bytes !== 32) issues.push("SECRETS_LOCAL_MASTER_KEY must be 32 bytes (64 hex characters or base64).");
  }
  if (present(environment, "INTEGRATION_TOKEN_ENCRYPTION_KEY")) {
    const raw = String(environment.INTEGRATION_TOKEN_ENCRYPTION_KEY).trim();
    const bytes = /^[0-9a-f]{64}$/i.test(raw) ? 32 : Buffer.from(raw, "base64").length;
    if (bytes !== 32) issues.push("INTEGRATION_TOKEN_ENCRYPTION_KEY (legacy, decrypt-only) must be 32 bytes.");
  }
}

function oauthIssues(environment, production, issues) {
  for (const prefix of ["GOOGLE", "MICROSOFT"]) {
    const id = present(environment, `${prefix}_OAUTH_CLIENT_ID`);
    const secret = present(environment, `${prefix}_OAUTH_CLIENT_SECRET`);
    if (id !== secret) issues.push(`${prefix}_OAUTH_CLIENT_ID and ${prefix}_OAUTH_CLIENT_SECRET must be set together.`);
  }
  if (production && present(environment, "OAUTH_STANDIN_URL")) issues.push("OAUTH_STANDIN_URL (test stand-in) must not be set in production.");
}

function proxyIssues(environment, production, issues) {
  const header = String(environment.TRUSTED_PROXY_IP_HEADER ?? "").trim().toLowerCase();
  if (header && !/^[a-z0-9-]+$/.test(header)) issues.push("TRUSTED_PROXY_IP_HEADER must be a header name.");
  if (production && !header) issues.push("Production requires TRUSTED_PROXY_IP_HEADER (x-forwarded-for behind the Google Cloud load balancer) so rate limits key on the real client.");
  if (present(environment, "TRUSTED_PROXY_CLIENT_INDEX")) collect(issues, () => integerValue(environment, "TRUSTED_PROXY_CLIENT_INDEX", { minimum: -10, maximum: 10 }));
}

function databaseIssues(target, environment, production, issues) {
  const name = target === "worker" && (production || present(environment, "WORKER_DATABASE_URL")) ? "WORKER_DATABASE_URL" : "DATABASE_URL";
  const database = collect(issues, () => databaseConfig(environment, { name }));
  if (production && present(environment, "ENFORCE_RESTRICTED_DB_ROLE") && String(environment.ENFORCE_RESTRICTED_DB_ROLE).trim() !== "true") {
    issues.push("ENFORCE_RESTRICTED_DB_ROLE cannot be disabled in production.");
  }
  if (production && present(environment, "MIGRATION_DATABASE_URL")) {
    issues.push(`MIGRATION_DATABASE_URL must not be available to the ${target}; only the migration job receives it.`);
  }
  if (production && target === "web" && present(environment, "WORKER_DATABASE_URL")) issues.push("WORKER_DATABASE_URL must not be available to the web deployment.");
  return database;
}

function workerSettings(environment, production, issues) {
  const allowPrivate = collect(issues, () => booleanValue(environment, "WORKER_ALLOW_PRIVATE_WEBHOOK_TARGETS", false));
  if (production && allowPrivate) issues.push("WORKER_ALLOW_PRIVATE_WEBHOOK_TARGETS must be false in production.");
  return collect(issues, () => ({
    enabled: booleanValue(environment, "WORKER_ENABLED", true),
    concurrency: integerValue(environment, "WORKER_CONCURRENCY", { defaultValue: 2, minimum: 1, maximum: 16 }),
    pollIntervalMilliseconds: integerValue(environment, "WORKER_POLL_INTERVAL_MS", { defaultValue: 5_000, minimum: 500, maximum: 60_000 }),
    leaseMilliseconds: integerValue(environment, "WORKER_LEASE_MS", { defaultValue: 120_000, minimum: 5_000, maximum: 3_600_000 }),
    batchSize: integerValue(environment, "WORKER_BATCH_SIZE", { defaultValue: 10, minimum: 1, maximum: 100 }),
    schedulerTickMilliseconds: integerValue(environment, "WORKER_SCHEDULER_TICK_MS", { defaultValue: 300_000, minimum: 30_000, maximum: 3_600_000 }),
    webhookTimeoutMilliseconds: integerValue(environment, "WORKER_WEBHOOK_TIMEOUT_MS", { defaultValue: 10_000, minimum: 1_000, maximum: 60_000 }),
    allowPrivateWebhookTargets: Boolean(allowPrivate),
    shutdownDeadlineMilliseconds: integerValue(environment, "WORKER_SHUTDOWN_DEADLINE_MS", { defaultValue: 60_000, minimum: 5_000, maximum: 600_000 }),
    healthPort: integerValue(environment, "WORKER_HEALTH_PORT", { defaultValue: 8081, minimum: 1024, maximum: 65535 }),
    // Platform billing maintenance (webhook processing, checkout/seat/cancellation recovery, reconciliation).
    billingMaintenanceEnabled: booleanValue(environment, "BILLING_MAINTENANCE_ENABLED", true),
    billingMaintenanceIntervalMilliseconds: integerValue(environment, "BILLING_MAINTENANCE_INTERVAL_MS", { defaultValue: 15_000, minimum: 1_000, maximum: 600_000 }),
    billingBatchSize: integerValue(environment, "BILLING_MAINTENANCE_BATCH_SIZE", { defaultValue: 20, minimum: 1, maximum: 100 }),
  }));
}

/**
 * The one startup validation for web, worker, landing and migration. Throws a
 * ConfigurationError listing every problem; returns the validated settings.
 */
export function validateRuntimeEnvironment(target, environment = process.env) {
  const production = environment.NODE_ENV === "production";
  const issues = [];
  const result = { target, production };
  if (target === "web" || target === "worker") {
    result.database = databaseIssues(target, environment, production, issues);
    result.appUrl = production ? httpsUrl(environment, "APP_URL", issues, { required: true }) : collect(issues, () => stringValue(environment, "APP_URL"));
    result.allowedOrigins = collect(issues, () => originList(environment, "FORM_ALLOWED_ORIGINS", { required: production, httpsOnly: production }));
    mailIssues(environment, production, issues);
    billingIssues(environment, production, issues);
    storageIssues(environment, production, issues);
    secretsIssues(environment, production, issues);
    oauthIssues(environment, production, issues);
    if (target === "web") proxyIssues(environment, production, issues);
    if (target === "worker") {
      result.worker = workerSettings(environment, production, issues);
      // Each concurrent organisation lane holds one connection; billing and
      // platform maintenance and the scheduler need their own.
      if (result.worker && result.database && result.worker.concurrency + 3 > result.database.poolMaximum) {
        issues.push(`DATABASE_POOL_MAX (${result.database.poolMaximum}) must be at least WORKER_CONCURRENCY + 3 (${result.worker.concurrency + 3}).`);
      }
    }
  } else if (target === "landing") {
    result.siteUrl = collect(issues, () => stringValue(environment, "NEXT_PUBLIC_SITE_URL", { required: production }));
    result.allowedOrigins = collect(issues, () => originList(environment, "FORM_ALLOWED_ORIGINS", { required: production, httpsOnly: production }));
  } else if (target === "migration") {
    result.database = collect(issues, () => databaseConfig(environment, { name: "MIGRATION_DATABASE_URL", defaultPoolMaximum: 1 }));
  } else {
    issues.push("Target must be web, worker, landing or migration.");
  }
  if (issues.length) throw new ConfigurationError([...new Set(issues)]);
  return Object.freeze(result);
}
