// Structured billing logs and low-cardinality metrics. Metric labels are
// fixed vocabularies (event type, outcome, source); provider or organisation
// identifiers only ever appear in log fields, never as labels.
import { createLogger, createMetricRegistry } from "@vercentlabs/observability";

export const billingLogger = createLogger("billing");
export const billingMetrics = createMetricRegistry();

export const BILLING_EVENTS = Object.freeze([
  "billing.checkout.created",
  "billing.checkout.provider_created",
  "billing.checkout.verification_pending",
  "billing.checkout.activated",
  "billing.checkout.recovered",
  "billing.checkout.recovery_failed",
  "billing.checkout.intervention_required",
  "billing.webhook.received",
  "billing.webhook.duplicate",
  "billing.webhook.rejected",
  "billing.webhook.processed",
  "billing.webhook.ignored",
  "billing.webhook.failed",
  "billing.webhook.dead_lettered",
  "billing.reconciliation.success",
  "billing.reconciliation.mismatch",
  "billing.seats.changed",
  "billing.seats.change_failed",
  "billing.cancellation.scheduled",
  "billing.provider.error",
]);

const WARN = /(failed|dead_lettered|mismatch|intervention_required|provider\.error|rejected)$/;

export function billingEvent(name, fields = {}, labels = {}) {
  billingMetrics.increment(name, 1, labels);
  billingLogger[WARN.test(name) ? "warn" : "info"](name, fields);
}
