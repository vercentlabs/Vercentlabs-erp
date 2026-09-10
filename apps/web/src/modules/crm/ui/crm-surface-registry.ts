import type { AppIconName } from "@/shared/components/app-icon";
import { PERMISSIONS } from "@/core/permissions";
import { CRM_FEATURES, type CrmFeatureId } from "../crm-data-operations-and-customization/capability-registry";

export type CrmSurfacePlacement = "workspace" | "record" | "setup" | "data" | "insights";
export type CrmSurfaceGroup = "Customers" | "Pipeline" | "Work" | "Engagement" | "Insights" | "Setup" | "Data";

export type CrmFeatureSurface = {
  id: CrmFeatureId;
  label: string;
  group: CrmSurfaceGroup;
  href: string;
  placement: CrmSurfacePlacement;
  icon: AppIconName;
  description: string;
  discoverability: string;
  permission: string;
};

/**
 * Canonical UI traceability map for the entire F001-F030 CRM product contract.
 * A feature may live inside a record/list workspace, but every feature must
 * have a deliberate discoverable entry point. UI tests enforce 30/30 coverage.
 */
export const CRM_FEATURE_SURFACES: readonly CrmFeatureSurface[] = Object.freeze([
  { id: "F001", label: "Leads", group: "Customers", href: "/crm/leads", placement: "workspace", icon: "crm", description: "Capture, triage, qualify and progress prospective customers.", discoverability: "Customers → Leads", permission: PERMISSIONS.crmView },
  { id: "F002", label: "Accounts", group: "Customers", href: "/crm/accounts", placement: "workspace", icon: "companies", description: "Manage companies, account context and relationship hierarchy.", discoverability: "Customers → Accounts", permission: PERMISSIONS.crmView },
  { id: "F003", label: "Contacts", group: "Customers", href: "/crm/contacts", placement: "workspace", icon: "users", description: "Manage people, contactability and account relationships.", discoverability: "Customers → Contacts", permission: PERMISSIONS.crmView },
  { id: "F004", label: "Lead sources", group: "Setup", href: "/crm/sources", placement: "setup", icon: "import", description: "Govern the source catalogue used for attribution and routing.", discoverability: "Setup → Lead management → Lead sources", permission: PERMISSIONS.crmSettingsManage },
  { id: "F005", label: "Lead assignment", group: "Setup", href: "/crm/assignment-rules", placement: "setup", icon: "teams", description: "Route leads to owners and teams with ordered assignment rules.", discoverability: "Setup → Lead management → Assignment rules", permission: PERMISSIONS.crmSettingsManage },
  { id: "F006", label: "Lead qualification", group: "Customers", href: "/crm/leads", placement: "record", icon: "check", description: "Evaluate readiness with governed qualification criteria on Lead 360.", discoverability: "Lead 360 → Qualification", permission: PERMISSIONS.crmView },
  { id: "F007", label: "Lead lifecycle", group: "Setup", href: "/crm/lead-lifecycle", placement: "setup", icon: "audit", description: "Configure lead stages, allowed transitions and lifecycle governance.", discoverability: "Setup → Lead management → Lead lifecycle", permission: PERMISSIONS.crmSettingsManage },
  { id: "F008", label: "Duplicate detection", group: "Data", href: "/crm/duplicate-rules", placement: "data", icon: "audit", description: "Detect and safely review possible duplicate CRM records.", discoverability: "Data management → Duplicate rules; record duplicate warnings", permission: PERMISSIONS.crmDataQualityManage },
  { id: "F009", label: "Opportunities", group: "Pipeline", href: "/crm/opportunities", placement: "workspace", icon: "sales", description: "Manage qualified revenue opportunities and their commercial context.", discoverability: "Pipeline → Opportunities", permission: PERMISSIONS.crmView },
  { id: "F010", label: "Opportunity pipeline", group: "Pipeline", href: "/crm/pipeline", placement: "workspace", icon: "sales", description: "Work opportunities by stage using an accessible pipeline board.", discoverability: "Pipeline → Pipeline board", permission: PERMISSIONS.crmView },
  { id: "F011", label: "Probability & expected revenue", group: "Pipeline", href: "/crm/opportunities", placement: "record", icon: "audit", description: "Manage probability and weighted value in Opportunity 360.", discoverability: "Opportunity 360 → Overview", permission: PERMISSIONS.crmView },
  { id: "F012", label: "Sales stages", group: "Setup", href: "/crm/stages", placement: "setup", icon: "modules", description: "Configure stage order, probabilities and terminal outcomes.", discoverability: "Setup → Pipeline → Sales stages", permission: PERMISSIONS.crmSettingsManage },
  { id: "F013", label: "Calls", group: "Work", href: "/crm/calls", placement: "workspace", icon: "phone", description: "Log and work customer calls, outcomes and next actions.", discoverability: "Work → Calls", permission: PERMISSIONS.crmView },
  { id: "F014", label: "Meetings", group: "Work", href: "/crm/meetings", placement: "workspace", icon: "approvals", description: "Schedule and complete customer meetings with follow-up context.", discoverability: "Work → Meetings / Calendar", permission: PERMISSIONS.crmView },
  { id: "F015", label: "Tasks", group: "Work", href: "/crm/tasks", placement: "workspace", icon: "check", description: "Manage personal work, team queues, recurrence and dependencies.", discoverability: "Work → Tasks", permission: PERMISSIONS.crmView },
  { id: "F016", label: "Follow-ups & reminders", group: "Work", href: "/crm/follow-ups", placement: "workspace", icon: "approvals", description: "Prioritize overdue, current and upcoming follow-up commitments.", discoverability: "Work → Follow-ups", permission: PERMISSIONS.crmView },
  { id: "F017", label: "Notes & attachments", group: "Customers", href: "/crm/leads", placement: "record", icon: "audit", description: "Keep record-scoped notes and files in the Record 360 activity context.", discoverability: "Lead / Account / Contact / Opportunity 360 → Activity / Related", permission: PERMISSIONS.crmView },
  { id: "F018", label: "Email history", group: "Engagement", href: "/crm/inbox", placement: "record", icon: "email", description: "Review customer communication history and team-inbox threads.", discoverability: "Engagement → Team inbox; Record 360 → Activity", permission: PERMISSIONS.crmCommunicationsManage },
  { id: "F019", label: "Activity timeline", group: "Work", href: "/crm/activities", placement: "workspace", icon: "approvals", description: "See a chronological customer activity history across channels.", discoverability: "Work → Activity timeline; Record 360 → Activity", permission: PERMISSIONS.crmView },
  { id: "F020", label: "Territories & sales teams", group: "Setup", href: "/crm/settings#organization", placement: "setup", icon: "teams", description: "Configure ownership structures, territories, members and quotas.", discoverability: "Setup → Organization", permission: PERMISSIONS.crmRevenueManage },
  { id: "F021", label: "Lead import & export", group: "Data", href: "/crm/data-management", placement: "data", icon: "import", description: "Move lead data safely with validation, duplicate controls and export scope.", discoverability: "Data management → Lead import / export", permission: PERMISSIONS.crmView },
  { id: "F022", label: "Lead conversion", group: "Customers", href: "/crm/leads", placement: "record", icon: "arrow-right", description: "Convert a qualified lead into account, contact and opportunity context.", discoverability: "Lead 360 → Convert", permission: PERMISSIONS.crmLeadsManage },
  { id: "F023", label: "Opportunity to quotation", group: "Pipeline", href: "/crm/opportunities", placement: "record", icon: "arrow-right", description: "Hand a qualified opportunity into Sales quotation workflow.", discoverability: "Opportunity 360 → Create quotation", permission: PERMISSIONS.crmOpportunitiesManage },
  { id: "F024", label: "Pipeline dashboard", group: "Insights", href: "/crm", placement: "insights", icon: "dashboard", description: "Monitor pipeline value, attention signals and conversion pressure.", discoverability: "CRM Home; Pipeline board summaries", permission: PERMISSIONS.crmView },
  { id: "F025", label: "Sales forecast", group: "Insights", href: "/crm/forecast", placement: "insights", icon: "audit", description: "Review expected revenue, forecast categories and period outlook.", discoverability: "Pipeline → Forecast", permission: PERMISSIONS.crmReportsView },
  { id: "F026", label: "Won / lost reasons", group: "Setup", href: "/crm/lost-reasons", placement: "setup", icon: "check", description: "Govern outcome reasons captured when opportunities close.", discoverability: "Setup → Pipeline → Won / lost reasons", permission: PERMISSIONS.crmSettingsManage },
  { id: "F027", label: "Lead scoring", group: "Setup", href: "/crm/lead-scoring", placement: "setup", icon: "sparkles", description: "Configure transparent lead scoring models and prioritization.", discoverability: "Setup → Lead management → Lead scoring", permission: PERMISSIONS.crmSettingsManage },
  { id: "F028", label: "Custom fields & tags", group: "Data", href: "/crm/data-management", placement: "data", icon: "settings", description: "Extend CRM records with governed tags, custom objects and typed fields.", discoverability: "Data management → Customization", permission: PERMISSIONS.crmCustomizationManage },
  { id: "F029", label: "Bulk actions", group: "Customers", href: "/crm/leads", placement: "record", icon: "approvals", description: "Apply safe multi-record actions from CRM entity lists.", discoverability: "Entity lists → Select records → Bulk actions", permission: PERMISSIONS.crmLeadsManage },
  { id: "F030", label: "CRM reports", group: "Insights", href: "/crm/reports", placement: "insights", icon: "audit", description: "Analyze pipeline, conversion, activity and revenue operations.", discoverability: "Insights → Reports", permission: PERMISSIONS.crmReportsView },
] satisfies readonly CrmFeatureSurface[]);

const expectedIds = new Set(CRM_FEATURES.map(([id]) => id));
for (const surface of CRM_FEATURE_SURFACES) expectedIds.delete(surface.id);
if (expectedIds.size) {
  throw new Error(`CRM feature surface registry is incomplete: ${[...expectedIds].join(", ")}`);
}
