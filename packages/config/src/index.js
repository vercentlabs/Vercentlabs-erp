/**
 * Canonical Google Workspace identities for Vercentlabs.
 *
 * Keep customer-facing copy and automated delivery on role accounts so the
 * company does not expose a founder's mailbox or lose continuity as the team
 * grows. `sales` is the primary B2B contact; the other addresses own their
 * respective operational or regulated workflows.
 */
export const WORKSPACE_EMAILS = Object.freeze({
  primary: "sales@vercentlabs.com",
  sales: "sales@vercentlabs.com",
  support: "support@vercentlabs.com",
  privacy: "privacy@vercentlabs.com",
  security: "security@vercentlabs.com",
  careers: "careers@vercentlabs.com",
  billing: "billing@vercentlabs.com",
  authentication: "auth@vercentlabs.com",
  operations: "operations@vercentlabs.com",
  dmarc: "dmarc@vercentlabs.com",
});

export { booleanValue, ConfigurationError, databaseConfig, integerValue, originList, stringValue } from "./values.js";
export { loadSecretFiles, SECRET_ENV_KEYS, validateRuntimeEnvironment } from "./production.js";
