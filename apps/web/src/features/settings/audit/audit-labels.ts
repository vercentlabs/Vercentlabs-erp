// The one place audit event types become human language. Domain code writes
// stable machine keys; this presentation layer maps them. Unknown (older or
// newer) event types always render safely as "System activity".

const EVENT_LABELS: Record<string, string> = {
  "auth.session.created": "Signed in",
  "auth.mfa.enrolled": "Turned on two-step verification",
  "auth.mfa.disabled": "Turned off two-step verification",
  "auth.mfa.verified": "Completed two-step verification",
  "auth.mfa.recovery_codes_regenerated": "Created new recovery codes",
  "auth.mfa.organization_policy_changed": "Changed the two-step verification policy",
  "auth.invitation.resent": "Resent an invitation",
  "auth.invitation.revoked": "Revoked an invitation",
  "access.denied": "Was denied access",
  "organization.registered": "Created the organization",
  "organization.profile.updated": "Updated organization details",
  "company.created": "Created a company",
  "company.updated": "Updated a company",
  "branch.created": "Created a branch",
  "branch.updated": "Updated a branch",
  "user.access_updated": "Changed user access",
  "user.roles_assigned": "Changed user roles",
  "user.membership_status_changed": "Changed a member's status",
  "role.created": "Created a role",
  "role.updated": "Updated a role",
  "role.archived": "Archived a role",
  "module.enabled": "Turned on a module",
  "module.disabled": "Turned off a module",
  "billing.profile.updated": "Updated billing details",
  "billing.checkout.started": "Started a subscription checkout",
  "billing.checkout.confirmed": "Confirmed a subscription",
  "billing.checkout.intervention_required": "Checkout needs billing support review",
  "billing.checkout.superseded_cancelled": "Cancelled an unused checkout",
  "billing.seats.increased": "Added users to the plan",
  "billing.seats.reduction_scheduled": "Scheduled fewer users at renewal",
  "billing.seats.reduction_cancelled": "Kept the current number of users",
  "billing.seats.reduction_applied": "Reduced users at renewal",
  "billing.seats.change_failed": "A change to users was not applied",
  "billing.cancel.scheduled": "Scheduled cancellation at renewal",
  "billing.cancel.failed": "A cancellation was not accepted",
  "billing.reverted_to_free": "Moved to the Free plan",
  "billing.custom.provisioned": "Set up a Custom contract",
  "billing.reconciliation.intervention_required": "Billing needs support review",
  "billing.synced_from_provider": "Refreshed billing status",
  "crm.report.exported": "Exported a CRM report",
  "crm.lead.followup.scheduled": "Scheduled a lead follow-up",
  "integration.developer_app_created": "Created a developer app",
  "integration.developer_app_updated": "Updated a developer app",
  "integration.developer_app_revoked": "Revoked a developer app",
  "integration.api_key_created": "Created an API key",
  "integration.api_key_revoked": "Revoked an API key",
  "integration.oauth_connected": "Connected an account",
  "integration.oauth_revoked": "Disconnected an account",
  "integration.webhook_created": "Created a webhook",
  "integration.webhook_updated": "Updated a webhook",
  "integration.webhook_secret_rotated": "Rotated a webhook signing secret",
  "integration.webhook_redelivered": "Resent a webhook delivery",
  "integration.inbound_route_created": "Created an inbound email address",
  "integration.inbound_route_enabled": "Turned on an inbound email address",
  "integration.inbound_route_disabled": "Turned off an inbound email address",
  "numbering.policy_changed": "Changed document numbering",
  "numbering.counter_advanced": "Moved a document number sequence forward",
  "configuration.version_created": "Changed a feature setting",
  "configuration.schedule_cancelled": "Cancelled a scheduled setting change",
  "configuration.operator_version_created": "Operator changed a rollout control",
  "privacy.request_created": "Recorded a privacy request",
  "privacy.request_transitioned": "Updated a privacy request",
  "privacy.retention_policy_versioned": "Changed a retention policy",
  "ai.policy_versioned": "Changed the AI policy",
  "workflow.created": "Created an automation",
  "workflow.updated": "Changed an automation",
  "workflow.activated": "Turned on an automation",
  "workflow.deactivated": "Turned off an automation",
  "report.definition_created": "Saved a report",
  "report.definition_status_changed": "Changed a saved report",
  "report.run_requested": "Ran a report",
  "report.exported": "Downloaded a report",
};

// Area filter values are the first segment of the event type.
export const AUDIT_AREAS: Array<{ key: string; label: string }> = [
  { key: "auth", label: "Sign-in and security" },
  { key: "access", label: "Access checks" },
  { key: "organization", label: "Organization" },
  { key: "company", label: "Companies" },
  { key: "branch", label: "Branches" },
  { key: "user", label: "Users" },
  { key: "role", label: "Roles" },
  { key: "module", label: "Modules" },
  { key: "billing", label: "Billing" },
  { key: "crm", label: "CRM" },
  { key: "integration", label: "Integrations" },
  { key: "numbering", label: "Numbering" },
  { key: "configuration", label: "Feature configuration" },
  { key: "privacy", label: "Privacy" },
  { key: "ai", label: "AI governance" },
  { key: "workflow", label: "Automations" },
  { key: "report", label: "Reports" },
];

const ENTITY_LABELS: Record<string, string> = {
  user: "User",
  role: "Role",
  company: "Company",
  branch: "Branch",
  organization: "Organization",
  organization_module: "Module",
  organization_membership: "Membership",
  organization_invitation: "Invitation",
  billing: "Billing",
  session: "Session",
  developer_app: "Developer app",
  api_key: "API key",
  oauth_connection: "Connected account",
  webhook_subscription: "Webhook",
  webhook_delivery: "Webhook delivery",
  inbound_mail_route: "Inbound email address",
  numbering_policy: "Numbering",
  configuration: "Setting",
  privacy_request: "Privacy request",
  retention_policy: "Retention policy",
  ai_policy: "AI policy",
  workflow: "Automation",
  report_definition: "Saved report",
  report_run: "Report run",
};

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  name: "Name",
  code: "Code",
  moduleKey: "Module",
  enabled: "Enabled",
  roleIds: "Roles",
  primaryRoleId: "Primary role",
  companyIds: "Companies",
  branchIds: "Branches",
  paidSeats: "Paid users",
  pendingPaidSeats: "Users after renewal",
  planCode: "Plan",
  reason: "Reason",
  permissionKeys: "Permissions",
  riskLevel: "Risk level",
};

export function auditEventLabel(eventType: string) {
  return EVENT_LABELS[eventType] ?? "System activity";
}

export function isKnownAuditEvent(eventType: string) {
  return eventType in EVENT_LABELS;
}

export function auditEntityLabel(entityType: string) {
  return ENTITY_LABELS[entityType] ?? "Record";
}

export function auditFieldLabel(key: string) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const spaced = key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Plain-language rendering of a safe audit value (already redacted server-side).
export function auditValueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(auditValueText).join(", ") : "None";
  if (typeof value === "object") return `${Object.keys(value as object).length} fields`;
  return String(value);
}
