// Quick Create action registry (Part 10/34). Deliberately separate from
// apps/web/src/lib/navigation/ — navigation answers "go somewhere," this
// answers "begin a workflow" (Part 35). Every href below was verified
// against a real, already-shipped route before being added — no action
// exists here without a working destination:
//   - CRM: /crm/[resource]?create=1 is the existing convention (confirmed
//     in apps/web/src/app/(app)/crm/page.tsx and crm/[resource]/page.tsx's
//     `startCreating={query.create === "1"}`), already used by
//     module-context-bar.tsx's own quick-action links.
//   - Procurement/Sales/Accounting: dedicated .../new page routes
//     (apps/web/src/app/(app)/{procurement,sales,accounting}/**/new),
//     already used the same way by module-context-bar.tsx's quickActions.
// Deliberately NOT included (no real deep-linkable create entry point
// found — see docs/implementation/ERP_COMMAND_SURFACE_007.md's Route Gap
// section): Customer/Contact (business-data's create UI isn't
// URL-triggerable today), Item, Employee, Ticket, Project, Asset.
import { PERMISSIONS } from "@/lib/permissions-catalog";
import type { ModuleId } from "@/lib/navigation/types";
import type { AppIconName } from "@/components/app-icon";

export type QuickCreateAction = {
  id: string;
  label: string;
  href: string;
  moduleId: ModuleId;
  /** Base permission gating this action — absent means any authenticated workspace member. */
  permission?: string;
  icon: AppIconName;
  keywords?: string[];
};

export const quickCreateActions: readonly QuickCreateAction[] = Object.freeze([
  {
    id: "crm.lead",
    label: "Create lead",
    href: "/crm/leads?create=1",
    moduleId: "crm",
    permission: PERMISSIONS.crmLeadsManage,
    icon: "crm",
    keywords: ["prospect", "enquiry"],
  },
  {
    id: "crm.opportunity",
    label: "Create opportunity",
    href: "/crm/opportunities?create=1",
    moduleId: "crm",
    permission: PERMISSIONS.crmOpportunitiesManage,
    icon: "sales",
    keywords: ["deal"],
  },
  {
    id: "crm.activity",
    label: "Create activity",
    href: "/crm/activities?create=1",
    moduleId: "crm",
    permission: PERMISSIONS.crmActivitiesManage,
    icon: "approvals",
    keywords: ["task", "call", "meeting", "follow-up"],
  },
  {
    id: "sales.quotation",
    label: "Create quotation",
    href: "/sales/quotations/new",
    moduleId: "sales",
    permission: PERMISSIONS.salesQuotationCreate,
    icon: "sales",
    keywords: ["quote"],
  },
  {
    id: "sales.order",
    label: "Create sales order",
    href: "/sales/orders/new",
    moduleId: "sales",
    permission: PERMISSIONS.salesOrderCreate,
    icon: "sales",
  },
  {
    id: "procurement.requisition",
    label: "Create purchase requisition",
    href: "/procurement/requisitions/new",
    moduleId: "procurement",
    permission: PERMISSIONS.procurementRequisitionCreate,
    icon: "procurement",
    keywords: ["request"],
  },
  {
    id: "procurement.order",
    label: "Create purchase order",
    href: "/procurement/orders/new",
    moduleId: "procurement",
    permission: PERMISSIONS.procurementPoCreate,
    icon: "procurement",
    keywords: ["po"],
  },
  {
    id: "procurement.supplier",
    label: "Create supplier",
    href: "/procurement/suppliers/new",
    moduleId: "procurement",
    permission: PERMISSIONS.procurementSuppliersManage,
    icon: "companies",
    keywords: ["vendor"],
  },
  {
    id: "accounting.journal",
    label: "Create journal entry",
    href: "/accounting/journals/new",
    moduleId: "accounting",
    permission: PERMISSIONS.accountingJournalCreate,
    icon: "accounting",
    keywords: ["gl", "posting"],
  },
]);
