const target = process.argv[2] || process.env.VERCENTLABS_ENV_TARGET || "web";
const failures = [];

function value(name) {
  return String(process.env[name] || "").trim();
}

function requireValue(name, minimumLength = 1) {
  if (value(name).length < minimumLength) failures.push(`${name} is required.`);
}

function requireHttps(name) {
  try {
    const url = new URL(value(name));
    if (url.protocol !== "https:") throw new Error();
  } catch {
    failures.push(`${name} must be a valid HTTPS URL.`);
  }
}

function requireInteger(name, minimum, maximum, options = {}) {
  const raw = value(name);
  if (!raw) {
    if (options.required) failures.push(`${name} is required.`);
    return;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    failures.push(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
}

function requirePostgres(name) {
  try {
    const url = new URL(value(name));
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
    if (!url.hostname || !url.pathname.slice(1)) throw new Error();
  } catch {
    failures.push(`${name} must be a valid PostgreSQL connection URL.`);
  }
}

function requireHttpsOrigins(name) {
  const origins = value(name)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!origins.length)
    failures.push(`${name} must contain at least one origin.`);
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== "https:" || parsed.origin !== origin)
        throw new Error();
    } catch {
      failures.push(`${name} contains an invalid HTTPS origin.`);
      break;
    }
  }
}

function configuredPair(first, second) {
  return Boolean(value(first) && value(second));
}

if (process.env.NODE_ENV !== "production") {
  failures.push("NODE_ENV must be production.");
}

if (target === "web") {
  requireHttps("APP_URL");
  requirePostgres("DATABASE_URL");
  if (value("MIGRATION_DATABASE_URL")) {
    failures.push(
      "MIGRATION_DATABASE_URL must not be injected into the web or worker runtime.",
    );
  }
  if (value("ENFORCE_RESTRICTED_DB_ROLE") !== "true") {
    failures.push("ENFORCE_RESTRICTED_DB_ROLE must be true.");
  }
  requireValue("SESSION_COOKIE_NAME");
  requireInteger("SESSION_ABSOLUTE_DAYS", 1, 365);
  requireInteger("SESSION_IDLE_MINUTES", 15, 43_200);
  requireInteger("MOBILE_ACCESS_TOKEN_MINUTES", 5, 60);
  requireInteger("MOBILE_REFRESH_TOKEN_DAYS", 1, 90);
  requireInteger("MOBILE_SESSION_IDLE_DAYS", 1, 90);
  requireInteger("SMTP_PORT", 1, 65_535);
  requireInteger("CRM_SMTP_PORT", 1, 65_535);
  requireInteger("CRM_EMAIL_TIMEOUT_MS", 1_000, 120_000);
  requireInteger("CRM_OUTBOX_BATCH_SIZE", 1, 100);
  requireInteger("CRM_OUTBOX_MAX_ATTEMPTS", 1, 20);
  requireInteger("CRM_OUTBOX_LEASE_SECONDS", 60, 3_600);
  requireInteger("RAZORPAY_REQUEST_TIMEOUT_MS", 1_000, 120_000);
  requireInteger("RAZORPAY_WEBHOOK_MAX_ATTEMPTS", 1, 50);
  requireHttpsOrigins("FORM_ALLOWED_ORIGINS");
  requireValue("TRUSTED_PROXY_IP_HEADER");

  const webhookEmail =
    configuredPair("AUTH_EMAIL_WEBHOOK_URL", "AUTH_EMAIL_WEBHOOK_SECRET") &&
    Boolean(value("AUTH_EMAIL_FROM"));
  const smtpEmail =
    Boolean(value("SMTP_HOST")) &&
    Boolean(value("SMTP_USER")) &&
    Boolean(value("SMTP_PASSWORD")) &&
    Boolean(value("AUTH_EMAIL_FROM"));
  if (!webhookEmail && !smtpEmail) {
    failures.push(
      "Configure authenticated email delivery using webhook or SMTP.",
    );
  }

  if (
    value("CRM_CAPTURE_PROXY_SECRET") &&
    value("CRM_CAPTURE_PROXY_SECRET").length < 32
  ) {
    failures.push(
      "CRM_CAPTURE_PROXY_SECRET must contain at least 32 characters.",
    );
  }

  if (value("BILLING_CHECKOUT_ENABLED") === "true") {
    for (const name of [
      "RAZORPAY_KEY_ID",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
    ]) {
      requireValue(name);
    }
    if (value("RAZORPAY_MODE") !== "live") {
      failures.push(
        "RAZORPAY_MODE must be live when production checkout is enabled.",
      );
    }
  }
} else if (target === "migration") {
  requirePostgres("MIGRATION_DATABASE_URL");
  requireValue("APP_DATABASE_ROLE");
  requireValue("APP_DATABASE_PASSWORD", 24);
  if (value("DATABASE_URL")) {
    failures.push(
      "DATABASE_URL should not be injected into the isolated migration job.",
    );
  }
} else if (target === "landing") {
  requireHttps("NEXT_PUBLIC_SITE_URL");
  if (value("NEXT_PUBLIC_ERP_APP_URL")) {
    requireHttps("NEXT_PUBLIC_ERP_APP_URL");
  }
  requireValue("NEXT_PUBLIC_CONTACT_EMAIL");
  requireHttpsOrigins("FORM_ALLOWED_ORIGINS");
  requireHttps("UPSTASH_REDIS_REST_URL");
  requireValue("UPSTASH_REDIS_REST_TOKEN");
  requireValue("TRUSTED_PROXY_IP_HEADER");

  const crmDelivery = Boolean(value("CRM_CAPTURE_URL"));
  const genericDelivery = configuredPair(
    "LEAD_WEBHOOK_URL",
    "LEAD_WEBHOOK_SECRET",
  );
  if (value("LEAD_WEBHOOK_URL")) requireHttps("LEAD_WEBHOOK_URL");
  if (!crmDelivery && !genericDelivery) {
    failures.push(
      "Configure CRM_CAPTURE_URL or a signed generic lead webhook.",
    );
  }
  if (crmDelivery) {
    requireHttps("CRM_CAPTURE_URL");
    requireValue("CRM_CAPTURE_PROXY_SECRET", 32);
  }

  for (const name of ["DEMO_CRM_CAPTURE_URL", "SIGNUP_CRM_CAPTURE_URL"]) {
    if (value(name)) {
      requireHttps(name);
      requireValue("CRM_CAPTURE_PROXY_SECRET", 32);
    }
  }

  const demoWebhookUrl =
    value("DEMO_WEBHOOK_URL") || value("SIGNUP_WEBHOOK_URL");
  const demoWebhookSecret =
    value("DEMO_WEBHOOK_SECRET") || value("SIGNUP_WEBHOOK_SECRET");
  if (Boolean(demoWebhookUrl) !== Boolean(demoWebhookSecret)) {
    failures.push(
      "Demo webhook URL and secret must be configured together when used.",
    );
  }
  if (value("DEMO_WEBHOOK_URL")) requireHttps("DEMO_WEBHOOK_URL");
  if (value("SIGNUP_WEBHOOK_URL")) requireHttps("SIGNUP_WEBHOOK_URL");
} else {
  failures.push("Target must be web, landing or migration.");
}

if (failures.length) {
  console.error(`Production ${target} environment is not ready:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Production ${target} environment contract verified.`);
