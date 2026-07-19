const target = process.argv[2] || process.env.VERCENT_ENV_TARGET || "web";
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

function requirePostgres(name) {
  try {
    const url = new URL(value(name));
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
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
  if (!origins.length) failures.push(`${name} must contain at least one origin.`);
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== "https:" || parsed.origin !== origin) throw new Error();
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
    failures.push("Configure authenticated email delivery using webhook or SMTP.");
  }

  if (
    value("CRM_CAPTURE_PROXY_SECRET") &&
    value("CRM_CAPTURE_PROXY_SECRET").length < 32
  ) {
    failures.push("CRM_CAPTURE_PROXY_SECRET must contain at least 32 characters.");
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
      failures.push("RAZORPAY_MODE must be live when production checkout is enabled.");
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
  requireHttps("NEXT_PUBLIC_ERP_APP_URL");
  requireValue("NEXT_PUBLIC_CONTACT_EMAIL");
  requireHttpsOrigins("FORM_ALLOWED_ORIGINS");
  requireValue("UPSTASH_REDIS_REST_URL");
  requireValue("UPSTASH_REDIS_REST_TOKEN");
  requireValue("TRUSTED_PROXY_IP_HEADER");

  const crmDelivery = Boolean(value("CRM_CAPTURE_URL"));
  const genericDelivery = configuredPair("LEAD_WEBHOOK_URL", "LEAD_WEBHOOK_SECRET");
  if (!crmDelivery && !genericDelivery) {
    failures.push("Configure CRM_CAPTURE_URL or a signed generic lead webhook.");
  }
  if (crmDelivery) {
    requireHttps("CRM_CAPTURE_URL");
    requireValue("CRM_CAPTURE_PROXY_SECRET", 32);
  }
  if (value("SIGNUP_CRM_CAPTURE_URL")) requireHttps("SIGNUP_CRM_CAPTURE_URL");
} else {
  failures.push("Target must be web, landing or migration.");
}

if (failures.length) {
  console.error(`Production ${target} environment is not ready:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Production ${target} environment contract verified.`);
