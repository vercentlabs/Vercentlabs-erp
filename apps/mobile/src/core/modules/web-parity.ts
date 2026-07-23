export type WebParityEntry = {
  web: string;
  mobile: string;
  delivery: "native" | "secure-browser-handoff";
};

export const protectedWebParity: readonly WebParityEntry[] = [
  { web: "/dashboard", mobile: "/(protected)/(tabs)", delivery: "native" },
  { web: "/crm", mobile: "/(protected)/workspace/crm", delivery: "native" },
  { web: "/crm/[resource]", mobile: "/(protected)/workspace/crm/[resource]", delivery: "native" },
  { web: "/crm/leads/[id]", mobile: "/(protected)/crm/leads/[id]", delivery: "native" },
  { web: "/crm/opportunities/[id]", mobile: "/(protected)/crm/opportunities/[id]", delivery: "native" },
  { web: "/crm/pipeline", mobile: "/(protected)/(tabs)/pipeline", delivery: "native" },
  { web: "/crm/reports", mobile: "/(protected)/workspace/crm-reports", delivery: "native" },
  { web: "/crm/settings", mobile: "/(protected)/workspace/crm-settings", delivery: "native" },
  { web: "/master-data", mobile: "/(protected)/workspace/master-data", delivery: "native" },
  { web: "/master-data/[resource]", mobile: "/(protected)/workspace/master-data/[resource]", delivery: "native" },
  { web: "/modules", mobile: "/(protected)/workspace/modules", delivery: "native" },
  { web: "/notifications", mobile: "/(protected)/notifications", delivery: "native" },
  { web: "/billing", mobile: "/(protected)/workspace/billing", delivery: "native" },
  { web: "/audit-logs", mobile: "/(protected)/workspace/audit-logs", delivery: "native" },
  { web: "/approvals", mobile: "/(protected)/workspace/approvals", delivery: "native" },
  { web: "/profile", mobile: "/(protected)/workspace/profile", delivery: "native" },
  { web: "/search", mobile: "/(protected)/search", delivery: "native" },
  { web: "/security", mobile: "/(protected)/workspace/security", delivery: "native" },
  { web: "/settings", mobile: "/(protected)/workspace/settings", delivery: "native" },
  { web: "/settings/[resource]", mobile: "/(protected)/workspace/settings/[resource]", delivery: "native" },
  { web: "/settings/company", mobile: "/(protected)/workspace/settings/companies", delivery: "native" },
  { web: "/settings/users", mobile: "/(protected)/workspace/users", delivery: "native" },
  { web: "/settings/roles", mobile: "/(protected)/workspace/roles", delivery: "native" },
];

export const authenticationWebParity: readonly WebParityEntry[] = [
  { web: "/login", mobile: "/(auth)/login", delivery: "native" },
  { web: "/signup", mobile: "/signup", delivery: "secure-browser-handoff" },
  { web: "/forgot-password", mobile: "/forgot-password", delivery: "secure-browser-handoff" },
  { web: "/reset-password", mobile: "/reset-password", delivery: "secure-browser-handoff" },
  { web: "/invite", mobile: "/invite", delivery: "secure-browser-handoff" },
  { web: "/verify-email", mobile: "/verify-email", delivery: "secure-browser-handoff" },
];
