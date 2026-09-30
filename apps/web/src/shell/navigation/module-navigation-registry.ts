// The canonical, single-authority module secondary-navigation registry
// (Prompt 2B Phase 2). Desktop secondary sidebar, the mobile drawer's
// per-module section, and (in a later prompt) the command menu must all
// read from this file — none may define a parallel nav list.
//
// STATUS HONESTY: an item is AVAILABLE only once the prompt that built its
// screen flips it here — do not flip one speculatively. For every module
// other than CRM, every item is still PLANNED except each module's own
// "Overview"/root item (apps/web/src/app/(workspace)/<module>/page.tsx). CRM's clean rebuild
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
  CalendarClock,
  Database,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  UserSearch,
  Workflow,
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
    // Seven permanent workspaces. Everything else (Pipeline, activity lists,
    // Dashboard, every configuration page, imports, duplicates, coverage)
    // is registered as a child of the workspace that owns it: still routed,
    // searchable and breadcrumbed, never a sidebar entry of its own.
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [
          available("Home", "/crm"),
          {
            ...available("Dashboard", "/crm/dashboard"),
            parent: "home",
            aliases: ["kpi", "metrics"],
          },
        ],
      },
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
        id: "sales",
        label: "Sales",
        featureRange: "F009-F012",
        items: [
          available("Opportunities", "/crm/opportunities"),
          {
            ...available("Pipeline", "/crm/pipeline"),
            parent: "opportunities",
            aliases: ["board", "kanban", "deals"],
          },
        ],
      },
      {
        id: "work",
        label: "Work",
        featureRange: "F013-F019",
        items: [
          { ...available("My Work", "/crm/work"), aliases: ["today"] },
          { ...available("Tasks", "/crm/tasks"), parent: "my-work" },
          { ...available("Calls", "/crm/calls"), parent: "my-work" },
          { ...available("Meetings", "/crm/meetings"), parent: "my-work" },
          { ...available("Follow-ups", "/crm/follow-ups"), parent: "my-work" },
          {
            ...available("Inbox", "/crm/communications"),
            parent: "my-work",
            aliases: ["communications", "email", "conversations"],
          },
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F024-F026, F030",
        items: [
          {
            ...available("Forecast", "/crm/forecast"),
            requiredAnyPermission: [
              "crm.forecast.submit",
              "crm.forecast.review",
              "crm.forecast.manage",
            ],
          },
          {
            ...available("Reports", "/crm/reports"),
            requiredPermission: "crm.reports.view",
          },
        ],
      },
      {
        id: "administration",
        label: "Administration",
        featureRange: "F004-F008, F020-F021, F026-F028",
        items: [
          {
            ...available("CRM Setup", "/crm/settings"),
            aliases: ["settings", "configuration", "administration"],
            // Shown to anyone who can open at least one destination inside
            // it; each destination keeps its own permission below.
            requiredAnyPermission: [
              "crm.settings.manage",
              "crm.teams.manage",
              "crm.territories.manage",
              "crm.coverage.view",
              "crm.data-quality.manage",
              "crm.privacy.manage",
              "crm.import",
            ],
          },
          // Sales process
          {
            ...available(
              "Lead Lifecycle Stages",
              "/crm/settings/lead-lifecycle",
            ),
            parent: "crm-setup",
            group: "sales-process",
            description:
              "The stages a lead moves through and which moves are allowed.",
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available(
              "Qualification / Playbooks",
              "/crm/settings/playbooks",
            ),
            parent: "crm-setup",
            group: "sales-process",
            description:
              "Qualification questions and the playbooks sellers follow.",
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Pipeline Stages", "/crm/settings/pipeline-stages"),
            parent: "crm-setup",
            group: "sales-process",
            description:
              "Pipelines, their sales stages and default probabilities.",
            aliases: ["sales stages"],
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Won / Lost Reasons", "/crm/settings/lost-reasons"),
            parent: "crm-setup",
            group: "sales-process",
            description: "The reasons a deal can be won or lost.",
            aliases: ["outcome reasons"],
            requiredPermission: "crm.settings.manage",
          },
          // Routing & organization
          {
            ...available("Assignment Rules", "/crm/settings/assignment"),
            parent: "crm-setup",
            group: "routing-organization",
            description: "Route new leads to eligible owners, with fallbacks.",
            aliases: ["routing", "round robin"],
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available(
              "Territories & Sales Teams",
              "/crm/settings/territories",
            ),
            parent: "crm-setup",
            group: "routing-organization",
            description:
              "Teams, hierarchy, territories, forecast periods and quotas.",
            aliases: ["territory", "sales teams", "quotas"],
            requiredAnyPermission: [
              "crm.teams.manage",
              "crm.territories.manage",
              "crm.forecast.manage",
            ],
          },
          {
            ...available("Sales Coverage", "/crm/coverage"),
            parent: "crm-setup",
            group: "routing-organization",
            description: "Who covers what, coverage gaps and unassigned work.",
            aliases: ["reassign", "unassigned"],
            requiredPermission: "crm.coverage.view",
          },
          // Lead management
          {
            ...available("Lead Sources", "/crm/settings/lead-sources"),
            parent: "crm-setup",
            group: "lead-management",
            description: "Where leads come from, for routing and attribution.",
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Lead Scoring", "/crm/settings/lead-scoring"),
            parent: "crm-setup",
            group: "lead-management",
            description: "Scoring models, grades and recalculation.",
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Duplicate Management", "/crm/data/duplicates"),
            parent: "crm-setup",
            group: "lead-management",
            description: "Review, dismiss and merge possible duplicates.",
            aliases: ["duplicate", "merge"],
          },
          // F008 gap-closure — gated by crm.data-quality.manage (the same
          // permission the merge/override actions in Duplicate Management
          // require), not the generic settings-manage permission.
          {
            ...available("Duplicate Rules", "/crm/settings/duplicate-rules"),
            parent: "crm-setup",
            group: "lead-management",
            description: "How records are matched as possible duplicates.",
            requiredPermission: "crm.data-quality.manage",
          },
          // Data management
          {
            ...available("Imports & Exports", "/crm/data/import-export"),
            parent: "crm-setup",
            group: "data-management",
            description: "Import leads from a file and export CRM data.",
            aliases: ["import", "export", "csv"],
          },
          // Customization
          {
            ...available(
              "Custom Fields & Tags",
              "/crm/settings/custom-fields-and-tags",
            ),
            parent: "crm-setup",
            group: "customization",
            description: "Extra fields and tags on leads, accounts and deals.",
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Custom Record Fields", "/crm/settings/record-fields"),
            parent: "crm-setup",
            group: "customization",
            description: "Fields on custom CRM record types.",
            requiredPermission: "crm.settings.manage",
          },
          // Communications & integrations
          {
            ...available("Meeting Links", "/crm/settings/meeting-links"),
            parent: "crm-setup",
            group: "communications-integrations",
            description: "Public booking links and their availability.",
            aliases: ["booking", "calendar"],
            requiredPermission: "crm.settings.manage",
          },
          // Governance — the CRM-specific data-subject request queue (Leads/
          // Contacts/Accounts), distinct from the platform-wide
          // Settings > Privacy and retention page.
          {
            ...available(
              "Data Subject Requests",
              "/crm/settings/data-requests",
            ),
            parent: "crm-setup",
            group: "governance",
            description:
              "Access, export and erasure requests about CRM records.",
            aliases: ["privacy", "consent", "gdpr", "dsr"],
            requiredPermission: "crm.privacy.manage",
          },
        ],
      },
    ],
    groups: [
      {
        id: "sales-process",
        workspace: "crm-setup",
        label: "Sales process",
        description:
          "Lead lifecycle, qualification, pipeline stages and outcome reasons.",
        icon: Workflow,
      },
      {
        id: "routing-organization",
        workspace: "crm-setup",
        label: "Routing & organization",
        description:
          "Assignment rules, teams, territories, quotas and coverage.",
        icon: Network,
      },
      {
        id: "lead-management",
        workspace: "crm-setup",
        label: "Lead management",
        description: "Lead sources, scoring and duplicate management.",
        icon: UserSearch,
      },
      {
        id: "data-management",
        workspace: "crm-setup",
        label: "Data management",
        description: "Bring data in and take it out.",
        icon: Database,
      },
      {
        id: "customization",
        workspace: "crm-setup",
        label: "Customization",
        description: "Your own fields and tags.",
        icon: SlidersHorizontal,
      },
      {
        id: "communications-integrations",
        workspace: "crm-setup",
        label: "Communications & integrations",
        description: "Meeting booking links.",
        icon: CalendarClock,
      },
      {
        id: "governance",
        workspace: "crm-setup",
        label: "Governance",
        description: "Privacy and data-subject requests.",
        icon: ShieldCheck,
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
        items: [
          available("Home", "/sales"),
          available("Settings", "/sales/settings"),
        ],
      },
      {
        id: "selling",
        label: "Selling",
        featureRange: "F031-F040",
        items: [
          available("Customers", "/sales/customers"),
          available("Products", "/sales/products"),
          available("Quotations", "/sales/quotations"),
          available("Sales Orders", "/sales/orders"),
          planned("Availability", "/sales/availability"),
        ],
      },
      {
        id: "fulfillment",
        label: "Fulfillment",
        featureRange: "F041-F046",
        items: [
          available("Deliveries", "/sales/deliveries"),
          available("Drop shipments", "/sales/drop-ships"),
          available("Backorders", "/sales/backorders"),
        ],
      },
      {
        id: "billing",
        label: "Billing",
        featureRange: "F047-F052",
        items: [
          available("Invoices", "/sales/invoices"),
          available("Advances", "/sales/advances"),
          available("Credit / Adjustments", "/sales/credit-adjustments"),
        ],
      },
      {
        id: "returns",
        label: "Returns",
        featureRange: "F053-F054",
        items: [available("Returns", "/sales/returns")],
      },
      {
        id: "commercial",
        label: "Commercial",
        featureRange: "F055-F058",
        items: [
          available("Price Lists", "/sales/price-lists"),
          available("Commissions", "/sales/commissions"),
          available("Discounts", "/sales/discounts"),
          available("Terms", "/sales/terms"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F059-F062",
        items: [
          available("Sales Analytics", "/sales/analytics"),
          available("Order Status", "/sales/order-status"),
          available("Profitability", "/sales/profitability"),
          available("Reports", "/sales/reports"),
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
        items: [
          available("Home", "/procurement"),
          available("Settings", "/procurement/settings"),
        ],
      },
      {
        id: "requests",
        label: "Requests",
        featureRange: "F063-F066",
        items: [
          available("Purchase Requisitions", "/procurement/requisitions"),
          available("Approval Queue", "/procurement/approval-queue"),
        ],
      },
      {
        id: "sourcing",
        label: "Sourcing",
        featureRange: "F067-F072",
        items: [
          available("RFQs", "/procurement/rfqs"),
          available("Supplier Quotations", "/procurement/supplier-quotations"),
          available("Awards", "/procurement/awards"),
        ],
      },
      {
        id: "purchasing",
        label: "Purchasing",
        featureRange: "F073-F078",
        items: [
          available("Purchase Orders", "/procurement/orders"),
          available("Agreements", "/procurement/agreements"),
        ],
      },
      {
        id: "receiving",
        label: "Receiving",
        featureRange: "F079-F082",
        items: [
          available("Goods Receipts", "/procurement/receipts"),
          available("Rejections", "/procurement/rejections"),
          available("Returns", "/procurement/returns"),
        ],
      },
      {
        id: "invoices-cost",
        label: "Invoices & Cost",
        featureRange: "F083-F086",
        items: [
          available("Supplier Invoices", "/procurement/invoices"),
          available("Three-Way Match", "/procurement/three-way-match"),
          available("Landed Cost", "/procurement/landed-cost"),
        ],
      },
      {
        id: "suppliers",
        label: "Suppliers",
        featureRange: "F087-F090",
        items: [
          available("Supplier Master", "/procurement/suppliers"),
          available("Categories", "/procurement/categories"),
          available("Price Lists", "/procurement/supplier-prices"),
          available("Lead Times", "/procurement/lead-times"),
          available(
            "Supplier Performance",
            "/procurement/supplier-performance",
          ),
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F091-F093",
        items: [
          available("Procurement Planning", "/procurement/planning"),
          available("Subcontracting", "/procurement/subcontract"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F094-F096",
        items: [
          available("Spend Analytics", "/procurement/spend-analytics"),
          available("Purchase History", "/procurement/purchase-history"),
          available("Reports", "/procurement/reports"),
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
          available("Items", "/inventory/items"),
          available("Variants", "/inventory/variants"),
          available("Categories", "/inventory/categories"),
          available("Units of Measure", "/inventory/units-of-measure"),
          available("Unit Conversions", "/inventory/conversions"),
        ],
      },
      {
        id: "stock",
        label: "Stock",
        featureRange: "F103-F108",
        items: [
          available("Availability", "/inventory/availability"),
          available("Stock Ledger", "/inventory/ledger"),
          available("Reservations", "/inventory/reservations"),
        ],
      },
      {
        id: "warehouses",
        label: "Warehouses",
        featureRange: "F109-F111",
        items: [
          available("Warehouses", "/inventory/warehouses"),
          available("Locations / Bins", "/inventory/locations"),
        ],
      },
      {
        id: "operations",
        label: "Operations",
        featureRange: "F112-F118",
        items: [
          available("Receipts", "/inventory/receipts"),
          available("Issues", "/inventory/issues"),
          available("Transfers", "/inventory/transfers"),
          available("Adjustments", "/inventory/adjustments"),
          available("Damaged Stock", "/inventory/damaged-stock"),
          available("Returns", "/inventory/returns"),
          available("Pick Lists", "/inventory/pick-lists"),
        ],
      },
      {
        id: "traceability",
        label: "Traceability",
        featureRange: "F119-F125",
        items: [
          available("Lots / Batches", "/inventory/lots"),
          available("Serial Numbers", "/inventory/serial-numbers"),
          available("Expiry", "/inventory/expiry"),
          available("Genealogy", "/inventory/genealogy"),
          available("Quarantine", "/inventory/quarantine"),
        ],
      },
      {
        id: "counting",
        label: "Counting",
        featureRange: "F126-F128",
        items: [
          available("Cycle Counts", "/inventory/cycle-counts"),
          available("Physical Inventory", "/inventory/physical-inventory"),
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F129-F132",
        items: [
          available("Replenishment", "/inventory/replenishment"),
          available("Reorder Rules", "/inventory/reorder-rules"),
        ],
      },
      {
        id: "valuation",
        label: "Valuation",
        featureRange: "F133-F138",
        items: [
          available("Costing", "/inventory/costing"),
          available("Inventory Valuation", "/inventory/valuation"),
          available("Movement", "/inventory/movement"),
          available("Aging", "/inventory/aging"),
          available("Landed Cost", "/inventory/landed-cost"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F139-F144",
        items: [available("Reports", "/inventory/reports")],
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
          available("BOMs", "/manufacturing/boms"),
          available("BOM Versions", "/manufacturing/bom-versions"),
          available("Routings", "/manufacturing/routings"),
          available("Where Used", "/manufacturing/where-used"),
          available(
            "Engineering Changes",
            "/manufacturing/engineering-changes",
          ),
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F152-F157",
        items: [
          available("MRP", "/manufacturing/mrp"),
          available("Material Planning", "/manufacturing/material-planning"),
          available("Capacity", "/manufacturing/capacity"),
          available("Scheduling", "/manufacturing/scheduling"),
        ],
      },
      {
        id: "production",
        label: "Production",
        featureRange: "F158-F165",
        items: [
          available("Production Orders", "/manufacturing/production-orders"),
          available("Shop Floor", "/manufacturing/shop-floor"),
          available("Operations", "/manufacturing/operations"),
        ],
      },
      {
        id: "materials",
        label: "Materials",
        featureRange: "F166-F170",
        items: [
          available("Reservations", "/manufacturing/reservations"),
          available("Consumption", "/manufacturing/consumption"),
          available("WIP", "/manufacturing/wip"),
        ],
      },
      {
        id: "output",
        label: "Output",
        featureRange: "F171-F175",
        items: [
          available("Finished Output", "/manufacturing/finished-output"),
          available("By-Products", "/manufacturing/by-products"),
          available("Scrap / Rework", "/manufacturing/scrap-rework"),
        ],
      },
      {
        id: "quality",
        label: "Quality",
        featureRange: "F176-F177",
        items: [
          available("Inspections", "/manufacturing/inspections"),
          available("Time Tracking", "/manufacturing/time-tracking"),
          available("Subcontracting", "/manufacturing/subcontracting"),
        ],
      },
      {
        id: "resources",
        label: "Resources",
        featureRange: "F178-F181",
        items: [
          available("Work Centers", "/manufacturing/work-centers"),
          planned("Resources", "/manufacturing/resources"),
          available("Calendars", "/manufacturing/calendars"),
          available("Shifts", "/manufacturing/shifts"),
          available("Holidays", "/manufacturing/calendar-exceptions"),
          available("Settings", "/manufacturing/settings"),
        ],
      },
      {
        id: "cost",
        label: "Cost",
        featureRange: "F182-F186",
        items: [
          available("Standard Cost", "/manufacturing/standard-cost"),
          available("Production Cost", "/manufacturing/production-cost"),
          available("Variance", "/manufacturing/variance"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F187-F192",
        items: [
          available("Performance", "/manufacturing/performance"),
          available("Downtime", "/manufacturing/downtime"),
          available("Yield", "/manufacturing/yield"),
          available("Production Summary", "/manufacturing/production-summary"),
          available("Reports", "/manufacturing/reports"),
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
          available("All Projects", "/projects/all"),
          available("Templates", "/projects/templates"),
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F197-F203",
        items: [
          available("Tasks", "/projects/tasks"),
          available("Milestones", "/projects/milestones"),
          available("Workspace (WBS, Gantt, Board)", "/projects/workspace"),
        ],
      },
      {
        id: "resources",
        label: "Resources",
        featureRange: "F204-F206",
        items: [
          available("Resource Allocation", "/projects/resource-allocation"),
          available("Capacity", "/projects/capacity"),
        ],
      },
      {
        id: "time-expense",
        label: "Time & Expense",
        featureRange: "F207-F210",
        items: [
          available("Time Entries", "/projects/time"),
          available("Timesheets", "/projects/timesheets"),
          available("Expenses", "/projects/expenses"),
          available("Materials", "/projects/materials"),
        ],
      },
      {
        id: "financials",
        label: "Financials",
        featureRange: "F211-F215",
        items: [
          available("Budgets", "/projects/budgets"),
          available("Project Procurement", "/projects/procurement"),
        ],
      },
      {
        id: "billing",
        label: "Billing",
        featureRange: "F216-F218",
        items: [
          available("Billing", "/projects/billing"),
          available("Project Invoices", "/projects/invoices"),
        ],
      },
      {
        id: "control",
        label: "Control",
        featureRange: "F219-F224",
        items: [
          available("Risks", "/projects/risks"),
          available("Issues", "/projects/issues"),
          available("Documents", "/projects/documents"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F225-F230",
        items: [
          available("Reports", "/projects/reports"),
          available("Settings", "/projects/settings"),
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
          available("Asset Register", "/assets/register"),
          available("Asset Categories", "/assets/categories"),
        ],
      },
      {
        id: "acquisition",
        label: "Acquisition",
        featureRange: "F235-F237",
        items: [
          available("Acquisition", "/assets/acquisition"),
          available("Capitalization", "/assets/capitalization"),
        ],
      },
      {
        id: "custody",
        label: "Custody",
        featureRange: "F238-F241",
        items: [
          available("Assignments", "/assets/assignments"),
          available("Transfers", "/assets/transfers"),
          available("Locations", "/assets/locations"),
        ],
      },
      {
        id: "value",
        label: "Value",
        featureRange: "F242-F245",
        items: [
          available("Depreciation", "/assets/depreciation"),
          available("Revaluation", "/assets/revaluation"),
          available("Impairment", "/assets/impairment"),
        ],
      },
      {
        id: "maintenance",
        label: "Maintenance",
        featureRange: "F246-F250",
        items: [
          available("Maintenance Plans", "/assets/maintenance-plans"),
          available("Work Orders", "/assets/work-orders"),
          available("Downtime", "/assets/downtime"),
          available("Warranties", "/assets/warranties"),
        ],
      },
      {
        id: "compliance",
        label: "Compliance",
        featureRange: "F251-F254",
        items: [
          available("Inspections", "/assets/inspections"),
          available("Calibration", "/assets/calibration"),
          available("Physical Verification", "/assets/physical-verification"),
        ],
      },
      {
        id: "disposal",
        label: "Disposal",
        featureRange: "F255-F257",
        items: [
          available("Retirement", "/assets/retirement"),
          available("Disposal / Sale", "/assets/disposal"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F258-F267",
        items: [
          available("Asset Analytics", "/assets/analytics"),
          available("Reports", "/assets/reports"),
          adminOnly(
            "Asset Settings",
            "/assets/settings",
            "assets.settings.manage",
          ),
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
        featureRange: "F277-F282",
        items: [
          available("Open POS", "/pos/checkout"),
          available("Transactions", "/pos/transactions"),
        ],
      },
      {
        id: "stores",
        label: "Stores",
        featureRange: "F268-F271",
        items: [
          {
            ...available("Stores", "/pos/stores"),
            requiredPermission: "pos.store.manage",
          },
          {
            ...available("Terminals", "/pos/terminals"),
            requiredPermission: "pos.terminal.manage",
          },
          {
            ...available("Cashiers", "/pos/cashiers"),
            requiredPermission: "pos.store.manage",
          },
          {
            ...available("Settings", "/pos/settings"),
            requiredPermission: "pos.settings.manage",
          },
        ],
      },
      {
        id: "discounts",
        label: "Discounts",
        featureRange: "F279-F281",
        items: [
          {
            ...available("Promotions", "/pos/promotions"),
            requiredPermission: "pos.settings.manage",
          },
          {
            ...available("Coupons", "/pos/coupons"),
            requiredPermission: "pos.settings.manage",
          },
          {
            ...available("Discount Approvals", "/pos/discount-approvals"),
            requiredPermission: "pos.discount.approve",
          },
        ],
      },
      {
        id: "cash",
        label: "Cash",
        featureRange: "F278-F282",
        // "Day Close" was removed as a separate nav destination
        // (consolidation, not a build): closing a day's business is already
        // two real, complete operations elsewhere -- ending a shift (Shifts,
        // pos.shift.close) and generating/reviewing/finalizing that day's
        // immutable Z report (/pos/reports/day-end, F303) -- and a third
        // screen for the same underlying "close the day" operation would
        // just be a second front door onto one of those, not new capability.
        items: [
          available("Shifts", "/pos/shifts"),
          available("Cash Movement", "/pos/cash-movement"),
        ],
      },
      {
        id: "returns",
        label: "Returns",
        featureRange: "F291-F293",
        // Exchanges (F293) is not a separate screen -- it's the "Exchange"
        // action on an approved return in this same Returns screen, which
        // hands off to checkout to build the replacement cart.
        items: [available("Returns", "/pos/returns")],
      },
      {
        id: "customers",
        label: "Customers",
        featureRange: "F287-F290",
        items: [
          available("Customers", "/pos/customers"),
          // F306: program config + real customer balance/ledger lookup.
          // Editing the program is gated inside the screen itself
          // (pos.loyalty.manage) since balance lookup stays open to cashiers.
          available("Loyalty", "/pos/loyalty"),
          // F290: generation happens from the receipt screen; this is the
          // searchable ledger of every invoice already generated.
          available("Invoices", "/pos/invoices"),
        ],
      },
      {
        id: "inventory",
        label: "Inventory",
        featureRange: "F291-F294",
        items: [
          // F294/F295/F296: one consolidated read-only workspace (store
          // availability + lot/batch + real-time stock-sync activity) --
          // the dossiers describe a single coherent inventory-visibility
          // capability, not two destinations, so this also replaces the
          // separate "Stock Sync" placeholder that used to sit here.
          available("POS Inventory", "/pos/inventory"),
          // F297/F298: a real screen for reviewing/resolving offline sales
          // that couldn't sync cleanly (price/stock/shift divergence).
          {
            ...available(
              "Offline Sync Conflicts",
              "/pos/offline-sync-conflicts",
            ),
            requiredPermission: "pos.offline.resolve",
          },
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F295-F307",
        // F303: day-end (Z) reports has a real screen now (list, generate,
        // review/finalize, print) -- flipped to AVAILABLE. Ordinary ad hoc
        // POS reporting (pos.reports.view) still has no screen yet.
        items: [
          available("Day-end (Z) Reports", "/pos/reports/day-end"),
          // F304: cross-report exception queue + settlement-evidence
          // import; generating a report's own reconciliation happens from
          // that report's detail screen.
          {
            ...available("Reconciliation", "/pos/reconciliation"),
            requiredPermission: "pos.reconciliation.view",
          },
          // F305: every completed sale/return's GL posting status, with
          // retry for anything failed.
          {
            ...available("Accounting Posting", "/pos/accounting"),
            requiredPermission: "pos.accounting.view",
          },
          // F307: real date-range/store/terminal/cashier drilldown
          // analytics, replacing the coarse today-only dashboard aggregate.
          {
            ...available("Analytics", "/pos/analytics"),
            requiredPermission: "pos.analytics.view",
          },
          // F295-F307 hub -- a lightweight index page linking out to the
          // four screens above (day-end reports, reconciliation, accounting
          // posting, analytics) plus ad hoc POS reporting access; it computes
          // nothing of its own, so it only needs the general pos.reports.view
          // floor, not any one of those screens' own narrower permission.
          {
            ...available("Reports", "/pos/reports"),
            requiredPermission: "pos.reports.view",
          },
        ],
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
          available("Quality Plans", "/quality/plans"),
          available("Sampling Plans", "/quality/sampling-plans"),
        ],
      },
      {
        id: "inspections",
        label: "Inspections",
        featureRange: "F313-F318",
        items: [
          available("Inspections", "/quality/inspections"),
          available("Open Inspections", "/quality/open-inspections"),
        ],
      },
      {
        id: "non-conformance",
        label: "Non-Conformance",
        featureRange: "F319-F329",
        items: [
          available("Non-Conformances", "/quality/nonconformances"),
          available("Quality Holds", "/quality/holds"),
        ],
      },
      {
        id: "capa",
        label: "CAPA",
        featureRange: "F328-F331",
        items: [available("CAPA", "/quality/capa")],
      },
      {
        id: "supplier-customer",
        label: "Supplier & Customer Quality",
        featureRange: "F332-F335",
        items: [
          available("Supplier Quality", "/quality/supplier-records"),
          available("Customer Complaints", "/quality/complaints"),
        ],
      },
      {
        id: "compliance",
        label: "Compliance",
        featureRange: "F336-F340",
        items: [
          available("Audits", "/quality/audits"),
          available("Calibration", "/quality/calibration"),
          available("Certificates", "/quality/certificates"),
          available("Documents", "/quality/documents"),
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
          available("My Tickets", "/support/my-tickets"),
          available("All Tickets", "/support/tickets"),
          available("Unassigned", "/support/unassigned"),
          available("Escalated", "/support/escalated"),
          available("Categories", "/support/categories"),
        ],
      },
      {
        id: "queues",
        label: "Queues",
        featureRange: "F351-F355",
        items: [
          available("Team Queues", "/support/queues"),
          available("Routing", "/support/routing-rules"),
        ],
      },
      {
        id: "sla",
        label: "SLA",
        featureRange: "F360-F364",
        items: [
          available("SLA Policies", "/support/sla-policies"),
          available("Breaches", "/support/breaches"),
          available("Escalations", "/support/escalation-policies"),
          available("Escalation Log", "/support/escalations-admin"),
        ],
      },
      {
        id: "knowledge",
        label: "Knowledge",
        featureRange: "F365-F369",
        items: [
          available("Articles", "/support/knowledge-articles"),
          available("Canned Responses", "/support/canned-responses"),
        ],
      },
      {
        id: "customers",
        label: "Customers",
        featureRange: "F370-F374",
        items: [
          available("Entitlements", "/support/entitlements"),
          available("Portal Administration", "/support/portal-users"),
        ],
      },
      {
        id: "customer-portal",
        label: "Customer Portal",
        featureRange: "F371",
        items: [
          available("My Tickets", "/support/portal-tickets"),
          available("Help Articles", "/support/portal-articles"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F375-F380",
        items: [
          available("CSAT", "/support/csat"),
          available("Agent Performance", "/support/agent-performance"),
          available("SLA Reports", "/support/sla-reports"),
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
      {
        id: "overview",
        label: "Overview",
        items: [
          available("Home", "/hr"),
          available("My Profile", "/hr/me"),
          available("Settings", "/hr/settings"),
        ],
      },
      {
        id: "people",
        label: "People",
        featureRange: "F381-F386",
        items: [
          available("Employees", "/hr/employees"),
          available("Organization", "/hr/organization"),
          available("Departments", "/hr/departments"),
          available("Positions", "/hr/positions"),
          available("Documents", "/hr/documents"),
          available("Document Types", "/hr/document-types"),
          available("Profile Requests", "/hr/profile-requests"),
        ],
      },
      {
        id: "lifecycle",
        label: "Lifecycle",
        featureRange: "F387-F392",
        items: [
          available("Onboarding", "/hr/onboarding"),
          available("Probation", "/hr/probation"),
          available("Confirmations", "/hr/confirmations"),
          available("Probation Extensions", "/hr/probation-extensions"),
          available("Transfers", "/hr/transfers"),
          available("Promotions", "/hr/promotions"),
          available("Offboarding", "/hr/offboarding"),
          available("Separations", "/hr/separations"),
        ],
      },
      {
        id: "recruitment",
        label: "Recruitment",
        featureRange: "F393-F398",
        items: [
          available("Job Openings", "/hr/openings"),
          available("Candidates", "/hr/candidates"),
          available("Pipeline", "/hr/applications"),
          available("Interviews", "/hr/interviews"),
          available("My Interviews", "/hr/my-interviews"),
          available("Offers", "/hr/offers"),
        ],
      },
      {
        id: "time",
        label: "Time",
        featureRange: "F399-F404",
        items: [
          available("Attendance", "/hr/attendance"),
          available("My Attendance", "/hr/my-attendance"),
          available("Corrections", "/hr/regularizations"),
          available("Team Corrections", "/hr/team-corrections"),
          available("Late & Early", "/hr/late-early"),
          available("Shifts", "/hr/shifts"),
          available("Shift Assignments", "/hr/shift-assignments"),
          available("Holiday Calendars", "/hr/holiday-calendars"),
          available("Holidays", "/hr/holidays"),
          available("Overtime", "/hr/overtime"),
          available("Team Overtime", "/hr/team-overtime"),
        ],
      },
      {
        id: "leave",
        label: "Leave",
        featureRange: "F405-F409",
        items: [
          available("Leave Requests", "/hr/leave-requests"),
          available("My Leave", "/hr/my-leave"),
          available("Team Leave", "/hr/team-leave"),
          available("Balances", "/hr/leave-balances"),
          available("My Balances", "/hr/my-leave-balances"),
          available("Policies", "/hr/leave-policies"),
          available("Leave Types", "/hr/leave-types"),
          available("Leave Administration", "/hr/leave-admin"),
        ],
      },
      {
        id: "compensation",
        label: "Compensation",
        featureRange: "F410-F414",
        items: [
          available("Salary Structures", "/hr/salary-structures"),
          available("Compensation", "/hr/compensation"),
          available("Pay Components", "/hr/pay-components"),
        ],
      },
      {
        id: "payroll",
        label: "Payroll",
        featureRange: "F415-F422",
        items: [
          available("Payroll", "/hr/payroll"),
          available("Payroll Runs", "/hr/payroll-runs"),
          available("Payroll Periods", "/hr/payroll-periods"),
          available("Exceptions", "/hr/payroll-exceptions"),
          available("Adjustments", "/hr/payroll-inputs"),
          available("Expenses", "/hr/expenses"),
          available("My Expenses", "/hr/my-expenses"),
          available("Team Expenses", "/hr/team-expenses"),
          available("Loans", "/hr/loans"),
          available("My Loans", "/hr/my-loans"),
          available("Expense Categories", "/hr/expense-categories"),
          available("Payslips", "/hr/payslips"),
          available("My Payslips", "/hr/my-payslips"),
          available("Settlements", "/hr/final-settlements"),
          available("Bank Files", "/hr/bank-files"),
        ],
      },
      {
        id: "compliance",
        label: "Compliance",
        featureRange: "F423-F428",
        items: [
          available("Statutory Components", "/hr/statutory-components"),
          available("Gratuity", "/hr/gratuity-records"),
          available("Compliance Report", "/hr/compliance-report"),
        ],
      },
      {
        id: "performance-growth",
        label: "Performance & Growth",
        featureRange: "F448-F452",
        items: [
          available("Goals", "/hr/goals"),
          available("My Goals", "/hr/my-goals"),
          available("Team Goals", "/hr/team-goals"),
          available("Review Cycles", "/hr/review-cycles"),
          available("Appraisals", "/hr/appraisals"),
          available("My Appraisals", "/hr/my-appraisals"),
          available("Appraisals to Review", "/hr/appraisals-to-review"),
          available("Skills", "/hr/skills"),
          available("Skills Matrix", "/hr/employee-skills"),
          available("My Skills", "/hr/my-skills"),
          available("Courses", "/hr/courses"),
          available("Training Sessions", "/hr/training-sessions"),
          available("Training Enrolments", "/hr/training-enrolments"),
          available("My Training", "/hr/my-training"),
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
          available("Chart of Accounts", "/accounting/chart-of-accounts"),
          available("Journals", "/accounting/journals"),
          available("General Ledger", "/accounting/general-ledger"),
          available("Fiscal Periods", "/accounting/fiscal-periods"),
        ],
      },
      {
        id: "receivables",
        label: "Receivables",
        featureRange: "F459-F464",
        items: [
          available("Customer Invoices", "/accounting/customer-invoices"),
          available("Receipts", "/accounting/receipts"),
          planned("Credit", "/accounting/credit"),
          available("AR Aging", "/accounting/ar-aging"),
        ],
      },
      {
        id: "payables",
        label: "Payables",
        featureRange: "F465-F470",
        items: [
          available("Supplier Invoices", "/accounting/supplier-invoices"),
          available("Payments", "/accounting/payments"),
          available("AP Aging", "/accounting/ap-aging"),
        ],
      },
      {
        id: "banking",
        label: "Banking",
        featureRange: "F471-F475",
        items: [
          available("Bank Accounts", "/accounting/bank-accounts"),
          available("Bank Statements", "/accounting/bank-transactions"),
          available("Reconciliation", "/accounting/reconciliation"),
        ],
      },
      {
        id: "tax",
        label: "Tax",
        featureRange: "F476-F480",
        items: [
          available("GST", "/accounting/gst"),
          planned("TDS / TCS", "/accounting/tds-tcs"),
          available("Tax Reports", "/accounting/tax-reports"),
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F481-F486",
        items: [
          available("Budgets", "/accounting/budgets"),
          available("Accruals", "/accounting/accruals"),
          available("Prepayments", "/accounting/prepayments"),
          available("Revenue Schedules", "/accounting/revenue-schedules"),
          available("Budget vs Actual", "/accounting/budget-actual"),
          available("Fixed Assets", "/accounting/assets"),
        ],
      },
      {
        id: "corporate",
        label: "Corporate",
        featureRange: "F487-F492",
        items: [
          available("Foreign Exchange", "/accounting/fx"),
          available("Intercompany", "/accounting/intercompany"),
          available("Consolidation", "/accounting/consolidation"),
        ],
      },
      {
        id: "close",
        label: "Close",
        featureRange: "F493-F497",
        items: [
          available("Close Checklist", "/accounting/close-checklist"),
          available("Period Close", "/accounting/period-close"),
          available("Trial Balance", "/accounting/trial-balance"),
        ],
      },
      {
        id: "reports",
        label: "Reports",
        featureRange: "F498-F505",
        items: [
          available("Profit & Loss", "/accounting/profit-loss"),
          available("Balance Sheet", "/accounting/balance-sheet"),
          available("Cash Flow", "/accounting/cash-flow"),
          available("Audit/Statutory Reports", "/accounting/statutory-reports"),
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
