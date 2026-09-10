import type { CrmResourceKey } from "@vercentlabs/shared-types";

/**
 * Canonical customer-facing CRM scope.
 *
 * These thirty IDs are the product contract. Existing internal tables,
 * ingestion adapters and historical services may continue to support these
 * capabilities, but they must not create additional customer-facing CRM
 * workspaces unless the canonical register is deliberately expanded.
 */
export const CRM_FEATURES = Object.freeze([
  ["F001", "Leads"],
  ["F002", "Accounts / companies"],
  ["F003", "Contacts"],
  ["F004", "Lead sources"],
  ["F005", "Lead assignment"],
  ["F006", "Lead qualification"],
  ["F007", "Lead stages and statuses"],
  ["F008", "Duplicate detection"],
  ["F009", "Opportunities"],
  ["F010", "Opportunity pipeline"],
  ["F011", "Probability and expected revenue"],
  ["F012", "Sales stages"],
  ["F013", "Calls"],
  ["F014", "Meetings"],
  ["F015", "Tasks"],
  ["F016", "Follow-ups and reminders"],
  ["F017", "Notes and attachments"],
  ["F018", "Email history"],
  ["F019", "Activity timeline"],
  ["F020", "Territories and sales teams"],
  ["F021", "Lead import and export"],
  ["F022", "Lead-to-opportunity conversion"],
  ["F023", "Opportunity-to-quotation conversion"],
  ["F024", "Pipeline dashboard"],
  ["F025", "Sales forecast"],
  ["F026", "Won / lost reasons"],
  ["F027", "Basic lead scoring"],
  ["F028", "Custom fields and tags"],
  ["F029", "Bulk actions"],
  ["F030", "CRM reports"],
] as const);

export type CrmFeatureId = (typeof CRM_FEATURES)[number][0];

/** Standalone generic resource screens permitted inside /crm/[resource]. */
export const CRM_UI_RESOURCE_KEYS = Object.freeze([
  "leads",
  "opportunities",
  "activities",
  "pipelines",
  "stages",
  "sources",
  "lost-reasons",
  "qualification-criteria",
  "tags",
  "scoring-rules",
  "assignment-rules",
  "sales-teams",
  "sales-team-members",
  "territories",
  "territory-assignments",
  "quota-plans",
  "custom-object-definitions",
  "custom-field-definitions",
  "custom-records",
] as const satisfies readonly CrmResourceKey[]);

/**
 * Generic API resources needed by the canonical CRM experience. Communications
 * stays API-only because F018/F019 use it inside record timelines; it is not a
 * standalone workspace. deal-risks/buying-committees/buying-committee-members
 * (F009) are the same shape — real record-scoped generic CRM resources
 * consumed exclusively from inside the Opportunity 360 workspace, never as a
 * standalone settings screen. Prompt 5 found these three unreachable: the
 * backend resource definitions and the Opportunity 360 UI that calls them
 * already existed, but this allowlist (which every /api/crm/[resource]
 * request is gated on) never included them, so every create/read/update
 * request 404'd before reaching the resource logic at all.
 */
export const CRM_API_RESOURCE_KEYS = Object.freeze([
  ...CRM_UI_RESOURCE_KEYS,
  "communications",
  "deal-risks",
  "buying-committees",
  "buying-committee-members",
] as const satisfies readonly CrmResourceKey[]);

export const CRM_REPORT_KEYS = Object.freeze([
  "pipeline",
  "conversion",
  "sources",
  "activities",
  "forecast",
  "revenue-operations",
  "pipeline-intelligence",
  "engagement-intelligence",
  "relationship-coverage",
  "campaigns",
  "account-health",
  "partner-pipeline",
  "privacy",
  "ai-governance",
] as const);

export const CRM_SETUP_RESOURCE_KEYS = Object.freeze([
  "sources",
  "assignment-rules",
  "scoring-rules",
  "pipelines",
  "stages",
  "lost-reasons",
  "qualification-criteria",
  "sales-teams",
  "sales-team-members",
  "territories",
  "territory-assignments",
  "quota-plans",
  "tags",
] as const satisfies readonly CrmResourceKey[]);

const UI_RESOURCES = new Set<string>(CRM_UI_RESOURCE_KEYS);
const API_RESOURCES = new Set<string>(CRM_API_RESOURCE_KEYS);
const REPORTS = new Set<string>(CRM_REPORT_KEYS);
const SETUP_RESOURCES = new Set<string>(CRM_SETUP_RESOURCE_KEYS);

export function isCrmUiResource(value: string): value is (typeof CRM_UI_RESOURCE_KEYS)[number] {
  return UI_RESOURCES.has(value);
}

export function isCrmApiResource(value: string): value is (typeof CRM_API_RESOURCE_KEYS)[number] {
  return API_RESOURCES.has(value);
}

export function isCrmReport(value: string): value is (typeof CRM_REPORT_KEYS)[number] {
  return REPORTS.has(value);
}

export function isCrmSetupResource(value: string): value is (typeof CRM_SETUP_RESOURCE_KEYS)[number] {
  return SETUP_RESOURCES.has(value);
}
