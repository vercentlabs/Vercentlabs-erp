// The canonical, single-authority module secondary-navigation registry
// (Prompt 2B Phase 2). Desktop secondary sidebar, the mobile drawer's
// per-module section, and (in a later prompt) the command menu must all
// read from this file — none may define a parallel nav list.
//
// STATUS HONESTY: an item is AVAILABLE only once the prompt that built its
// screen flips it here — do not flip one speculatively. For every module
// other than CRM, every item is still PLANNED except each module's own
// "Overview"/root item (a ModuleFoundationPage — see
// apps/web/src/app/(workspace)/<module>/page.tsx). CRM's clean rebuild
// (Prompt 3) has flipped its built screens (Leads/Accounts/Contacts/
// Opportunities/Pipeline/Tasks/Calls/Meetings/Follow-ups/Communications/
// Dashboard/Territories & Sales Teams) to AVAILABLE as each was verified
// working end-to-end; CRM items still PLANNED (Forecast UI, Reports UI,
// Imports & Exports, Duplicate Management, and the remaining Setup screens)
// genuinely have no screen yet. PLANNED items render in the secondary
// sidebar disabled, for orientation, never as a clickable link — see
// SecondarySidebar.tsx.
//
// VALIDATION NOTE: sections are grouped around the user's work model (per
// Phase 2's instruction), not a literal F-id-per-item mapping, and are
// annotated with the coarse F-id range they correspond to in
// docs/02-register/FEATURE_REGISTER.csv for traceability. A full per-item
// cross-check against that register (and each module's dossier) is the
// responsibility of the prompt that implements the section, at which point
// its items graduate from PLANNED to AVAILABLE — inventing precise F-id-
// to-nav-item mappings for screens that don't exist yet would be a claim
// this pass cannot actually verify.
import {
  Users,
  ShoppingCart,
  Truck,
  Boxes,
  Factory,
  FolderKanban,
  Wrench,
  Store,
  BadgeCheck,
  LifeBuoy,
  Landmark,
  Building2,
} from "lucide-react";

import type { ModuleNavigation, SecondaryNavItem } from "./navigation-types";

function planned(label: string, route: string): SecondaryNavItem {
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return { id, label, route, status: "PLANNED" };
}

function available(label: string, route: string): SecondaryNavItem {
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return { id, label, route, status: "AVAILABLE" };
}

function adminOnly(
  label: string,
  route: string,
  requiredPermission: string,
): SecondaryNavItem {
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return { id, label, route, status: "PLANNED", requiredPermission };
}

export const MODULE_NAVIGATION: readonly ModuleNavigation[] = [
  {
    moduleKey: "crm",
    label: "CRM",
    icon: Users,
    requiredPermission: "crm.view",
    sections: [
      { id: "overview", label: "Overview", items: [available("Home", "/crm")] },
      {
        id: "customers",
        label: "Customers",
        featureRange: "F001-F008",
        items: [
          available("Leads", "/crm/leads"),
          available("Accounts", "/crm/accounts"),
          available("Contacts", "/crm/contacts"),
        ],
      },
      {
        id: "pipeline",
        label: "Pipeline",
        featureRange: "F009-F015",
        items: [
          available("Opportunities", "/crm/opportunities"),
          available("Pipeline", "/crm/pipeline"),
          planned("Forecast", "/crm/forecast"),
        ],
      },
      {
        id: "work",
        label: "Work",
        featureRange: "F016-F020",
        items: [
          available("Tasks", "/crm/tasks"),
          available("Calls", "/crm/calls"),
          available("Meetings", "/crm/meetings"),
          available("Follow-ups", "/crm/follow-ups"),
        ],
      },
      {
        id: "engagement",
        label: "Engagement",
        featureRange: "F021-F023",
        items: [available("Communications", "/crm/communications")],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F024-F026",
        items: [
          available("Dashboard", "/crm/dashboard"),
          planned("Reports", "/crm/reports"),
        ],
      },
      {
        id: "data",
        label: "Data",
        featureRange: "F027-F028",
        items: [
          planned("Imports & Exports", "/crm/data/import-export"),
          planned("Duplicate Management", "/crm/data/duplicates"),
        ],
      },
      {
        id: "setup",
        label: "Setup",
        featureRange: "F029-F030",
        items: [
          { ...available("Territories & Sales Teams", "/crm/settings/territories"), requiredPermission: "crm.settings.manage" },
          adminOnly(
            "Lead Sources",
            "/crm/settings/lead-sources",
            "crm.settings.manage",
          ),
          adminOnly(
            "Assignment & Territories",
            "/crm/settings/assignment",
            "crm.settings.manage",
          ),
          adminOnly(
            "Lead Scoring",
            "/crm/settings/lead-scoring",
            "crm.settings.manage",
          ),
          adminOnly(
            "Pipeline Stages",
            "/crm/settings/pipeline-stages",
            "crm.settings.manage",
          ),
          adminOnly(
            "Qualification / Playbooks",
            "/crm/settings/playbooks",
            "crm.settings.manage",
          ),
        ],
      },
    ],
  },
  {
    moduleKey: "sales",
    label: "Sales",
    icon: ShoppingCart,
    requiredPermission: "sales.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/sales")],
      },
      {
        id: "selling",
        label: "Selling",
        featureRange: "F031-F040",
        items: [
          planned("Quotations", "/sales/quotations"),
          planned("Sales Orders", "/sales/orders"),
          planned("Availability", "/sales/availability"),
        ],
      },
      {
        id: "fulfillment",
        label: "Fulfillment",
        featureRange: "F041-F046",
        items: [
          planned("Deliveries", "/sales/deliveries"),
          planned("Backorders", "/sales/backorders"),
        ],
      },
      {
        id: "billing",
        label: "Billing",
        featureRange: "F047-F052",
        items: [
          planned("Invoices", "/sales/invoices"),
          planned("Advances", "/sales/advances"),
          planned("Credit / Adjustments", "/sales/credit-adjustments"),
        ],
      },
      {
        id: "returns",
        label: "Returns",
        featureRange: "F053-F054",
        items: [planned("Returns", "/sales/returns")],
      },
      {
        id: "commercial",
        label: "Commercial",
        featureRange: "F055-F058",
        items: [
          planned("Price Lists", "/sales/price-lists"),
          planned("Discounts", "/sales/discounts"),
          planned("Terms", "/sales/terms"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F059-F062",
        items: [
          planned("Sales Analytics", "/sales/analytics"),
          planned("Order Status", "/sales/order-status"),
          planned("Profitability", "/sales/profitability"),
          planned("Reports", "/sales/reports"),
        ],
      },
    ],
  },
  {
    moduleKey: "procurement",
    label: "Procurement",
    icon: Truck,
    requiredPermission: "procurement.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/procurement")],
      },
      {
        id: "requests",
        label: "Requests",
        featureRange: "F063-F066",
        items: [
          planned("Purchase Requisitions", "/procurement/requisitions"),
          planned("Approval Queue", "/procurement/approval-queue"),
        ],
      },
      {
        id: "sourcing",
        label: "Sourcing",
        featureRange: "F067-F072",
        items: [
          planned("RFQs", "/procurement/rfqs"),
          planned("Supplier Quotations", "/procurement/supplier-quotations"),
          planned("Awards", "/procurement/awards"),
        ],
      },
      {
        id: "purchasing",
        label: "Purchasing",
        featureRange: "F073-F078",
        items: [
          planned("Purchase Orders", "/procurement/orders"),
          planned("Agreements", "/procurement/agreements"),
        ],
      },
      {
        id: "receiving",
        label: "Receiving",
        featureRange: "F079-F082",
        items: [
          planned("Goods Receipts", "/procurement/receipts"),
          planned("Rejections", "/procurement/rejections"),
          planned("Returns", "/procurement/returns"),
        ],
      },
      {
        id: "invoices-cost",
        label: "Invoices & Cost",
        featureRange: "F083-F086",
        items: [
          planned("Supplier Invoices", "/procurement/invoices"),
          planned("Three-Way Match", "/procurement/three-way-match"),
          planned("Landed Cost", "/procurement/landed-cost"),
        ],
      },
      {
        id: "suppliers",
        label: "Suppliers",
        featureRange: "F087-F090",
        items: [
          planned("Supplier Master", "/procurement/suppliers"),
          planned("Supplier Performance", "/procurement/supplier-performance"),
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F091-F093",
        items: [planned("Procurement Planning", "/procurement/planning")],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F094-F096",
        items: [
          planned("Spend Analytics", "/procurement/spend-analytics"),
          planned("Reports", "/procurement/reports"),
        ],
      },
    ],
  },
  {
    moduleKey: "stock",
    label: "Inventory",
    icon: Boxes,
    requiredPermission: "stock.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/inventory")],
      },
      {
        id: "items",
        label: "Items",
        featureRange: "F097-F102",
        items: [
          planned("Items", "/inventory/items"),
          planned("Variants", "/inventory/variants"),
          planned("Units of Measure", "/inventory/units-of-measure"),
        ],
      },
      {
        id: "stock",
        label: "Stock",
        featureRange: "F103-F108",
        items: [
          planned("Availability", "/inventory/availability"),
          planned("Stock Ledger", "/inventory/ledger"),
          planned("Reservations", "/inventory/reservations"),
        ],
      },
      {
        id: "warehouses",
        label: "Warehouses",
        featureRange: "F109-F111",
        items: [
          planned("Warehouses", "/inventory/warehouses"),
          planned("Locations / Bins", "/inventory/locations"),
        ],
      },
      {
        id: "operations",
        label: "Operations",
        featureRange: "F112-F118",
        items: [
          planned("Receipts", "/inventory/receipts"),
          planned("Issues", "/inventory/issues"),
          planned("Transfers", "/inventory/transfers"),
          planned("Adjustments", "/inventory/adjustments"),
        ],
      },
      {
        id: "traceability",
        label: "Traceability",
        featureRange: "F119-F125",
        items: [
          planned("Lots / Batches", "/inventory/lots"),
          planned("Serial Numbers", "/inventory/serial-numbers"),
          planned("Expiry", "/inventory/expiry"),
          planned("Genealogy", "/inventory/genealogy"),
        ],
      },
      {
        id: "counting",
        label: "Counting",
        featureRange: "F126-F128",
        items: [
          planned("Cycle Counts", "/inventory/cycle-counts"),
          planned("Physical Inventory", "/inventory/physical-inventory"),
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F129-F132",
        items: [
          planned("Replenishment", "/inventory/replenishment"),
          planned("Reorder Rules", "/inventory/reorder-rules"),
        ],
      },
      {
        id: "valuation",
        label: "Valuation",
        featureRange: "F133-F138",
        items: [
          planned("Costing", "/inventory/costing"),
          planned("Inventory Valuation", "/inventory/valuation"),
          planned("Movement", "/inventory/movement"),
          planned("Aging", "/inventory/aging"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F139-F144",
        items: [planned("Reports", "/inventory/reports")],
      },
    ],
  },
  {
    moduleKey: "manufacturing",
    label: "Manufacturing",
    icon: Factory,
    requiredPermission: "manufacturing.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/manufacturing")],
      },
      {
        id: "engineering",
        label: "Engineering",
        featureRange: "F145-F151",
        items: [
          planned("BOMs", "/manufacturing/boms"),
          planned("BOM Versions", "/manufacturing/bom-versions"),
          planned("Routings", "/manufacturing/routings"),
          planned("Engineering Changes", "/manufacturing/engineering-changes"),
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F152-F157",
        items: [
          planned("MRP", "/manufacturing/mrp"),
          planned("Material Planning", "/manufacturing/material-planning"),
          planned("Capacity", "/manufacturing/capacity"),
          planned("Scheduling", "/manufacturing/scheduling"),
        ],
      },
      {
        id: "production",
        label: "Production",
        featureRange: "F158-F165",
        items: [
          planned("Production Orders", "/manufacturing/production-orders"),
          planned("Shop Floor", "/manufacturing/shop-floor"),
          planned("Operations", "/manufacturing/operations"),
        ],
      },
      {
        id: "materials",
        label: "Materials",
        featureRange: "F166-F170",
        items: [
          planned("Reservations", "/manufacturing/reservations"),
          planned("Consumption", "/manufacturing/consumption"),
          planned("WIP", "/manufacturing/wip"),
        ],
      },
      {
        id: "output",
        label: "Output",
        featureRange: "F171-F175",
        items: [
          planned("Finished Output", "/manufacturing/finished-output"),
          planned("By-Products", "/manufacturing/by-products"),
          planned("Scrap / Rework", "/manufacturing/scrap-rework"),
        ],
      },
      {
        id: "quality",
        label: "Quality",
        featureRange: "F176-F177",
        items: [planned("Quality / Holds", "/manufacturing/quality-holds")],
      },
      {
        id: "resources",
        label: "Resources",
        featureRange: "F178-F181",
        items: [
          planned("Work Centers", "/manufacturing/work-centers"),
          planned("Resources", "/manufacturing/resources"),
          planned("Calendars", "/manufacturing/calendars"),
        ],
      },
      {
        id: "cost",
        label: "Cost",
        featureRange: "F182-F186",
        items: [
          planned("Production Cost", "/manufacturing/production-cost"),
          planned("Variance", "/manufacturing/variance"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F187-F192",
        items: [
          planned("Performance", "/manufacturing/performance"),
          planned("Downtime", "/manufacturing/downtime"),
          planned("Reports", "/manufacturing/reports"),
        ],
      },
    ],
  },
  {
    moduleKey: "projects",
    label: "Projects",
    icon: FolderKanban,
    requiredPermission: "projects.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/projects")],
      },
      {
        id: "projects",
        label: "Projects",
        featureRange: "F193-F196",
        items: [
          planned("All Projects", "/projects/all"),
          planned("Templates", "/projects/templates"),
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F197-F203",
        items: [
          planned("WBS", "/projects/wbs"),
          planned("Tasks", "/projects/tasks"),
          planned("Milestones", "/projects/milestones"),
          planned("Schedule / Gantt", "/projects/schedule"),
        ],
      },
      {
        id: "resources",
        label: "Resources",
        featureRange: "F204-F206",
        items: [
          planned("Resource Allocation", "/projects/resource-allocation"),
          planned("Capacity", "/projects/capacity"),
        ],
      },
      {
        id: "time-expense",
        label: "Time & Expense",
        featureRange: "F207-F210",
        items: [
          planned("Timesheets", "/projects/timesheets"),
          planned("Expenses", "/projects/expenses"),
        ],
      },
      {
        id: "financials",
        label: "Financials",
        featureRange: "F211-F215",
        items: [
          planned("Budgets", "/projects/budgets"),
          planned("Costs", "/projects/costs"),
          planned("Commitments", "/projects/commitments"),
          planned("Project Procurement", "/projects/procurement"),
        ],
      },
      {
        id: "billing",
        label: "Billing",
        featureRange: "F216-F218",
        items: [
          planned("Billing", "/projects/billing"),
          planned("Project Invoices", "/projects/invoices"),
        ],
      },
      {
        id: "control",
        label: "Control",
        featureRange: "F219-F224",
        items: [
          planned("Risks", "/projects/risks"),
          planned("Issues", "/projects/issues"),
          planned("Documents", "/projects/documents"),
          planned("Progress", "/projects/progress"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F225-F230",
        items: [
          planned("Profitability", "/projects/profitability"),
          planned("Reports", "/projects/reports"),
        ],
      },
    ],
  },
  {
    moduleKey: "assets",
    label: "Assets",
    icon: Wrench,
    requiredPermission: "assets.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/assets")],
      },
      {
        id: "assets",
        label: "Assets",
        featureRange: "F231-F234",
        items: [
          planned("Asset Register", "/assets/register"),
          planned("Asset Categories", "/assets/categories"),
        ],
      },
      {
        id: "acquisition",
        label: "Acquisition",
        featureRange: "F235-F237",
        items: [
          planned("Acquisition", "/assets/acquisition"),
          planned("Capitalization", "/assets/capitalization"),
        ],
      },
      {
        id: "custody",
        label: "Custody",
        featureRange: "F238-F241",
        items: [
          planned("Assignments", "/assets/assignments"),
          planned("Transfers", "/assets/transfers"),
          planned("Locations", "/assets/locations"),
        ],
      },
      {
        id: "value",
        label: "Value",
        featureRange: "F242-F245",
        items: [
          planned("Depreciation", "/assets/depreciation"),
          planned("Revaluation", "/assets/revaluation"),
          planned("Impairment", "/assets/impairment"),
        ],
      },
      {
        id: "maintenance",
        label: "Maintenance",
        featureRange: "F246-F250",
        items: [
          planned("Maintenance Plans", "/assets/maintenance-plans"),
          planned("Work Orders", "/assets/work-orders"),
          planned("Downtime", "/assets/downtime"),
        ],
      },
      {
        id: "compliance",
        label: "Compliance",
        featureRange: "F251-F254",
        items: [
          planned("Inspections", "/assets/inspections"),
          planned("Calibration", "/assets/calibration"),
          planned("Physical Verification", "/assets/physical-verification"),
        ],
      },
      {
        id: "disposal",
        label: "Disposal",
        featureRange: "F255-F257",
        items: [
          planned("Retirement", "/assets/retirement"),
          planned("Disposal / Sale", "/assets/disposal"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F258-F267",
        items: [
          planned("Asset Analytics", "/assets/analytics"),
          planned("Reports", "/assets/reports"),
        ],
      },
    ],
  },
  {
    moduleKey: "point-of-sale",
    label: "POS",
    icon: Store,
    requiredPermission: "pos.view",
    sections: [
      { id: "overview", label: "Overview", items: [available("Home", "/pos")] },
      // In-transaction checkout mode hides ordinary ERP nav for a focused
      // surface (Prompt 10) — "Open POS" is deliberately not a normal
      // secondary-nav destination among these, it's a distinct mode.
      {
        id: "sell",
        label: "Sell",
        featureRange: "F268-F272",
        items: [
          planned("Open POS", "/pos/checkout"),
          planned("Transactions", "/pos/transactions"),
        ],
      },
      {
        id: "stores",
        label: "Stores",
        featureRange: "F273-F277",
        items: [
          planned("Stores", "/pos/stores"),
          planned("Terminals", "/pos/terminals"),
          planned("Sessions", "/pos/sessions"),
        ],
      },
      {
        id: "cash",
        label: "Cash",
        featureRange: "F278-F282",
        items: [
          planned("Shifts", "/pos/shifts"),
          planned("Cash Movement", "/pos/cash-movement"),
          planned("Day Close", "/pos/day-close"),
        ],
      },
      {
        id: "returns",
        label: "Returns",
        featureRange: "F283-F286",
        items: [
          planned("Returns", "/pos/returns"),
          planned("Refunds", "/pos/refunds"),
          planned("Exchanges", "/pos/exchanges"),
        ],
      },
      {
        id: "customers",
        label: "Customers",
        featureRange: "F287-F290",
        items: [
          planned("Customers", "/pos/customers"),
          planned("Loyalty", "/pos/loyalty"),
        ],
      },
      {
        id: "inventory",
        label: "Inventory",
        featureRange: "F291-F294",
        items: [
          planned("POS Inventory", "/pos/inventory"),
          planned("Stock Sync", "/pos/stock-sync"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F295-F307",
        items: [planned("Reports", "/pos/reports")],
      },
    ],
  },
  {
    moduleKey: "quality",
    label: "Quality",
    icon: BadgeCheck,
    requiredPermission: "quality.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/quality")],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F308-F312",
        items: [
          planned("Specifications", "/quality/specifications"),
          planned("Quality Plans", "/quality/plans"),
          planned("Sampling", "/quality/sampling"),
        ],
      },
      {
        id: "inspections",
        label: "Inspections",
        featureRange: "F313-F318",
        items: [
          planned("Incoming Inspection", "/quality/incoming-inspection"),
          planned("In-Process Inspection", "/quality/in-process-inspection"),
          planned("Final Inspection", "/quality/final-inspection"),
        ],
      },
      {
        id: "non-conformance",
        label: "Non-Conformance",
        featureRange: "F319-F323",
        items: [
          planned("Defects", "/quality/defects"),
          planned("NCR", "/quality/ncr"),
          planned("Holds", "/quality/holds"),
        ],
      },
      {
        id: "disposition",
        label: "Disposition",
        featureRange: "F324-F327",
        items: [
          planned("Rework", "/quality/rework"),
          planned("Scrap", "/quality/scrap"),
          planned("Return", "/quality/return"),
          planned("Release", "/quality/release"),
        ],
      },
      {
        id: "capa",
        label: "CAPA",
        featureRange: "F328-F331",
        items: [
          planned("Root Cause", "/quality/root-cause"),
          planned("Corrective Actions", "/quality/corrective-actions"),
          planned("Preventive Actions", "/quality/preventive-actions"),
          planned("Effectiveness", "/quality/effectiveness"),
        ],
      },
      {
        id: "supplier-customer",
        label: "Supplier & Customer Quality",
        featureRange: "F332-F335",
        items: [
          planned("Supplier Quality", "/quality/supplier-quality"),
          planned("Customer Quality", "/quality/customer-quality"),
        ],
      },
      {
        id: "compliance",
        label: "Compliance",
        featureRange: "F336-F339",
        items: [
          planned("Audits", "/quality/audits"),
          planned("Calibration", "/quality/calibration"),
          planned("Certificates", "/quality/certificates"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F340-F342",
        items: [
          planned("Quality Cost", "/quality/cost"),
          planned("Quality KPI", "/quality/kpi"),
          planned("Reports", "/quality/reports"),
        ],
      },
    ],
  },
  {
    moduleKey: "support",
    label: "Support",
    icon: LifeBuoy,
    requiredPermission: "support.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/support")],
      },
      {
        id: "tickets",
        label: "Tickets",
        featureRange: "F343-F350",
        items: [
          planned("My Tickets", "/support/my-tickets"),
          planned("All Tickets", "/support/tickets"),
          planned("Unassigned", "/support/unassigned"),
          planned("Escalated", "/support/escalated"),
        ],
      },
      {
        id: "queues",
        label: "Queues",
        featureRange: "F351-F355",
        items: [
          planned("Team Queues", "/support/queues"),
          planned("Routing", "/support/routing"),
        ],
      },
      {
        id: "channels",
        label: "Channels",
        featureRange: "F356-F359",
        items: [planned("Channels", "/support/channels")],
      },
      {
        id: "sla",
        label: "SLA",
        featureRange: "F360-F364",
        items: [
          planned("SLA Policies", "/support/sla-policies"),
          planned("Breaches", "/support/breaches"),
          planned("Escalations", "/support/escalations"),
        ],
      },
      {
        id: "knowledge",
        label: "Knowledge",
        featureRange: "F365-F369",
        items: [
          planned("Articles", "/support/articles"),
          planned("Guided Resolution", "/support/guided-resolution"),
        ],
      },
      {
        id: "customers",
        label: "Customers",
        featureRange: "F370-F374",
        items: [
          planned("Service Context", "/support/service-context"),
          planned("Portal Administration", "/support/portal-admin"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F375-F380",
        items: [
          planned("CSAT", "/support/csat"),
          planned("Agent Performance", "/support/agent-performance"),
          planned("SLA Reports", "/support/sla-reports"),
        ],
      },
    ],
  },
  {
    moduleKey: "hr-payroll",
    label: "HR & Payroll",
    icon: Landmark,
    requiredPermission: "hr_payroll.view",
    sections: [
      { id: "overview", label: "Overview", items: [available("Home", "/hr")] },
      {
        id: "people",
        label: "People",
        featureRange: "F381-F386",
        items: [
          planned("Employees", "/hr/employees"),
          planned("Organization", "/hr/organization"),
          planned("Departments", "/hr/departments"),
          planned("Positions", "/hr/positions"),
        ],
      },
      {
        id: "lifecycle",
        label: "Lifecycle",
        featureRange: "F387-F392",
        items: [
          planned("Onboarding", "/hr/onboarding"),
          planned("Transfers", "/hr/transfers"),
          planned("Promotions", "/hr/promotions"),
          planned("Offboarding", "/hr/offboarding"),
        ],
      },
      {
        id: "recruitment",
        label: "Recruitment",
        featureRange: "F393-F398",
        items: [
          planned("Requisitions", "/hr/requisitions"),
          planned("Candidates", "/hr/candidates"),
          planned("Interviews", "/hr/interviews"),
          planned("Offers", "/hr/offers"),
        ],
      },
      {
        id: "time",
        label: "Time",
        featureRange: "F399-F404",
        items: [
          planned("Attendance", "/hr/attendance"),
          planned("Shifts", "/hr/shifts"),
          planned("Rosters", "/hr/rosters"),
          planned("Overtime", "/hr/overtime"),
        ],
      },
      {
        id: "leave",
        label: "Leave",
        featureRange: "F405-F409",
        items: [
          planned("Leave Requests", "/hr/leave-requests"),
          planned("Balances", "/hr/leave-balances"),
          planned("Policies", "/hr/leave-policies"),
        ],
      },
      {
        id: "compensation",
        label: "Compensation",
        featureRange: "F410-F414",
        items: [
          planned("Salary Structures", "/hr/salary-structures"),
          planned("Pay Components", "/hr/pay-components"),
        ],
      },
      {
        id: "payroll",
        label: "Payroll",
        featureRange: "F415-F422",
        items: [
          planned("Payroll Runs", "/hr/payroll-runs"),
          planned("Exceptions", "/hr/payroll-exceptions"),
          planned("Payslips", "/hr/payslips"),
          planned("Settlements", "/hr/settlements"),
        ],
      },
      {
        id: "compliance",
        label: "Compliance",
        featureRange: "F423-F428",
        items: [planned("Statutory Compliance", "/hr/statutory-compliance")],
      },
      {
        id: "performance-growth",
        label: "Performance & Growth",
        featureRange: "F429-F440",
        items: [
          planned("Goals", "/hr/goals"),
          planned("Reviews", "/hr/reviews"),
          planned("Skills", "/hr/skills"),
          planned("Learning", "/hr/learning"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F441-F452",
        items: [planned("Reports", "/hr/reports")],
      },
    ],
  },
  {
    moduleKey: "accounting",
    label: "Accounting",
    icon: Building2,
    requiredPermission: "accounting.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/accounting")],
      },
      {
        id: "ledger",
        label: "Ledger",
        featureRange: "F453-F458",
        items: [
          planned("Chart of Accounts", "/accounting/chart-of-accounts"),
          planned("Journals", "/accounting/journals"),
          planned("General Ledger", "/accounting/general-ledger"),
          planned("Fiscal Periods", "/accounting/fiscal-periods"),
        ],
      },
      {
        id: "receivables",
        label: "Receivables",
        featureRange: "F459-F464",
        items: [
          planned("Customer Invoices", "/accounting/customer-invoices"),
          planned("Receipts", "/accounting/receipts"),
          planned("Credit", "/accounting/credit"),
          planned("AR Aging", "/accounting/ar-aging"),
        ],
      },
      {
        id: "payables",
        label: "Payables",
        featureRange: "F465-F470",
        items: [
          planned("Supplier Invoices", "/accounting/supplier-invoices"),
          planned("Payments", "/accounting/payments"),
          planned("AP Aging", "/accounting/ap-aging"),
        ],
      },
      {
        id: "banking",
        label: "Banking",
        featureRange: "F471-F475",
        items: [
          planned("Bank Accounts", "/accounting/bank-accounts"),
          planned("Bank Transactions", "/accounting/bank-transactions"),
          planned("Reconciliation", "/accounting/reconciliation"),
        ],
      },
      {
        id: "tax",
        label: "Tax",
        featureRange: "F476-F480",
        items: [
          planned("GST", "/accounting/gst"),
          planned("TDS / TCS", "/accounting/tds-tcs"),
          planned("Tax Reports", "/accounting/tax-reports"),
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F481-F486",
        items: [
          planned("Budgets", "/accounting/budgets"),
          planned("Accruals", "/accounting/accruals"),
          planned("Prepayments", "/accounting/prepayments"),
          planned("Revenue Schedules", "/accounting/revenue-schedules"),
        ],
      },
      {
        id: "corporate",
        label: "Corporate",
        featureRange: "F487-F492",
        items: [
          planned("Foreign Exchange", "/accounting/fx"),
          planned("Intercompany", "/accounting/intercompany"),
          planned("Consolidation", "/accounting/consolidation"),
        ],
      },
      {
        id: "close",
        label: "Close",
        featureRange: "F493-F497",
        items: [
          planned("Close Checklist", "/accounting/close-checklist"),
          planned("Period Close", "/accounting/period-close"),
          planned("Trial Balance", "/accounting/trial-balance"),
        ],
      },
      {
        id: "reports",
        label: "Reports",
        featureRange: "F498-F505",
        items: [
          planned("Profit & Loss", "/accounting/profit-loss"),
          planned("Balance Sheet", "/accounting/balance-sheet"),
          planned("Cash Flow", "/accounting/cash-flow"),
          planned("Audit/Statutory Reports", "/accounting/statutory-reports"),
        ],
      },
      {
        id: "setup",
        label: "Setup",
        featureRange: "F506-F510",
        items: [
          adminOnly(
            "Accounting Settings",
            "/accounting/settings",
            "accounting.settings.manage",
          ),
        ],
      },
    ],
  },
];

export function getModuleNavigation(
  moduleKey: string,
): ModuleNavigation | null {
  return (
    MODULE_NAVIGATION.find((entry) => entry.moduleKey === moduleKey) ?? null
  );
}
