/**
 * Governance statements every module inherits from the Shared Platform
 * (roles and permissions, audit logs, concurrency protection) — written once,
 * reused by each module's `governance` list.
 */
export const PLATFORM_GOVERNANCE = Object.freeze({
  permissions: { title: "Role-based permissions", description: "What each person can see and do is governed by their role's permissions, checked on the server — not just hidden in the interface." },
  audit: { title: "Audit logs", description: "Significant actions are recorded in the platform audit log, which the database protects from being edited or deleted." },
  concurrency: { title: "Concurrency protection", description: "Two people changing the same record at the same time can't silently overwrite each other's work." },
});
