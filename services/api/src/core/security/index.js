// Shared Platform — security boundary.
// Request security (origin/CSRF, rate limits, body limits), audit writer, redaction, attachment security, API keys, privacy.
//
// Compatibility barrel: implementations still live in the flat
// services/api/src/core/*.js files listed below and are moved behind this
// boundary incrementally. New callers import the boundary, not the files.
export * from "../security.js";
export * from "../audit-redaction.js";
export * from "../attachment-security.js";
export * from "../api-keys.js";
export * from "../privacy.js";
