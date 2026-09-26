// Billing errors. `outcome` records what we know about an external provider
// call that failed, which decides whether a saga can be marked failed or must
// stay recoverable:
//   rejected - the provider definitely did not perform the operation
//              (validation/4xx, or we never sent it);
//   unknown  - the request may have been performed (timeout, network error,
//              provider 5xx). Never report "nothing happened" for these.
export class BillingServiceError extends Error {
  constructor(status, message, code = "BILLING_ERROR", { outcome = null } = {}) {
    super(message);
    this.name = "BillingServiceError";
    this.status = status;
    this.code = code;
    this.outcome = outcome;
  }
}

export const PROVIDER_OUTCOME = Object.freeze({ REJECTED: "rejected", UNKNOWN: "unknown" });

export function isDefiniteProviderRejection(error) {
  return error instanceof BillingServiceError && error.outcome === PROVIDER_OUTCOME.REJECTED;
}

// Short, redacted text safe to persist in last_error/processing_error columns.
export function redactedErrorText(error) {
  const message = String(error?.message || error || "unknown error");
  return message
    .replace(/rzp_(live|test)_[A-Za-z0-9]+/g, "rzp_$1_[redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic [redacted]")
    .replace(/[0-9a-f]{64}/gi, "[hash]")
    .slice(0, 500);
}
