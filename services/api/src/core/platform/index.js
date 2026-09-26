// Shared Platform � platform boundary.
// Shared platform services: configuration, numbering, idempotency, notifications, approvals, background jobs, tags, inbound mail, AI governance, references.
//
// The platform domain's public boundary. Generic helpers that stay flat in
// core/ (idempotency, tags, references) are re-exported here too. New callers
// import this index, not the implementation files.
export * from "./configuration/index.js";
export * from "./numbering/index.js";
export * from "./files/index.js";
export * from "../idempotency.js";
export * from "./notifications/index.js";
export * from "./approvals/index.js";
export * from "./jobs/index.js";
export * from "./audit/index.js";
export * from "../tags.js";
export * from "./integrations/inbound-mail/index.js";
export * from "./ai/index.js";
export * from "./privacy/index.js";
export * from "../references.js";
export * from "./module-administration.js";
