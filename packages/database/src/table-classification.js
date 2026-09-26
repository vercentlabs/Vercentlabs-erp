// The ONE authoritative classification of every table in the `public`
// schema. `verify:db` statically checks it against the migrations and
// `test:production:db` checks it against a live database: a new public table
// that is not classified here fails CI, and an ORGANIZATION_SCOPED table must
// carry organization_id, ENABLE + FORCE row-level security and the canonical
// `organization_isolation` policy.
//
// Classes
//   ORGANIZATION_SCOPED   tenant-owned rows; database-level isolation on
//                         app.current_organization_id (set only from the
//                         authenticated session, API key or durable job).
//   ORGANIZATION_CHILD    tenant-owned rows without their own organization_id,
//                         isolated through their parent row (EXISTS policy).
//   GLOBAL_CATALOGUE      reference data shared by every organisation; runtime
//                         roles may only read it.
//   AUTH_IDENTITY         identity/authentication data that must work before
//                         any organisation is known; protected by exact
//                         predicates in the one auth service, hashed secrets
//                         and constraints — not by organisation RLS.
//   ORGANIZATION_DIRECTORY the organisation register itself (its id IS the
//                         tenant key): read before a context exists (session
//                         resolution, org switcher, public pages).
//   OPERATOR_RUNTIME      SaaS billing records that provider reconciliation
//                         and recovery process across organisations by
//                         provider identifiers; only core/billing touches them.
//   PROVIDER_INGRESS      raw provider events recorded before the organisation
//                         is resolved; minimal payload, processed into
//                         organisation-scoped state.
//   MIGRATION_INTERNAL    migration history; runtime roles may only read it.
//   RETIRED               kept only until its contract migration drops it; no
//                         runtime role has any privilege on it.
export const TABLE_CLASSES = Object.freeze([
  "ORGANIZATION_SCOPED",
  "ORGANIZATION_CHILD",
  "GLOBAL_CATALOGUE",
  "AUTH_IDENTITY",
  "ORGANIZATION_DIRECTORY",
  "OPERATOR_RUNTIME",
  "PROVIDER_INGRESS",
  "MIGRATION_INTERNAL",
  "RETIRED",
]);

const scoped = (reason = null, options = {}) => Object.freeze({ class: "ORGANIZATION_SCOPED", reason, ...options });
const other = (klass, reason, options = {}) => Object.freeze({ class: klass, reason, ...options });

const AUTH_REASON = "Authentication runs before an organisation is known; exact predicates in core/auth + hashed secrets.";
const BILLING_REASON = "Provider reconciliation/recovery works across organisations by provider ids; only core/billing reads or writes it.";

export const PUBLIC_TABLES = Object.freeze({
  // Shared Access and organisation structure
  companies: scoped(),
  branches: scoped(),
  departments: scoped(),
  teams: scoped(),
  cost_centers: scoped(),
  roles: scoped(),
  role_permissions: other("ORGANIZATION_CHILD", "Permission grants of an organisation's role; isolated through roles.", { parent: { table: "roles", column: "role_id" } }),
  role_version_snapshots: scoped(),
  user_role_assignments: scoped(),
  access_assignment_events: scoped(),
  membership_company_access: scoped(),
  membership_branch_access: scoped(),
  membership_department_access: scoped(),
  membership_team_access: scoped(),
  // A user may also read their OWN memberships across organisations (session
  // resolution, organisation switcher) through app.current_user_id.
  organization_memberships: scoped(null, { selfReadColumn: "user_id" }),
  organization_invitations: scoped(),
  organization_invitation_roles: scoped(),
  organization_invitation_company_access: scoped(),
  organization_invitation_branch_access: scoped(),
  organization_invitation_department_access: scoped(),
  organization_invitation_team_access: scoped(),
  organization_modules: scoped(),
  user_preferences: scoped(),
  // Shared Runtime
  notifications: scoped(),
  notification_preferences: scoped(),
  approval_requests: scoped(),
  approval_decisions: scoped(),
  // Platform-operator events (billing webhooks, secret rotation) have no organisation.
  audit_events: scoped("Append-only; operator events without an organisation may be written but are never readable by runtime roles.", { nullableOrganization: true, appendOnly: true }),
  favourites: scoped(),
  recent_records: scoped(),
  activities: scoped(),
  comments: scoped(),
  // Shared Platform services
  attachments: scoped(),
  custom_field_definitions: scoped(),
  custom_field_values: scoped(),
  custom_field_value_history: scoped(),
  tag_definitions: scoped(),
  entity_tags: scoped(),
  developer_apps: scoped(),
  api_keys: scoped(),
  oauth_states: scoped(),
  oauth_connections: scoped(),
  inbound_mail_routes: scoped(),
  inbound_mail_events: scoped(),
  configuration_versions: scoped(),
  feature_flags: scoped(),
  privacy_requests: scoped(),
  privacy_retention_policies: scoped(),
  ai_policies: scoped(),
  ai_requests: scoped(),
  ai_evaluations: scoped(),
  workflow_definitions: scoped(),
  workflow_definition_versions: scoped(),
  workflow_runs: scoped(),
  report_definitions: scoped(),
  report_runs: scoped(),
  sales_public_quote_tokens: scoped(),

  // Not organisation-RLS protected — every entry states why.
  permissions: other("GLOBAL_CATALOGUE", "The platform permission catalogue shared by every organisation."),
  access_conflict_rules: other("GLOBAL_CATALOGUE", "Segregation-of-duties rules over the permission catalogue."),
  billing_plans: other("GLOBAL_CATALOGUE", "The SaaS plan catalogue."),
  billing_plan_prices: other("GLOBAL_CATALOGUE", "The SaaS price catalogue."),
  users: other("AUTH_IDENTITY", AUTH_REASON),
  sessions: other("AUTH_IDENTITY", AUTH_REASON),
  email_verification_tokens: other("AUTH_IDENTITY", AUTH_REASON),
  password_reset_tokens: other("AUTH_IDENTITY", AUTH_REASON),
  password_history: other("AUTH_IDENTITY", AUTH_REASON),
  login_events: other("AUTH_IDENTITY", AUTH_REASON),
  auth_rate_limits: other("AUTH_IDENTITY", "Rate-limit buckets keyed by hashed client/identity before authentication."),
  mfa_recovery_codes: other("AUTH_IDENTITY", AUTH_REASON),
  mobile_refresh_token_history: other("AUTH_IDENTITY", AUTH_REASON),
  organizations: other("ORGANIZATION_DIRECTORY", "The tenant register (its id is the tenant key); read before a context exists by session resolution, the organisation switcher, public pages and the worker's organisation enumeration."),
  organization_subscriptions: other("OPERATOR_RUNTIME", BILLING_REASON),
  billing_customers: other("OPERATOR_RUNTIME", BILLING_REASON),
  billing_checkout_sessions: other("OPERATOR_RUNTIME", BILLING_REASON),
  billing_entitlement_overrides: other("OPERATOR_RUNTIME", BILLING_REASON),
  billing_invoices: other("OPERATOR_RUNTIME", BILLING_REASON),
  billing_payments: other("OPERATOR_RUNTIME", BILLING_REASON),
  billing_seat_changes: other("OPERATOR_RUNTIME", BILLING_REASON),
  billing_usage_events: other("OPERATOR_RUNTIME", BILLING_REASON),
  billing_usage_monthly: other("OPERATOR_RUNTIME", BILLING_REASON),
  billing_webhook_events: other("PROVIDER_INGRESS", "Signed Razorpay events are stored before the organisation is resolved from provider ids; payload is provider metadata only."),
  schema_migrations: other("MIGRATION_INTERNAL", "Migration history; runtime roles read it for readiness."),
  numbering_series: other("RETIRED", "Replaced by tenant.document_numbering_policies/document_sequences (migration 181); dropped by contract migration."),
  mobile_idempotency_keys: other("RETIRED", "Never used by any runtime path; dropped by contract migration."),
});

export function classifyPublicTable(name) {
  return PUBLIC_TABLES[name] ?? null;
}

export function organizationScopedTables() {
  return Object.entries(PUBLIC_TABLES)
    .filter(([, entry]) => entry.class === "ORGANIZATION_SCOPED")
    .map(([name]) => name);
}

// Every SECURITY DEFINER function in public/tenant, and which runtime role may
// EXECUTE it (EXECUTE is revoked from PUBLIC; db:provision:runtime-role grants
// exactly this). Trigger functions need no EXECUTE grant. `retired` functions
// have no caller and are dropped by a contract migration.
export const DEFINER_FUNCTIONS = Object.freeze({
  "public.resolve_api_key_organization": Object.freeze({ web: true, worker: false, reason: "API key -> organisation (pre-context ingress)." }),
  "public.resolve_invitation_organization": Object.freeze({ web: true, worker: false, reason: "Invitation token -> organisation (pre-context ingress)." }),
  "public.pending_invitations_for_email": Object.freeze({ web: true, worker: false, reason: "The signed-in user's own pending invitations." }),
  "public.resolve_public_quote_organization": Object.freeze({ web: true, worker: false, reason: "Public quote token -> organisation." }),
  "public.resolve_inbound_mail_route_organization": Object.freeze({ web: true, worker: false, reason: "Inbound email route key -> organisation." }),
  "public.record_billing_audit_event": Object.freeze({ web: true, worker: true, reason: "Billing audit rows across organisations (billing.* only)." }),
  "public.billable_user_count": Object.freeze({ web: true, worker: true, reason: "The billable-user counts for billing reconciliation." }),
  "public.revoke_sessions_after_access_change": Object.freeze({ trigger: true, reason: "Revokes sessions after access changes (trigger)." }),
  "tenant.crm_public_meeting_link": Object.freeze({ web: true, worker: false, reason: "Public booking link token -> organisation." }),
  "tenant.crm_public_meeting_booking": Object.freeze({ web: true, worker: false, reason: "Public booking management token -> organisation." }),
  "tenant.crm_public_capture_form": Object.freeze({ web: true, worker: false, reason: "Public lead capture form token -> organisation." }),
  "tenant.crm_seed_duplicate_rules_defaults": Object.freeze({ trigger: true, reason: "Seeds CRM defaults for a new organisation (trigger)." }),
  "tenant.crm_seed_lead_intelligence_defaults": Object.freeze({ trigger: true, reason: "Seeds CRM defaults for a new organisation (trigger)." }),
  "tenant.crm_seed_lead_qualification_criteria_defaults": Object.freeze({ trigger: true, reason: "Seeds CRM defaults for a new organisation (trigger)." }),
  "tenant.crm_public_acquisition_connection": Object.freeze({ retired: true, reason: "No caller; dropped by contract migration." }),
  "tenant.crm_public_capture_form_v2": Object.freeze({ retired: true, reason: "No caller; dropped by contract migration." }),
  "tenant.crm_public_chat_session": Object.freeze({ retired: true, reason: "No caller; dropped by contract migration." }),
  "tenant.crm_public_marketing_event": Object.freeze({ retired: true, reason: "No caller; dropped by contract migration." }),
  "tenant.crm_public_marketing_survey": Object.freeze({ retired: true, reason: "No caller; dropped by contract migration." }),
  "tenant.crm_public_sync_account": Object.freeze({ retired: true, reason: "No caller; dropped by contract migration." }),
});

// The table privileges each runtime role receives, by class. Tenant-schema
// tables are all organisation-RLS protected business data (DML for both).
const DML = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE"]);
const READ = Object.freeze(["SELECT"]);
const NONE = Object.freeze([]);
const WORKER_AUTH_READS = new Set(["users"]);

export function runtimePrivileges(role, table, entry) {
  if (!["web", "worker"].includes(role)) throw new Error("role must be web or worker");
  switch (entry?.class) {
    case "ORGANIZATION_SCOPED":
      return entry.appendOnly ? Object.freeze(["SELECT", "INSERT"]) : DML;
    case "ORGANIZATION_CHILD":
    case "OPERATOR_RUNTIME":
      return DML;
    case "GLOBAL_CATALOGUE":
    case "MIGRATION_INTERNAL":
      return READ;
    case "AUTH_IDENTITY":
      return role === "web" ? DML : WORKER_AUTH_READS.has(table) ? READ : NONE;
    case "ORGANIZATION_DIRECTORY":
      return role === "web" ? Object.freeze(["SELECT", "INSERT", "UPDATE"]) : READ;
    case "PROVIDER_INGRESS":
      return role === "web" ? Object.freeze(["SELECT", "INSERT", "UPDATE"]) : DML;
    case "RETIRED":
      return NONE;
    default:
      throw new Error(`public.${table} is not classified`);
  }
}
