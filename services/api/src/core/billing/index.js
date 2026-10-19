// Shared Platform - SaaS billing boundary (Vercentlabs charging its own
// customers; never tenant Accounting). Import billing only from here.
//   catalogue      commercial model, immutable price versions, provider plans
//   app-choice     the Free plan's one app: choosing and switching
//   state          the subscription state model and write-access rule
//   seats          billable-user formula, reservation, overage, seat-change saga
//   checkout       Standard checkout saga and its recovery
//   subscriptions  state application, revert to Free, cancellation, Custom contracts
//   tax-invoices   Vercentlabs' own GST tax invoices and credit notes for charges
//   webhooks       ingestion and leased processing
//   reconciliation provider <-> local reconciliation
//   maintenance    the worker's platform billing pass
//   overview       Billing page / health read models, billing profile
//   entitlements   plan entitlements, usage limits, business write gate
//   providers/razorpay  the only Razorpay client
export * from "./errors.js";
export { billingEvent, billingLogger, billingMetrics, BILLING_EVENTS } from "./observability.js";
export * from "./enforcement.js";
export * from "./state.js";
export * from "./catalogue.js";
export * from "./app-choice.js";
export * from "./seats.js";
export * from "./checkout.js";
export * from "./subscriptions.js";
export * from "./payments.js";
export * from "./tax-invoices.js";
export * from "./usage.js";
export * from "./renewals.js";
export * from "./webhooks.js";
export * from "./reconciliation.js";
export * from "./maintenance.js";
export * from "./overview.js";
export * from "./entitlements.js";
export * from "./providers/razorpay.js";
