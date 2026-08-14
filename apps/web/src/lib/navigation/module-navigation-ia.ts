import type {
  ModuleId,
  ModuleNavigationGroup,
  NavigationItem,
} from "@/lib/navigation/types";

export type GroupedNavigationItems = {
  label: string;
  items: NavigationItem[];
};

/**
 * Presentation-only information architecture.
 *
 * This NEVER grants access and NEVER invents destinations. It only groups the
 * already server-resolved NavigationItem objects that resolveNavigation()
 * permitted. If a route is not present in the canonical navigation registry,
 * it cannot appear here.
 */
const GROUP_BY_HREF: Partial<Record<ModuleId, Record<string, string>>> = {
  crm: {
    "/crm": "Overview",
    "/crm/leads": "Customers",
    "/crm/accounts": "Customers",
    "/crm/contacts": "Customers",
    "/crm/opportunities": "Sales",
    "/crm/activities": "Sales",
    "/crm/pipeline": "Sales",
    "/crm/communications": "Engagement",
    "/crm/marketing": "Engagement",
    "/crm/customer-success": "Engagement",
    "/crm/partner-engagement": "Engagement",
    "/crm/reports": "Insights",
    "/crm/ai-intelligence": "Insights",
    "/crm/settings": "Administration",
  },
  sales: {
    "/sales": "Overview",
    "/sales/quotations": "Selling",
    "/sales/orders": "Selling",
    "/sales/reports": "Insights",
    "/sales/settings": "Administration",
  },
  accounting: {
    "/accounting": "Overview",
    "/accounting/journals": "General ledger",
    "/accounting/receivables": "Receivables",
    "/accounting/payables": "Payables",
    "/accounting/banking": "Treasury",
    "/accounting/assets": "Fixed assets",
    "/accounting/planning": "Planning",
    "/accounting/tax": "Tax",
    "/accounting/operations": "Operations",
    "/accounting/close": "Period close",
    "/accounting/reports": "Insights",
    "/accounting/settings": "Administration",
  },
  procurement: {
    "/procurement": "Overview",
    "/procurement/requisitions": "Demand",
    "/procurement/sourcing": "Sourcing",
    "/procurement/suppliers": "Suppliers",
    "/procurement/contracts": "Suppliers",
    "/procurement/orders": "Purchasing",
    "/procurement/receipts": "Receiving",
    "/procurement/matching": "Invoice control",
    "/procurement/reports": "Insights",
    "/procurement/settings": "Administration",
  },
  stock: {
    "/stock": "Overview",
    "/stock/balances": "Inventory",
    "/stock/movements": "Inventory",
    "/stock/transfers": "Warehouse operations",
    "/stock/batches": "Traceability",
    "/stock/serials": "Traceability",
    "/stock/reservations": "Availability",
    "/stock/reorder-rules": "Planning",
  },
  manufacturing: {
    "/manufacturing": "Overview",
    "/manufacturing/boms": "Product engineering",
    "/manufacturing/routings": "Product engineering",
    "/manufacturing/work-orders": "Production",
    "/manufacturing/production-postings": "Production",
    "/manufacturing/work-centers": "Resources",
    "/manufacturing/material-requirements": "Planning",
  },
  projects: {
    "/projects": "Overview",
    "/projects/projects": "Delivery",
    "/projects/milestones": "Delivery",
    "/projects/tasks": "Delivery",
    "/projects/time-entries": "Time & cost",
    "/projects/expenses": "Time & cost",
    "/projects/budgets": "Time & cost",
    "/projects/profitability": "Insights",
  },
  assets: {
    "/assets": "Overview",
    "/assets/assets": "Asset lifecycle",
    "/assets/assignments": "Asset lifecycle",
    "/assets/transfers": "Asset lifecycle",
    "/assets/maintenance-orders": "Maintenance",
    "/assets/inspections": "Maintenance",
    "/assets/depreciation-runs": "Financial",
    "/assets/disposals": "Financial",
  },
  "point-of-sale": {
    "/point-of-sale": "Overview",
    "/point-of-sale/checkout": "Sell",
    "/point-of-sale/sales": "Sell",
    "/point-of-sale/returns": "Sell",
    "/point-of-sale/shifts": "Store operations",
    "/point-of-sale/cash-movements": "Store operations",
    "/point-of-sale/reconciliations": "Store operations",
    "/point-of-sale/terminals": "Configuration",
  },
  quality: {
    "/quality": "Overview",
    "/quality/plans": "Setup",
    "/quality/inspections": "Quality control",
    "/quality/holds": "Quality control",
    "/quality/non-conformances": "Quality control",
    "/quality/capa": "Quality control",
    "/quality/supplier-quality": "Supplier quality",
    "/quality/audits": "Governance",
  },
  support: {
    "/support": "Overview",
    "/support/tickets": "Service",
    "/support/queues": "Service",
    "/support/sla-policies": "Service levels",
    "/support/escalations": "Service levels",
    "/support/communications": "Engagement",
    "/support/customer-history": "Engagement",
    "/support/knowledge": "Knowledge",
  },
  "hr-payroll": {
    "/hr-payroll": "Overview",
    "/hr-payroll/employees": "People",
    "/hr-payroll/attendance": "Time",
    "/hr-payroll/leave-requests": "Time",
    "/hr-payroll/expenses": "Expenses",
    "/hr-payroll/salary-structures": "Compensation",
    "/hr-payroll/payroll-runs": "Payroll",
    "/hr-payroll/payslips": "Payroll",
  },
};

export function groupModuleNavigation(
  module: ModuleNavigationGroup,
): GroupedNavigationItems[] {
  const buckets = new Map<string, NavigationItem[]>();

  for (const item of module.items) {
    const label =
      GROUP_BY_HREF[module.moduleId]?.[item.href] ??
      item.group ??
      (item.exact ? "Overview" : "Workspace");

    const current = buckets.get(label) ?? [];
    current.push(item);
    buckets.set(label, current);
  }

  return Array.from(buckets, ([label, items]) => ({ label, items }));
}

export function navigationItemSearchText(
  item: NavigationItem,
  groupLabel = "",
): string {
  return [
    item.label,
    item.href,
    groupLabel,
    ...(item.keywords ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function filterGroupedNavigation(
  groups: GroupedNavigationItems[],
  query: string,
): GroupedNavigationItems[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return groups;

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        navigationItemSearchText(item, group.label).includes(normalized),
      ),
    }))
    .filter((group) => group.items.length > 0);
}
