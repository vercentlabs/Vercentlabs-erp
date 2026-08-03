export type WebParityEntry = {
  web: string;
  mobile: string;
  delivery: "native" | "secure-browser-handoff";
};

export const protectedWebParity: readonly WebParityEntry[] = [
  { web: "/dashboard", mobile: "/(protected)/(tabs)", delivery: "native" },
  {
    web: "/accounting",
    mobile: "/accounting",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/assets",
    mobile: "/accounting/assets",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/assets/[id]",
    mobile: "/accounting/assets/[id]",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/assets/new",
    mobile: "/accounting/assets/new",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/banking",
    mobile: "/accounting/banking",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/close",
    mobile: "/accounting/close",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/close/[id]",
    mobile: "/accounting/close/[id]",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/journals",
    mobile: "/accounting/journals",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/journals/[id]",
    mobile: "/accounting/journals/[id]",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/journals/new",
    mobile: "/accounting/journals/new",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/operations",
    mobile: "/accounting/operations",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/payables",
    mobile: "/accounting/payables",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/payables/[id]",
    mobile: "/accounting/payables/[id]",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/payables/new",
    mobile: "/accounting/payables/new",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/planning",
    mobile: "/accounting/planning",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/receivables",
    mobile: "/accounting/receivables",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/receivables/[id]",
    mobile: "/accounting/receivables/[id]",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/receivables/new",
    mobile: "/accounting/receivables/new",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/reports",
    mobile: "/accounting/reports",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/settings",
    mobile: "/accounting/settings",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/accounting/tax",
    mobile: "/accounting/tax",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/procurement",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/governance",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/requisitions",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/requisitions/[id]",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/requisitions/new",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/sourcing",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/sourcing/[id]",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/sourcing/new",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/suppliers",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/suppliers/[id]",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/suppliers/new",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/contracts",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/contracts/[id]",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/contracts/new",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/orders",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/orders/[id]",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/orders/new",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/receipts",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/receipts/[id]",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/receipts/new",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/matching",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/reports",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/procurement/settings",
    mobile: "/(protected)/workspace/procurement",
    delivery: "native",
  },
  {
    web: "/crm/readiness",
    mobile: "/crm/readiness",
    delivery: "secure-browser-handoff",
  },
  { web: "/sales", mobile: "/sales", delivery: "secure-browser-handoff" },
  {
    web: "/sales/orders",
    mobile: "/sales/orders",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/sales/orders/[id]",
    mobile: "/sales/orders/[id]",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/sales/orders/new",
    mobile: "/sales/orders/new",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/sales/quotations",
    mobile: "/sales/quotations",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/sales/quotations/[id]",
    mobile: "/sales/quotations/[id]",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/sales/quotations/new",
    mobile: "/sales/quotations/new",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/sales/reports",
    mobile: "/sales/reports",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/sales/settings",
    mobile: "/sales/settings",
    delivery: "secure-browser-handoff",
  },
  { web: "/crm", mobile: "/(protected)/workspace/crm", delivery: "native" },
  {
    web: "/crm/customer-success",
    mobile: "/(protected)/workspace/crm-customer-success",
    delivery: "native",
  },
  {
    web: "/crm/communications",
    mobile: "/(protected)/workspace/crm-communications",
    delivery: "native",
  },
  {
    web: "/crm/conversation-intelligence",
    mobile: "/(protected)/workspace/crm-conversation-intelligence",
    delivery: "native",
  },
  {
    web: "/crm/lead-acquisition",
    mobile: "/(protected)/workspace/crm-lead-acquisition",
    delivery: "native",
  },
  {
    web: "/crm/marketing",
    mobile: "/(protected)/workspace/crm-marketing",
    delivery: "native",
  },
  {
    web: "/crm/[resource]",
    mobile: "/(protected)/workspace/crm/[resource]",
    delivery: "native",
  },
  {
    web: "/crm/accounts/[id]",
    mobile: "/(protected)/crm/accounts/[id]",
    delivery: "native",
  },
  {
    web: "/crm/contacts/[id]",
    mobile: "/(protected)/crm/contacts/[id]",
    delivery: "native",
  },
  {
    web: "/crm/readiness/account-intelligence",
    mobile: "/crm/readiness/account-intelligence",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/crm/privacy-requests/[id]",
    mobile: "/crm/privacy-requests/[id]",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/crm/privacy-retention",
    mobile: "/crm/privacy-retention",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/crm/leads/[id]",
    mobile: "/(protected)/crm/leads/[id]",
    delivery: "native",
  },
  {
    web: "/crm/opportunities/[id]",
    mobile: "/(protected)/crm/opportunities/[id]",
    delivery: "native",
  },
  {
    web: "/crm/pipeline",
    mobile: "/(protected)/(tabs)/pipeline",
    delivery: "native",
  },
  {
    web: "/crm/reports",
    mobile: "/(protected)/workspace/crm-reports",
    delivery: "native",
  },
  {
    web: "/crm/settings",
    mobile: "/(protected)/workspace/crm-settings",
    delivery: "native",
  },
  {
    web: "/master-data",
    mobile: "/(protected)/workspace/master-data",
    delivery: "native",
  },
  {
    web: "/master-data/[resource]",
    mobile: "/(protected)/workspace/master-data/[resource]",
    delivery: "native",
  },
  {
    web: "/modules",
    mobile: "/(protected)/workspace/modules",
    delivery: "native",
  },
  {
    web: "/notifications",
    mobile: "/(protected)/notifications",
    delivery: "native",
  },
  {
    web: "/billing",
    mobile: "/(protected)/workspace/billing",
    delivery: "native",
  },
  {
    web: "/audit-logs",
    mobile: "/(protected)/workspace/audit-logs",
    delivery: "native",
  },
  {
    web: "/approvals",
    mobile: "/(protected)/workspace/approvals",
    delivery: "native",
  },
  {
    web: "/profile",
    mobile: "/(protected)/workspace/profile",
    delivery: "native",
  },
  { web: "/search", mobile: "/(protected)/search", delivery: "native" },
  {
    web: "/security",
    mobile: "/(protected)/workspace/security",
    delivery: "native",
  },
  {
    web: "/settings",
    mobile: "/(protected)/workspace/settings",
    delivery: "native",
  },
  {
    web: "/settings/release-readiness",
    mobile: "/(protected)/workspace/audit-logs",
    delivery: "native",
  },
  {
    web: "/settings/[resource]",
    mobile: "/(protected)/workspace/settings/[resource]",
    delivery: "native",
  },
  {
    web: "/settings/company",
    mobile: "/(protected)/workspace/settings/companies",
    delivery: "native",
  },
  {
    web: "/settings/users",
    mobile: "/(protected)/workspace/users",
    delivery: "native",
  },
  {
    web: "/settings/roles",
    mobile: "/(protected)/workspace/roles",
    delivery: "native",
  },
];

export const authenticationWebParity: readonly WebParityEntry[] = [
  { web: "/login", mobile: "/(auth)/login", delivery: "native" },
  { web: "/signup", mobile: "/signup", delivery: "secure-browser-handoff" },
  {
    web: "/forgot-password",
    mobile: "/forgot-password",
    delivery: "secure-browser-handoff",
  },
  {
    web: "/reset-password",
    mobile: "/reset-password",
    delivery: "secure-browser-handoff",
  },
  { web: "/invite", mobile: "/invite", delivery: "secure-browser-handoff" },
  {
    web: "/verify-email",
    mobile: "/verify-email",
    delivery: "secure-browser-handoff",
  },
];
