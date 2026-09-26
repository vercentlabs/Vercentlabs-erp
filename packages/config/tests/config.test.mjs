import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError, WORKSPACE_EMAILS, databaseConfig, originList } from "../src/index.js";

test("company email identities use role-based Workspace addresses", () => {
  assert.equal(WORKSPACE_EMAILS.primary, WORKSPACE_EMAILS.sales);
  assert.equal(WORKSPACE_EMAILS.primary, "sales@vercentlabs.com");
  assert.equal(WORKSPACE_EMAILS.authentication, "auth@vercentlabs.com");

  for (const email of Object.values(WORKSPACE_EMAILS)) {
    assert.match(email, /^[a-z]+@vercentlabs\.com$/);
  }
});

test("database configuration validates and bounds pool controls", () => {
  const config = databaseConfig({ DATABASE_URL: "postgresql://user:pass@localhost:5432/vercentlabs", DATABASE_POOL_MAX: "24" });
  assert.equal(config.poolMaximum, 24);
  assert.throws(() => databaseConfig({ DATABASE_URL: "https://example.com" }), ConfigurationError);
});

test("production origins are canonical HTTPS origins", () => {
  assert.deepEqual(originList({ ORIGINS: "https://app.example.com,https://app.example.com" }, "ORIGINS", { httpsOnly: true }), ["https://app.example.com"]);
  assert.throws(() => originList({ ORIGINS: "http://app.example.com/path" }, "ORIGINS", { httpsOnly: true }), ConfigurationError);
});

import { loadSecretFiles, validateRuntimeEnvironment } from "../src/index.js";

const PRODUCTION_WEB = Object.freeze({
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://vercent_web:pw@127.0.0.1:5432/vercentlabs",
  APP_URL: "https://erp.vercentlabs.com",
  FORM_ALLOWED_ORIGINS: "https://erp.vercentlabs.com",
  SMTP_HOST: "smtp.example.com",
  SMTP_USER: "auth@vercentlabs.com",
  SMTP_PASSWORD: "x",
  AUTH_EMAIL_FROM: "Vercentlabs <auth@vercentlabs.com>",
  FILE_STORAGE_DRIVER: "gcs",
  FILE_STORAGE_GCS_BUCKET: "vercentlabs-prod-files",
  ATTACHMENT_SCAN_MODE: "local",
  SECRETS_ENCRYPTION_PROVIDER: "gcp-kms",
  SECRETS_KMS_KEY_NAME: "projects/vercentlabs-prod/locations/asia-south1/keyRings/erp/cryptoKeys/integration-secrets",
  TRUSTED_PROXY_IP_HEADER: "x-forwarded-for",
  TRUSTED_PROXY_CLIENT_INDEX: "-2",
});

test("secrets load from mounted files without overriding explicit values", () => {
  const env = { SMTP_PASSWORD_FILE: "/run/smtp", RAZORPAY_KEY_SECRET: "explicit", RAZORPAY_KEY_SECRET_FILE: "/run/rzp", NOT_A_SECRET_FILE: "/run/x" };
  const files = { "/run/smtp": "from-file\n", "/run/rzp": "ignored" };
  loadSecretFiles(env, (path) => files[path]);
  assert.equal(env.SMTP_PASSWORD, "from-file");
  assert.equal(env.RAZORPAY_KEY_SECRET, "explicit");
  assert.equal(env.NOT_A_SECRET, undefined, "only registered secrets load from files");
  assert.throws(() => loadSecretFiles({ SMTP_PASSWORD_FILE: "/missing" }, () => { throw new Error("ENOENT"); }), ConfigurationError);
});

test("a complete production web configuration validates", () => {
  const config = validateRuntimeEnvironment("web", { ...PRODUCTION_WEB });
  assert.equal(config.production, true);
});

test("production refuses local storage, local secrets, stand-ins, observe billing and partial SMTP — all reported at once", () => {
  const env = { ...PRODUCTION_WEB, FILE_STORAGE_DRIVER: "local", SECRETS_ENCRYPTION_PROVIDER: "local", OAUTH_STANDIN_URL: "http://127.0.0.1:3197", BILLING_ENFORCEMENT_MODE: "observe", SMTP_PASSWORD: "", MIGRATION_DATABASE_URL: "postgresql://owner:pw@db/x" };
  try {
    validateRuntimeEnvironment("web", env);
    assert.fail("expected a configuration error");
  } catch (error) {
    assert.ok(error instanceof ConfigurationError);
    const text = error.issues.join("\n");
    for (const needle of ["FILE_STORAGE_DRIVER=gcs", "gcp-kms", "OAUTH_STANDIN_URL", "observe", "SMTP is partly configured", "MIGRATION_DATABASE_URL"]) assert.match(text, new RegExp(needle));
  }
});

test("production checkout needs live Razorpay credentials; OAuth pairs are all-or-nothing", () => {
  assert.throws(() => validateRuntimeEnvironment("web", { ...PRODUCTION_WEB, BILLING_CHECKOUT_ENABLED: "true", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s", RAZORPAY_WEBHOOK_SECRET: "w", RAZORPAY_MODE: "test" }), /RAZORPAY_MODE=live/);
  assert.throws(() => validateRuntimeEnvironment("web", { ...PRODUCTION_WEB, GOOGLE_OAUTH_CLIENT_ID: "id" }), /must be set together/);
  assert.throws(() => validateRuntimeEnvironment("web", { ...PRODUCTION_WEB, TRUSTED_PROXY_IP_HEADER: "" }), /TRUSTED_PROXY_IP_HEADER/);
});

test("the production worker uses its own database authority", () => {
  const worker = { ...PRODUCTION_WEB, TRUSTED_PROXY_IP_HEADER: "", DATABASE_URL: "", WORKER_DATABASE_URL: "postgresql://vercent_worker:pw@127.0.0.1:5432/vercentlabs" };
  const config = validateRuntimeEnvironment("worker", worker);
  assert.match(config.database.connectionString, /vercent_worker/);
  assert.throws(() => validateRuntimeEnvironment("worker", { ...worker, WORKER_DATABASE_URL: "" }), /WORKER_DATABASE_URL is required/);
  assert.throws(() => validateRuntimeEnvironment("web", { ...PRODUCTION_WEB, WORKER_DATABASE_URL: worker.WORKER_DATABASE_URL }), /must not be available to the web/);
});

test("development stays lenient for optional features but still rejects partial configuration", () => {
  assert.ok(validateRuntimeEnvironment("web", { DATABASE_URL: "postgresql://u:p@localhost/x" }));
  assert.throws(() => validateRuntimeEnvironment("web", { DATABASE_URL: "postgresql://u:p@localhost/x", SMTP_HOST: "smtp.example.com" }), /partly configured/);
});
