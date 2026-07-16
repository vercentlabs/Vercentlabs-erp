export const BILLING_PLAN_CODES = Object.freeze([
  "founder-preview",
  "launch",
  "growth",
  "scale",
  "enterprise",
]);

export const BILLING_PERIODS = Object.freeze(["monthly", "yearly", "custom"]);

export const BILLING_SUBSCRIPTION_STATUSES = Object.freeze([
  "trialing",
  "checkout_pending",
  "authenticated",
  "active",
  "past_due",
  "halted",
  "cancelled",
  "completed",
  "expired",
  "internal",
]);

export const BILLING_USAGE_METRICS = Object.freeze([
  "api_requests_monthly",
  "automation_actions_monthly",
  "outbound_messages_monthly",
  "imports_rows_monthly",
  "storage_bytes",
]);
