// Shared Platform — auth boundary.
// Authentication lifecycle: sessions, passwords, email verification, MFA/TOTP, recovery codes, OAuth.
//
// Compatibility barrel: implementations still live in the flat
// services/api/src/core/*.js files listed below and are moved behind this
// boundary incrementally. New callers import the boundary, not the files.
export * from "../session.js";
export * from "../auth-lifecycle.js";
export * from "../mfa.js";
export * from "../password-policy.js";
export * from "../auth-mailer.js";
export * from "../platform/integrations/oauth/index.js";
export * from "../platform/integrations/secrets.js";
