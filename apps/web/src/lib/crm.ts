import { CrmError } from "@vercent/api";
import type { CrmContext, CrmResourceKey } from "@vercent/shared-types";

import type { SessionContext } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/authorization";
import { HttpError } from "@/lib/http";

export type CrmField = {
  name: string;
  label: string;
  type:
    | "text"
    | "email"
    | "number"
    | "date"
    | "datetime-local"
    | "select"
    | "checkbox"
    | "textarea";
  required?: boolean;
  optionsKey?: string;
  options?: Array<{ value: string; label: string }>;
};
export type CrmColumn = {
  key: string;
  label: string;
  optionsKey?: string;
  format?: "status" | "currency" | "date" | "datetime" | "score";
};
export type CrmDefinition = {
  key: CrmResourceKey;
  title: string;
  singular: string;
  description: string;
  group: "Work" | "Engagement" | "Configuration" | "Automation";
  permission: string;
  fields: CrmField[];
  columns: CrmColumn[];
};

const status = (...values: string[]) =>
  values.map((value) => ({
    value,
    label: value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()),
  }));
const company = {
  name: "companyId",
  label: "Company",
  type: "select" as const,
  optionsKey: "companies",
};
const branch = {
  name: "branchId",
  label: "Branch",
  type: "select" as const,
  optionsKey: "branches",
};
const owner = {
  name: "ownerUserId",
  label: "Owner",
  type: "select" as const,
  optionsKey: "users",
};

export const crmDefinitions: Record<CrmResourceKey, CrmDefinition> = {
  leads: {
    key: "leads",
    title: "Leads",
    singular: "lead",
    group: "Work",
    description:
      "Capture, qualify, score, assign and convert every enquiry without losing its history.",
    permission: PERMISSIONS.crmLeadsManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "fullName", label: "Lead" },
      { key: "companyName", label: "Company" },
      { key: "status", label: "Status", format: "status" },
      { key: "score", label: "Score", format: "score" },
      { key: "estimatedValue", label: "Value", format: "currency" },
      { key: "nextFollowUpAt", label: "Next follow-up", format: "datetime" },
    ],
    fields: [
      company,
      branch,
      { name: "firstName", label: "First name", type: "text", required: true },
      { name: "lastName", label: "Last name", type: "text" },
      { name: "companyName", label: "Company / organisation", type: "text" },
      { name: "jobTitle", label: "Job title", type: "text" },
      { name: "email", label: "Email", type: "email" },
      { name: "mobile", label: "Mobile", type: "text" },
      { name: "phone", label: "Phone", type: "text" },
      {
        name: "sourceId",
        label: "Source",
        type: "select",
        optionsKey: "sources",
      },
      {
        name: "campaignId",
        label: "Campaign",
        type: "select",
        optionsKey: "campaigns",
      },
      owner,
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status(
          "new",
          "contacted",
          "working",
          "qualified",
          "unqualified",
        ),
      },
      {
        name: "priority",
        label: "Priority",
        type: "select",
        options: status("low", "medium", "high", "urgent"),
      },
      {
        name: "rating",
        label: "Rating",
        type: "select",
        options: status("cold", "warm", "hot"),
      },
      { name: "estimatedValue", label: "Estimated value", type: "number" },
      {
        name: "currencyCode",
        label: "Currency",
        type: "select",
        optionsKey: "currencies",
      },
      { name: "industry", label: "Industry", type: "text" },
      { name: "website", label: "Website", type: "text" },
      { name: "city", label: "City", type: "text" },
      { name: "state", label: "State", type: "text" },
      { name: "productInterest", label: "Product interest", type: "textarea" },
      {
        name: "nextFollowUpAt",
        label: "Next follow-up",
        type: "datetime-local",
      },
      { name: "consentEmail", label: "Email consent", type: "checkbox" },
      { name: "consentSms", label: "SMS consent", type: "checkbox" },
      { name: "consentWhatsapp", label: "WhatsApp consent", type: "checkbox" },
      { name: "doNotContact", label: "Do not contact", type: "checkbox" },
    ],
  },
  opportunities: {
    key: "opportunities",
    title: "Opportunities",
    singular: "opportunity",
    group: "Work",
    description:
      "Manage qualified revenue through configurable stages, probability and forecasting.",
    permission: PERMISSIONS.crmOpportunitiesManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Opportunity" },
      { key: "stageId", label: "Stage", optionsKey: "stages" },
      { key: "amount", label: "Amount", format: "currency" },
      { key: "probability", label: "Probability" },
      { key: "expectedCloseDate", label: "Expected close", format: "date" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      company,
      branch,
      { name: "name", label: "Opportunity name", type: "text", required: true },
      {
        name: "pipelineId",
        label: "Pipeline",
        type: "select",
        optionsKey: "pipelines",
      },
      { name: "stageId", label: "Stage", type: "select", optionsKey: "stages" },
      { name: "leadId", label: "Lead", type: "select", optionsKey: "leads" },
      {
        name: "partyId",
        label: "Customer",
        type: "select",
        optionsKey: "parties",
      },
      {
        name: "contactId",
        label: "Contact",
        type: "select",
        optionsKey: "contacts",
      },
      owner,
      { name: "amount", label: "Amount", type: "number" },
      {
        name: "currencyCode",
        label: "Currency",
        type: "select",
        optionsKey: "currencies",
      },
      { name: "probability", label: "Probability %", type: "number" },
      { name: "expectedCloseDate", label: "Expected close date", type: "date" },
      {
        name: "forecastCategory",
        label: "Forecast category",
        type: "select",
        options: status(
          "pipeline",
          "best_case",
          "committed",
          "closed",
          "omitted",
        ),
      },
      { name: "nextStep", label: "Next step", type: "textarea" },
      { name: "description", label: "Description", type: "textarea" },
    ],
  },
  activities: {
    key: "activities",
    title: "Activities",
    singular: "activity",
    group: "Work",
    description:
      "Schedule tasks, calls, meetings, messages and follow-ups with accountable ownership.",
    permission: PERMISSIONS.crmActivitiesManage,
    columns: [
      { key: "activityType", label: "Type" },
      { key: "subject", label: "Subject" },
      { key: "assignedTo", label: "Assigned to", optionsKey: "users" },
      { key: "dueAt", label: "Due", format: "datetime" },
      { key: "priority", label: "Priority", format: "status" },
      { key: "status", label: "Status", format: "status" },
    ],
    fields: [
      company,
      branch,
      {
        name: "entityType",
        label: "Related record type",
        type: "select",
        options: status(
          "lead",
          "opportunity",
          "party",
          "contact",
          "campaign",
          "general",
        ),
      },
      { name: "entityId", label: "Related record ID", type: "text" },
      {
        name: "activityType",
        label: "Activity type",
        type: "select",
        options: status(
          "task",
          "call",
          "meeting",
          "email",
          "whatsapp",
          "sms",
          "note",
        ),
      },
      { name: "subject", label: "Subject", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      {
        name: "assignedTo",
        label: "Assigned to",
        type: "select",
        optionsKey: "users",
      },
      {
        name: "priority",
        label: "Priority",
        type: "select",
        options: status("low", "medium", "high", "urgent"),
      },
      { name: "startAt", label: "Start", type: "datetime-local" },
      { name: "dueAt", label: "Due", type: "datetime-local" },
      { name: "reminderAt", label: "Reminder", type: "datetime-local" },
      { name: "location", label: "Location", type: "text" },
    ],
  },
  campaigns: {
    key: "campaigns",
    title: "Campaigns",
    singular: "campaign",
    group: "Engagement",
    description:
      "Attribute lead origin, budget, responses and conversions to governed campaigns.",
    permission: PERMISSIONS.crmCampaignsManage,
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Campaign" },
      { key: "campaignType", label: "Type" },
      { key: "status", label: "Status", format: "status" },
      { key: "budget", label: "Budget", format: "currency" },
      { key: "startDate", label: "Start", format: "date" },
    ],
    fields: [
      company,
      { name: "name", label: "Campaign name", type: "text", required: true },
      {
        name: "campaignType",
        label: "Campaign type",
        type: "select",
        options: status(
          "email",
          "event",
          "webinar",
          "referral",
          "partner",
          "advertising",
          "social",
          "other",
        ),
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status(
          "planned",
          "active",
          "paused",
          "completed",
          "cancelled",
        ),
      },
      { name: "startDate", label: "Start date", type: "date" },
      { name: "endDate", label: "End date", type: "date" },
      { name: "budget", label: "Budget", type: "number" },
      { name: "expectedRevenue", label: "Expected revenue", type: "number" },
      { name: "actualCost", label: "Actual cost", type: "number" },
      owner,
      { name: "description", label: "Description", type: "textarea" },
    ],
  },
  communications: {
    key: "communications",
    title: "Communication log",
    singular: "communication",
    group: "Engagement",
    description:
      "Keep a provider-neutral history of email, calls, SMS, chat and WhatsApp conversations.",
    permission: PERMISSIONS.crmCommunicationsManage,
    columns: [
      { key: "channel", label: "Channel" },
      { key: "direction", label: "Direction" },
      { key: "subject", label: "Subject" },
      { key: "status", label: "Status", format: "status" },
      { key: "occurredAt", label: "Occurred", format: "datetime" },
    ],
    fields: [
      {
        name: "channel",
        label: "Channel",
        type: "select",
        options: status("email", "whatsapp", "sms", "call", "chat", "other"),
      },
      {
        name: "direction",
        label: "Direction",
        type: "select",
        options: status("inbound", "outbound"),
      },
      { name: "leadId", label: "Lead", type: "select", optionsKey: "leads" },
      {
        name: "opportunityId",
        label: "Opportunity",
        type: "select",
        optionsKey: "opportunities",
      },
      {
        name: "partyId",
        label: "Business partner",
        type: "select",
        optionsKey: "parties",
      },
      {
        name: "contactId",
        label: "Contact",
        type: "select",
        optionsKey: "contacts",
      },
      { name: "provider", label: "Provider", type: "text" },
      { name: "subject", label: "Subject", type: "text" },
      {
        name: "body",
        label: "Message / notes",
        type: "textarea",
        required: true,
      },
      { name: "fromAddress", label: "From", type: "text" },
      { name: "occurredAt", label: "Occurred at", type: "datetime-local" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status(
          "logged",
          "draft",
          "queued",
          "sent",
          "delivered",
          "read",
          "failed",
          "received",
        ),
      },
    ],
  },
  pipelines: config(
    "pipelines",
    "Pipelines",
    "pipeline",
    PERMISSIONS.crmSettingsManage,
    [
      company,
      { name: "name", label: "Name", type: "text", required: true },
      { name: "code", label: "Code", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      { name: "isDefault", label: "Default pipeline", type: "checkbox" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("active", "inactive"),
      },
    ],
  ),
  stages: config(
    "stages",
    "Pipeline stages",
    "stage",
    PERMISSIONS.crmSettingsManage,
    [
      {
        name: "pipelineId",
        label: "Pipeline",
        type: "select",
        optionsKey: "pipelines",
        required: true,
      },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "code", label: "Code", type: "text", required: true },
      { name: "sequence", label: "Sequence", type: "number" },
      { name: "probability", label: "Probability %", type: "number" },
      {
        name: "forecastCategory",
        label: "Forecast category",
        type: "select",
        options: status(
          "pipeline",
          "best_case",
          "committed",
          "closed",
          "omitted",
        ),
      },
      { name: "isWon", label: "Won stage", type: "checkbox" },
      { name: "isLost", label: "Lost stage", type: "checkbox" },
      { name: "staleAfterDays", label: "Stale after days", type: "number" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("active", "inactive"),
      },
    ],
  ),
  sources: config(
    "sources",
    "Lead sources",
    "source",
    PERMISSIONS.crmSettingsManage,
    [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "code", label: "Code", type: "text", required: true },
      { name: "channel", label: "Channel", type: "text" },
      { name: "isDefault", label: "Default source", type: "checkbox" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("active", "inactive"),
      },
    ],
  ),
  "lost-reasons": config(
    "lost-reasons",
    "Lost reasons",
    "lost reason",
    PERMISSIONS.crmSettingsManage,
    [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "code", label: "Code", type: "text", required: true },
      { name: "category", label: "Category", type: "text" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("active", "inactive"),
      },
    ],
  ),
  tags: config("tags", "CRM tags", "tag", PERMISSIONS.crmSettingsManage, [
    { name: "name", label: "Name", type: "text", required: true },
    { name: "color", label: "Colour", type: "text" },
    {
      name: "status",
      label: "Status",
      type: "select",
      options: status("active", "inactive"),
    },
  ]),
  "scoring-rules": config(
    "scoring-rules",
    "Lead scoring rules",
    "scoring rule",
    PERMISSIONS.crmAutomationManage,
    [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "sequence", label: "Sequence", type: "number" },
      { name: "fieldName", label: "Lead field", type: "text", required: true },
      {
        name: "operator",
        label: "Operator",
        type: "select",
        options: status(
          "equals",
          "not_equals",
          "contains",
          "not_empty",
          "empty",
          "greater_than",
          "less_than",
          "in",
        ),
      },
      { name: "comparisonValue", label: "Comparison JSON", type: "textarea" },
      { name: "points", label: "Points", type: "number" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("active", "inactive"),
      },
    ],
  ),
  "assignment-rules": config(
    "assignment-rules",
    "Assignment rules",
    "assignment rule",
    PERMISSIONS.crmAutomationManage,
    [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "sequence", label: "Sequence", type: "number" },
      { name: "criteria", label: "Criteria JSON", type: "textarea" },
      {
        name: "assignmentMode",
        label: "Mode",
        type: "select",
        options: status("fixed", "round_robin"),
      },
      {
        name: "assigneeUserId",
        label: "Fixed assignee",
        type: "select",
        optionsKey: "users",
      },
      {
        name: "roundRobinUserIds",
        label: "Round-robin user IDs JSON",
        type: "textarea",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("active", "inactive"),
      },
    ],
  ),
  sequences: config(
    "sequences",
    "Follow-up sequences",
    "sequence",
    PERMISSIONS.crmAutomationManage,
    [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      owner,
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("draft", "active", "paused", "archived"),
      },
    ],
  ),
  "sequence-steps": config(
    "sequence-steps",
    "Sequence steps",
    "sequence step",
    PERMISSIONS.crmAutomationManage,
    [
      {
        name: "sequenceId",
        label: "Sequence",
        type: "select",
        optionsKey: "sequences",
        required: true,
      },
      {
        name: "stepOrder",
        label: "Step order",
        type: "number",
        required: true,
      },
      { name: "delayMinutes", label: "Delay in minutes", type: "number" },
      {
        name: "actionType",
        label: "Action type",
        type: "select",
        options: status("task", "call", "email", "whatsapp", "sms"),
      },
      { name: "subjectTemplate", label: "Subject template", type: "text" },
      { name: "bodyTemplate", label: "Body template", type: "textarea" },
      {
        name: "assignedToOwner",
        label: "Assign to record owner",
        type: "checkbox",
      },
    ],
  ),
  "sequence-enrollments": config(
    "sequence-enrollments",
    "Sequence enrollments",
    "sequence enrollment",
    PERMISSIONS.crmAutomationManage,
    [
      {
        name: "sequenceId",
        label: "Sequence",
        type: "select",
        optionsKey: "sequences",
        required: true,
      },
      { name: "leadId", label: "Lead", type: "select", optionsKey: "leads" },
      {
        name: "contactId",
        label: "Contact",
        type: "select",
        optionsKey: "contacts",
      },
      {
        name: "opportunityId",
        label: "Opportunity",
        type: "select",
        optionsKey: "opportunities",
      },
      { name: "nextRunAt", label: "Next run", type: "datetime-local" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("active", "paused", "completed", "cancelled"),
      },
    ],
  ),
  "automation-rules": config(
    "automation-rules",
    "Automation rules",
    "automation rule",
    PERMISSIONS.crmAutomationManage,
    [
      { name: "name", label: "Name", type: "text", required: true },
      {
        name: "eventType",
        label: "Event",
        type: "select",
        options: status(
          "lead.created",
          "lead.updated",
          "lead.qualified",
          "opportunity.created",
          "opportunity.stage_changed",
          "activity.overdue",
          "campaign.member_responded",
        ),
      },
      { name: "sequence", label: "Sequence", type: "number" },
      { name: "conditions", label: "Conditions JSON", type: "textarea" },
      { name: "actions", label: "Actions JSON", type: "textarea" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("active", "inactive"),
      },
    ],
  ),
  "capture-forms": config(
    "capture-forms",
    "Lead capture forms",
    "capture form",
    PERMISSIONS.crmCaptureManage,
    [
      company,
      branch,
      { name: "name", label: "Name", type: "text", required: true },
      {
        name: "sourceId",
        label: "Source",
        type: "select",
        optionsKey: "sources",
      },
      {
        name: "campaignId",
        label: "Campaign",
        type: "select",
        optionsKey: "campaigns",
      },
      owner,
      {
        name: "allowedOrigins",
        label: "Allowed origins JSON",
        type: "textarea",
      },
      {
        name: "requiredFields",
        label: "Required fields JSON",
        type: "textarea",
      },
      { name: "successMessage", label: "Success message", type: "textarea" },
      {
        name: "rateLimitPerHour",
        label: "Hourly submission limit",
        type: "number",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("active", "inactive"),
      },
    ],
  ),
  competitors: config(
    "competitors",
    "Competitors",
    "competitor",
    PERMISSIONS.crmSettingsManage,
    [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "website", label: "Website", type: "text" },
      { name: "strengths", label: "Strengths", type: "textarea" },
      { name: "weaknesses", label: "Weaknesses", type: "textarea" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("active", "inactive"),
      },
    ],
  ),
  "forecast-targets": config(
    "forecast-targets",
    "Forecast targets",
    "target",
    PERMISSIONS.crmSettingsManage,
    [
      company,
      {
        name: "userId",
        label: "Salesperson",
        type: "select",
        optionsKey: "users",
      },
      {
        name: "periodStart",
        label: "Period start",
        type: "date",
        required: true,
      },
      { name: "periodEnd", label: "Period end", type: "date", required: true },
      {
        name: "currencyCode",
        label: "Currency",
        type: "select",
        optionsKey: "currencies",
      },
      { name: "targetAmount", label: "Target amount", type: "number" },
    ],
  ),
  integrations: config(
    "integrations",
    "Communication integrations",
    "integration",
    PERMISSIONS.crmSettingsManage,
    [
      {
        name: "provider",
        label: "Provider",
        type: "select",
        options: status(
          "gmail",
          "microsoft365",
          "whatsapp",
          "twilio",
          "zoom",
          "webhook",
          "other",
        ),
      },
      {
        name: "displayName",
        label: "Display name",
        type: "text",
        required: true,
      },
      {
        name: "credentialReference",
        label: "Secret-manager reference",
        type: "text",
      },
      {
        name: "configuration",
        label: "Non-secret configuration JSON",
        type: "textarea",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("disconnected", "connected", "error", "disabled"),
      },
    ],
  ),
  "webhook-subscriptions": config(
    "webhook-subscriptions",
    "Webhook subscriptions",
    "webhook",
    PERMISSIONS.crmSettingsManage,
    [
      { name: "name", label: "Name", type: "text", required: true },
      {
        name: "endpointUrl",
        label: "Endpoint URL",
        type: "text",
        required: true,
      },
      { name: "eventTypes", label: "Event types JSON", type: "textarea" },
      {
        name: "secretReference",
        label: "Secret-manager reference",
        type: "text",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: status("active", "inactive"),
      },
    ],
  ),
  "saved-views": config(
    "saved-views",
    "Saved views",
    "saved view",
    PERMISSIONS.crmView,
    [
      { name: "userId", label: "User", type: "select", optionsKey: "users" },
      {
        name: "resource",
        label: "Resource",
        type: "select",
        options: status(
          "leads",
          "opportunities",
          "activities",
          "campaigns",
          "communications",
        ),
      },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "filters", label: "Filters JSON", type: "textarea" },
      { name: "sort", label: "Sort JSON", type: "textarea" },
      { name: "columns", label: "Columns JSON", type: "textarea" },
      { name: "isDefault", label: "Default view", type: "checkbox" },
    ],
  ),
};

function config(
  key: CrmResourceKey,
  title: string,
  singular: string,
  permission: string,
  fields: CrmField[],
): CrmDefinition {
  return {
    key,
    title,
    singular,
    permission,
    fields,
    group:
      key === "scoring-rules" ||
      key === "assignment-rules" ||
      key === "sequences"
        ? "Automation"
        : "Configuration",
    description: `Configure governed ${title.toLowerCase()} for the CRM workspace.`,
    columns: [
      { key: "name", label: "Name" },
      { key: "code", label: "Code" },
      { key: "status", label: "Status", format: "status" },
    ],
  };
}

export function isCrmDefinition(value: string): value is CrmResourceKey {
  return value in crmDefinitions;
}
export function crmContext(session: SessionContext): CrmContext {
  return {
    organizationId: session.organizationId as string,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies:
      session.roleSlugs.includes("organization_owner") ||
      session.roleSlugs.includes("system_administrator"),
  };
}
export function rethrowCrmError(error: unknown): never {
  if (error instanceof CrmError)
    throw new HttpError(error.status, error.message);
  throw error;
}
