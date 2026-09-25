// Shared Platform — platform boundary.
// Shared platform services: configuration, numbering, idempotency, notifications, approvals, background jobs, tags, inbound mail, AI governance, references.
//
// Compatibility barrel: implementations still live in the flat
// services/api/src/core/*.js files listed below and are moved behind this
// boundary incrementally. New callers import the boundary, not the files.
export * from "../configuration.js";
export * from "../document-numbering.js";
export * from "../idempotency.js";
export * from "../notifications.js";
export * from "../notification-preferences.js";
export * from "../approvals.js";
export * from "../background-jobs.js";
export * from "../tags.js";
export * from "../inbound-mail.js";
export * from "../ai-governance.js";
export * from "../references.js";
export * from "./module-administration.js";
