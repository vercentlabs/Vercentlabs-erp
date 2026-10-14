import { CRM_RESOURCE_KEYS } from "@vercentlabs/shared-types";
import { CrmError } from "./errors.js";



export const resourceSet = new Set(CRM_RESOURCE_KEYS);

// Tables that do not carry every audit column. Generic create/update/archive
// write only the audit columns a table has — writing created_by/updated_by/
// updated_at unconditionally failed every generic write to these resources
// (42703 "column does not exist"). Verified against the schema:
// tests/integration/crm/generic-resource-audit-db.test.mjs.
const MISSING_AUDIT_COLUMNS = Object.freeze({});

export function auditColumns(resource) {
  const missing = new Set(MISSING_AUDIT_COLUMNS[resource] ?? []);
  return {
    createdBy: !missing.has("created_by"),
    updatedBy: !missing.has("updated_by"),
    updatedAt: !missing.has("updated_at"),
  };
}



export const resources = Object.freeze({
  // Reference definition only: other CRM records use it to scope and look up
  // the lead they link to. Leads are created and changed through leads/.
  leads: {
    table: "tenant.crm_leads",
    codeEntity: "crm_lead",
    codeField: "code",
    search: ["code", "first_name", "last_name", "full_name", "email", "phone", "mobile", "company_name", "product_interest"],
    orderBy: "updated_at DESC, created_at DESC, id DESC",
    statusColumn: "status",
    ownerField: "ownerUserId",
    fields: {
      code: "code",
      firstName: "first_name",
      lastName: "last_name",
      email: "email",
      phone: "phone",
      mobile: "mobile",
      companyName: "company_name",
      jobTitle: "job_title",
      website: "website",
      industry: "industry",
      sourceId: "source_id",
      sourceDetail: "source_detail",
      stage: "stage",
      status: "status",
      priority: "priority",
      rating: "rating",
      ownerUserId: "owner_user_id",
      teamId: "team_id",
      estimatedValue: "estimated_value",
      currencyCode: "currency_code",
      city: "city",
      state: "state",
      countryCode: "country_code",
      productInterest: "product_interest",
      consentEmail: "consent_email",
      consentSms: "consent_sms",
      consentWhatsapp: "consent_whatsapp",
      doNotContact: "do_not_contact",
      customData: "custom_data",
    },
  },
  opportunities: {
    table: "tenant.crm_opportunities",
    codeEntity: "crm_opportunity",
    codeField: "code",
    search: ["code", "name", "description", "next_step", "loss_notes"],
    orderBy: "expected_close_date ASC NULLS LAST, updated_at DESC",
    statusColumn: "status",
    ownerField: "ownerUserId",
    fields: {
      code: "code",
      pipelineId: "pipeline_id",
      stageId: "stage_id",
      leadId: "lead_id",
      partyId: "party_id",
      contactId: "contact_id",
      sourceId: "source_id",
      ownerUserId: "owner_user_id",
      name: "name",
      description: "description",
      amount: "amount",
      currencyCode: "currency_code",
      probability: "probability",
      expectedRevenue: "expected_revenue",
      expectedCloseDate: "expected_close_date",
      actualCloseDate: "actual_close_date",
      status: "status",
      forecastCategory: "forecast_category",
      nextStep: "next_step",
      lostReasonId: "lost_reason_id",
      lossNotes: "loss_notes",
      outcomeReasonId: "outcome_reason_id",
      outcomeNotes: "outcome_notes",
      customData: "custom_data",
    },
  },
  activities: {
    table: "tenant.crm_activities",
    search: ["subject", "description", "outcome", "location"],
    orderBy: "COALESCE(due_at, start_at, created_at) ASC, created_at DESC",
    statusColumn: "status",
    ownerField: "assignedTo",
    fields: {
      entityType: "entity_type",
      entityId: "entity_id",
      activityType: "activity_type",
      subject: "subject",
      description: "description",
      status: "status",
      priority: "priority",
      assignedTo: "assigned_to",
      startAt: "start_at",
      dueAt: "due_at",
      endAt: "end_at",
      reminderAt: "reminder_at",
      outcome: "outcome",
      location: "location",
      recurringRule: "recurring_rule",
    },
  },
  stages: {
    table: "tenant.crm_pipeline_stages",
    search: ["name", "code", "forecast_category"],
    orderBy: "pipeline_id ASC, sequence ASC",
    statusColumn: "status",
    fields: {
      pipelineId: "pipeline_id",
      name: "name",
      code: "code",
      sequence: "sequence",
      probability: "probability",
      forecastCategory: "forecast_category",
      isWon: "is_won",
      isLost: "is_lost",
      staleAfterDays: "stale_after_days",
      status: "status",
    },
  },
  sources: {
    table: "tenant.crm_lead_sources",
    search: ["name", "code", "channel"],
    orderBy: "is_default DESC, name ASC",
    statusColumn: "status",
    fields: {
      name: "name",
      code: "code",
      channel: "channel",
      isDefault: "is_default",
      status: "status",
    },
  },
  "lost-reasons": {
    table: "tenant.crm_lost_reasons",
    search: ["name", "code", "category"],
    orderBy: "status='active' DESC, sequence ASC, name ASC",
    statusColumn: "status",
    fields: {
      name: "name",
      code: "code",
      category: "category",
      outcomeType: "outcome_type",
      sequence: "sequence",
      status: "status",
    },
  },
  "capture-forms": {
    table: "tenant.crm_capture_forms",
    search: ["name", "public_key", "success_message"],
    orderBy: "status ASC, name ASC",
    statusColumn: "status",
    fields: {
      name: "name",
      sourceId: "source_id",
      ownerUserId: "owner_user_id",
      allowedOrigins: "allowed_origins",
      requiredFields: "required_fields",
      successMessage: "success_message",
      rateLimitPerHour: "rate_limit_per_hour",
      status: "status",
    },
  },
  // Webhook subscriptions moved to the Shared Platform (Settings >
  // Integrations > Webhooks; tenant migration 184).
  "sales-teams": {
    table: "tenant.crm_sales_teams",
    search: ["code", "name"],
    orderBy: "name ASC",
    statusColumn: "status",
    fields: {
      parentTeamId: "parent_team_id",
      code: "code",
      name: "name",
      managerUserId: "manager_user_id",
      defaultPipelineId: "default_pipeline_id",
      currencyCode: "currency_code",
      status: "status",
    },
  },
  "sales-team-members": {
    table: "tenant.crm_sales_team_members",
    search: ["member_role", "status"],
    orderBy: "effective_from DESC, created_at DESC",
    statusColumn: "status",
    fields: {
      teamId: "team_id",
      userId: "user_id",
      memberRole: "member_role",
      allocationPercent: "allocation_percent",
      effectiveFrom: "effective_from",
      effectiveTo: "effective_to",
      status: "status",
    },
  },
});



export function definitionFor(resource) {
  const definition = resources[resource];
  if (!definition) throw new CrmError(404, "Unknown CRM resource.");
  return definition;
}



export function isCrmResource(value) {
  return resourceSet.has(value);
}
