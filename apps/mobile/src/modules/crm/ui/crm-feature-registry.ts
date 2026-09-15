import type { Href } from "expo-router";

export type CrmMobileSupport =
  | "native"
  | "native-read"
  | "native-action"
  | "web-workspace";

export type CrmMobileFeature = {
  id: `F${string}`;
  label: string;
  group: "Customers" | "Pipeline" | "Work" | "Engagement" | "Insights" | "Data" | "Setup";
  support: CrmMobileSupport;
  description: string;
  nativeHref?: Href;
  webPath: `/crm${string}`;
};

/**
 * Mobile disposition for the same canonical F001-F030 contract used by web.
 * A capability may deliberately open its governed web workspace, but it may
 * not disappear from mobile discovery simply because a native editor has not
 * been built yet.
 */
export const CRM_MOBILE_FEATURES: readonly CrmMobileFeature[] = [
  { id: "F001", label: "Leads", group: "Customers", support: "native", description: "Find, create and work leads.", nativeHref: "/(protected)/(tabs)/leads", webPath: "/crm/leads" },
  { id: "F002", label: "Accounts", group: "Customers", support: "web-workspace", description: "Company and relationship records.", webPath: "/crm/accounts" },
  { id: "F003", label: "Contacts", group: "Customers", support: "web-workspace", description: "People and account relationships.", webPath: "/crm/contacts" },
  { id: "F004", label: "Lead sources", group: "Setup", support: "web-workspace", description: "Govern acquisition sources.", webPath: "/crm/sources" },
  { id: "F005", label: "Lead assignment", group: "Setup", support: "web-workspace", description: "Ownership and routing rules.", webPath: "/crm/settings/assignment" },
  { id: "F006", label: "Lead qualification", group: "Customers", support: "web-workspace", description: "Commercial-readiness decisions.", webPath: "/crm/qualification-criteria" },
  { id: "F007", label: "Lead lifecycle", group: "Setup", support: "web-workspace", description: "Lifecycle stages and transitions.", webPath: "/crm/lead-lifecycle" },
  { id: "F008", label: "Duplicate management", group: "Data", support: "web-workspace", description: "Detect, review and merge duplicate records.", webPath: "/crm/data/duplicates" },
  { id: "F009", label: "Opportunities", group: "Pipeline", support: "native", description: "Qualified revenue opportunities.", nativeHref: "/(protected)/(tabs)/pipeline", webPath: "/crm/opportunities" },
  { id: "F010", label: "Pipeline", group: "Pipeline", support: "native", description: "Stage-based revenue execution.", nativeHref: "/(protected)/(tabs)/pipeline", webPath: "/crm/pipeline" },
  { id: "F011", label: "Probability & expected revenue", group: "Pipeline", support: "native-read", description: "Probability-weighted opportunity value.", nativeHref: "/(protected)/(tabs)/pipeline", webPath: "/crm/pipeline" },
  { id: "F012", label: "Sales stages", group: "Setup", support: "web-workspace", description: "Govern pipeline stages and defaults.", webPath: "/crm/stages" },
  { id: "F013", label: "Calls", group: "Work", support: "native-action", description: "Log and review customer calls.", nativeHref: "/(protected)/(tabs)/activities", webPath: "/crm/calls" },
  { id: "F014", label: "Meetings", group: "Work", support: "native-action", description: "Schedule and review meetings.", nativeHref: "/(protected)/(tabs)/activities", webPath: "/crm/meetings" },
  { id: "F015", label: "Tasks", group: "Work", support: "native-action", description: "Daily CRM work queue.", nativeHref: "/(protected)/(tabs)/activities", webPath: "/crm/tasks" },
  { id: "F016", label: "Follow-ups & reminders", group: "Work", support: "native-action", description: "Keep next actions visible.", nativeHref: "/(protected)/(tabs)/activities", webPath: "/crm/follow-ups" },
  { id: "F017", label: "Notes & attachments", group: "Engagement", support: "native-read", description: "Record context and supporting files.", nativeHref: "/(protected)/(tabs)/activities", webPath: "/crm/activities" },
  { id: "F018", label: "Email history", group: "Engagement", support: "web-workspace", description: "Customer email history and conversations.", webPath: "/crm/inbox" },
  { id: "F019", label: "Activity timeline", group: "Work", support: "native", description: "Chronological CRM engagement history.", nativeHref: "/(protected)/(tabs)/activities", webPath: "/crm/activities" },
  { id: "F020", label: "Territories & sales teams", group: "Setup", support: "web-workspace", description: "Revenue ownership structure and coverage.", webPath: "/crm/settings/territories" },
  { id: "F021", label: "Lead import & export", group: "Data", support: "web-workspace", description: "Governed CRM data movement.", webPath: "/crm/data/import-export" },
  { id: "F022", label: "Lead conversion", group: "Customers", support: "web-workspace", description: "Convert qualified leads into downstream records.", webPath: "/crm/leads" },
  { id: "F023", label: "Opportunity to quotation", group: "Pipeline", support: "web-workspace", description: "Create sales quotations from opportunities.", webPath: "/crm/opportunities" },
  { id: "F024", label: "Pipeline dashboard", group: "Insights", support: "native-read", description: "Pipeline health and revenue signals.", nativeHref: "/(protected)/(tabs)/pipeline", webPath: "/crm/dashboard" },
  { id: "F025", label: "Sales forecast", group: "Insights", support: "web-workspace", description: "Forecast revenue by time and ownership.", webPath: "/crm/forecast" },
  { id: "F026", label: "Won / lost reasons", group: "Setup", support: "web-workspace", description: "Govern deal-outcome reasons.", webPath: "/crm/lost-reasons" },
  { id: "F027", label: "Lead scoring", group: "Setup", support: "web-workspace", description: "Prioritize leads with governed scoring rules.", webPath: "/crm/lead-scoring" },
  { id: "F028", label: "Custom fields & tags", group: "Data", support: "web-workspace", description: "Adapt CRM records without fragmenting layouts.", webPath: "/crm/settings/custom-fields-and-tags" },
  { id: "F029", label: "Bulk actions", group: "Data", support: "web-workspace", description: "Perform governed multi-record operations.", webPath: "/crm/leads" },
  { id: "F030", label: "CRM reports", group: "Insights", support: "web-workspace", description: "Analyze pipeline, activity and outcomes.", webPath: "/crm/reports" },
] as const;
