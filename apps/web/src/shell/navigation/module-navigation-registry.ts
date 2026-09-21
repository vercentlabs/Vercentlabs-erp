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
          available("Forecast", "/crm/forecast"),
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
          available("Reports", "/crm/reports"),
        ],
      },
      {
        id: "data",
        label: "Data",
        featureRange: "F027-F028",
        items: [
          available("Imports & Exports", "/crm/data/import-export"),
          available("Duplicate Management", "/crm/data/duplicates"),
        ],
      },
      {
        id: "setup",
        label: "Setup",
        featureRange: "F029-F030",
        items: [
          { ...available("Territories & Sales Teams", "/crm/settings/territories"), requiredPermission: "crm.settings.manage" },
          { ...available("Custom Fields & Tags", "/crm/settings/custom-fields-and-tags"), requiredPermission: "crm.settings.manage" },
          { ...available("Custom Record Fields", "/crm/settings/record-fields"), requiredPermission: "crm.settings.manage" },
          { ...available("Lead Sources", "/crm/settings/lead-sources"), requiredPermission: "crm.settings.manage" },
          { ...available("Assignment Rules", "/crm/settings/assignment"), requiredPermission: "crm.settings.manage" },
          { ...available("Lead Lifecycle Stages", "/crm/settings/lead-lifecycle"), requiredPermission: "crm.settings.manage" },
          { ...available("Lead Scoring", "/crm/settings/lead-scoring"), requiredPermission: "crm.settings.manage" },
          { ...available("Pipeline Stages", "/crm/settings/pipeline-stages"), requiredPermission: "crm.settings.manage" },
          { ...available("Won / Lost Reasons", "/crm/settings/lost-reasons"), requiredPermission: "crm.settings.manage" },
          { ...available("Qualification / Playbooks", "/crm/settings/playbooks"), requiredPermission: "crm.settings.manage" },
          { ...available("Meeting Links", "/crm/settings/meeting-links"), requiredPermission: "crm.settings.manage" },
          // F002 Stage A2 §13 — deliberately gated by the PLATFORM privacy
          // permission, not a crm.* one: an ordinary CRM settings manager
          // must not also gain privacy-administration authority.
          { ...available("Privacy Administration", "/crm/settings/privacy"), requiredPermission: "platform.privacy.manage" },
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
        items: [available("Home", "/sales"), available("Settings", "/sales/settings")],
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
        items: [available("Home", "/procurement"), available("Settings", "/procurement/settings")],
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
          available("Supplier Performance", "/procurement/supplier-performance"),
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F091-F093",
        items: [available("Procurement Planning", "/procurement/planning"),
          available("Subcontracting", "/procurement/subcontract")],
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
          available("Engineering Changes", "/manufacturing/engineering-changes"),
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
        items: [available("Inspections", "/manufacturing/inspections"),
          available("Time Tracking", "/manufacturing/time-tracking"),
          available("Subcontracting", "/manufacturing/subcontracting")],
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
          { ...available("Stores", "/pos/stores"), requiredPermission: "pos.store.manage" },
          { ...available("Terminals", "/pos/terminals"), requiredPermission: "pos.terminal.manage" },
          { ...available("Cashiers", "/pos/cashiers"), requiredPermission: "pos.store.manage" },
          { ...available("Settings", "/pos/settings"), requiredPermission: "pos.settings.manage" },
        ],
      },
      {
        id: "discounts",
        label: "Discounts",
        featureRange: "F279-F281",
        items: [
          { ...available("Promotions", "/pos/promotions"), requiredPermission: "pos.settings.manage" },
          { ...available("Coupons", "/pos/coupons"), requiredPermission: "pos.settings.manage" },
          { ...available("Discount Approvals", "/pos/discount-approvals"), requiredPermission: "pos.discount.approve" },
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
          { ...available("Offline Sync Conflicts", "/pos/offline-sync-conflicts"), requiredPermission: "pos.offline.resolve" },
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
          { ...available("Reconciliation", "/pos/reconciliation"), requiredPermission: "pos.reconciliation.view" },
          // F305: every completed sale/return's GL posting status, with
          // retry for anything failed.
          { ...available("Accounting Posting", "/pos/accounting"), requiredPermission: "pos.accounting.view" },
          // F307: real date-range/store/terminal/cashier drilldown
          // analytics, replacing the coarse today-only dashboard aggregate.
          { ...available("Analytics", "/pos/analytics"), requiredPermission: "pos.analytics.view" },
          // F295-F307 hub -- a lightweight index page linking out to the
          // four screens above (day-end reports, reconciliation, accounting
          // posting, analytics) plus ad hoc POS reporting access; it computes
          // nothing of its own, so it only needs the general pos.reports.view
          // floor, not any one of those screens' own narrower permission.
          { ...available("Reports", "/pos/reports"), requiredPermission: "pos.reports.view" },
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
      { id: "overview", label: "Overview", items: [available("Home", "/hr"), available("My Profile", "/hr/me"), available("Settings", "/hr/settings")] },
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
