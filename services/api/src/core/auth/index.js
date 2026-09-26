// Shared Platform � auth boundary.
// Authentication lifecycle: sessions, passwords, email verification, MFA/TOTP, recovery codes, OAuth.
//
// The auth domain's public boundary. New callers import this index, not the
// implementation files.
export * from "./session.js";
export * from "./lifecycle.js";
export * from "./mfa.js";
export * from "./password-policy.js";
export * from "./mailer.js";
export * from "../platform/integrations/oauth/index.js";
export * from "../platform/secrets/index.js";
