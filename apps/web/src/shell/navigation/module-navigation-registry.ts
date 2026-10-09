// The canonical, single-authority module secondary-navigation registry.
// The desktop secondary sidebar, the mobile drawer's per-module section,
// and the command menu must all read from this file — none may define a
// parallel nav list.
//
// STATUS HONESTY: an item is AVAILABLE only once its screen is built and
// verified working end-to-end — never flip one speculatively. PLANNED items
// render in the secondary sidebar disabled, for orientation, never as a
// clickable link — see SecondarySidebar.tsx.
//
// Sections are grouped around the user's work model, not a literal
// F-id-per-item mapping; each is annotated with the coarse F-id range it
// corresponds to.
import {
  ArrowLeftRight,
  BarChart3,
  Database,
  Gauge,
  Search,
  LayoutDashboard,
  Settings,
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
  SlidersHorizontal,
  UserSearch,
} from "lucide-react";

import type { ModuleNavigation, SecondaryNavItem } from "./navigation-types";

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
  // ---------------------------------------------------------------------------------------------------------------------------------------
  // CRM, Sales, Procurement and Inventory share one sidebar shape: Overview, Master Data, Operations, Planning & Control, Inquiries, Reports,
  // Configuration — in that order, a section only when it has something to show (empty sections are hidden). Overview is a single link;
  // the other sections fold. Every capability is a page, a tab, a view, an action, a field or a configuration: only pages are sidebar
  // entries. Everything else routed in the module is registered with `parent` (the page it belongs to): reachable, searchable and
  // breadcrumbed, never a sidebar entry of its own.
  {
    moduleKey: "crm",
    label: "CRM",
    icon: Users,
    requiredPermission: "crm.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        icon: LayoutDashboard,
        flat: true,
        items: [
          { ...available("Overview", "/crm"), aliases: ["crm home", "dashboard", "kpi", "metrics"] },
          { ...available("Dashboard", "/crm/dashboard"), parent: "overview" },
        ],
      },
      {
        id: "master-data",
        label: "Master Data",
        icon: Database,
        collapsible: true,
        items: [
          { ...available("Accounts", "/crm/accounts"), aliases: ["companies", "customers", "account 360"] },
          { ...available("Contacts", "/crm/contacts"), aliases: ["people", "contact persons"] },
          {
            ...available("Data Quality", "/crm/data-quality"),
            parent: "accounts",
            description: "Potential duplicate leads, contacts and accounts to review and merge.",
            aliases: ["duplicates", "merge", "potential duplicates"],
            requiredPermission: "crm.duplicates.review",
          },
        ],
      },
      {
        id: "operations",
        label: "Operations",
        icon: ArrowLeftRight,
        collapsible: true,
        items: [
          { ...available("Leads", "/crm/leads"), aliases: ["prospects", "enquiries", "lead conversion", "qualification"] },
          { ...available("Lead Dashboard", "/crm/leads/dashboard"), parent: "leads" },
          { ...available("Opportunities", "/crm/opportunities"), aliases: ["deals", "won", "lost", "win rate"] },
          { ...available("Opportunity Dashboard", "/crm/opportunities/dashboard"), parent: "opportunities", aliases: ["win rate", "won and lost"] },
          { ...available("Activities", "/crm/activities"), aliases: ["my work", "today", "tasks", "follow-ups", "calls", "meetings", "notes", "files", "inbox", "reminders"] },
          // The tabs of Activities and their records (/crm/tasks/<id>, /crm/calls/<id>, …); each list address opens its tab.
          { ...available("Tasks", "/crm/tasks"), parent: "activities", requiredPermission: "crm.tasks.view" },
          { ...available("Follow-ups", "/crm/follow-ups"), parent: "activities", requiredPermission: "crm.follow_ups.view" },
          { ...available("Calls", "/crm/calls"), parent: "activities" },
          { ...available("Meetings", "/crm/meetings"), parent: "activities" },
          { ...available("Notes & Files", "/crm/notes-files"), parent: "activities", aliases: ["attachments", "documents"] },
          { ...available("Inbox", "/crm/communications"), parent: "activities", aliases: ["communications", "email", "conversations"] },
          { ...available("My Work", "/crm/work"), parent: "activities" },
        ],
      },
      {
        id: "planning",
        label: "Planning & Control",
        icon: Gauge,
        collapsible: true,
        items: [
          { ...available("Pipeline", "/crm/pipeline"), aliases: ["board", "kanban", "deals by stage"] },
          {
            ...available("Forecast", "/crm/forecast"),
            parent: "pipeline",
            requiredAnyPermission: ["crm.forecast.submit", "crm.forecast.review", "crm.forecast.manage"],
          },
        ],
      },
      {
        id: "reports",
        label: "Reports",
        icon: BarChart3,
        collapsible: true,
        items: [
          { ...available("Leads by Status", "/crm/reports?report=leads"), aliases: ["lead report", "crm reports"] },
          { ...available("Opportunities by Stage", "/crm/reports?report=opportunities"), aliases: ["opportunity report", "pipeline report"] },
        ],
      },
      {
        id: "configuration",
        label: "Configuration",
        icon: Settings,
        collapsible: true,
        items: [
          {
            ...available("Lead Setup", "/crm/settings/leads"),
            aliases: ["crm settings", "setup", "configuration", "lead configuration"],
            requiredAnyPermission: ["crm.settings.manage", "crm.import"],
          },
          {
            ...available("Lead Stages & Statuses", "/crm/settings/leads/stages"),
            parent: "lead-setup",
            group: "lead-process",
            description: "The steps a lead moves through, and the four statuses it can end in.",
            aliases: ["lead stages", "lead pipeline", "lead process"],
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Qualification Criteria", "/crm/settings/leads/qualification"),
            parent: "lead-setup",
            group: "lead-process",
            description: "What must be known about a lead before it can be qualified.",
            aliases: ["qualification requirements", "bant", "lead qualification"],
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Lead Sources", "/crm/settings/leads/sources"),
            parent: "lead-setup",
            group: "lead-process",
            description: "Where leads come from, for routing and attribution.",
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Task Defaults", "/crm/settings/defaults/tasks"),
            parent: "lead-setup",
            group: "activity-defaults",
            description: "The priority and reminder a new task starts with.",
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Follow-up Defaults", "/crm/settings/defaults/follow-ups"),
            parent: "lead-setup",
            group: "activity-defaults",
            description: "The type and reminder a new follow-up starts with.",
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Imports & Exports", "/crm/data/import-export"),
            parent: "lead-setup",
            group: "data-management",
            description: "Import leads from a file and export CRM data.",
            aliases: ["import", "export", "csv"],
          },
          {
            ...available("Opportunity Setup", "/crm/settings/opportunities"),
            aliases: ["pipeline setup", "sales stages", "opportunity configuration"],
            requiredAnyPermission: ["crm.settings.manage", "crm.opportunities.manage_close_reasons"],
          },
          {
            ...available("Sales Stages", "/crm/settings/opportunities/stages"),
            parent: "opportunity-setup",
            description: "The stages of the pipeline and their default probabilities.",
            aliases: ["pipeline stages", "probability"],
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Won / Lost Reasons", "/crm/settings/opportunities/close-reasons"),
            parent: "opportunity-setup",
            description: "The reasons a deal can be won or lost.",
            aliases: ["outcome reasons", "close reasons", "lost reasons", "won reasons"],
            requiredPermission: "crm.opportunities.manage_close_reasons",
          },
          {
            ...available("Assignment Rules", "/crm/settings/leads/assignment"),
            aliases: ["routing", "round robin", "lead assignment"],
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Duplicate Detection", "/crm/settings/data-quality"),
            aliases: ["duplicate rules", "matching rules"],
            requiredPermission: "crm.settings.manage",
          },
        ],
      },
    ],
    groups: [
      {
        id: "lead-process",
        workspace: "lead-setup",
        label: "Lead Process",
        description: "Lead stages and statuses, qualification and sources.",
        icon: UserSearch,
      },
      {
        id: "activity-defaults",
        workspace: "lead-setup",
        label: "Activity Defaults",
        description: "What a new task or follow-up starts with.",
        icon: CalendarClock,
      },
      {
        id: "data-management",
        workspace: "lead-setup",
        label: "Data Management",
        description: "Bring leads in from a file and take CRM data out.",
        icon: SlidersHorizontal,
      },
    ],
  },
  {
    moduleKey: "sales",
    label: "Sales",
    icon: ShoppingCart,
    requiredPermission: "sales.view",
    // Addresses and contacts live on the customer; confirmation, availability, reservation, partial delivery, partial invoicing and order
    // tracking on the sales order; shipment on the delivery; discounts and taxes on each document.
    sections: [
      {
        id: "overview",
        label: "Overview",
        icon: LayoutDashboard,
        flat: true,
        items: [{ ...available("Overview", "/sales"), aliases: ["sales home", "sales dashboard"] }],
      },
      {
        id: "master-data",
        label: "Master Data",
        icon: Database,
        collapsible: true,
        featureRange: "F031-F034",
        items: [
          { ...available("Customers", "/sales/customers"), aliases: ["customer master", "addresses", "contacts", "customer 360", "import customers"] },
          { ...available("Products & Services", "/sales/products"), aliases: ["catalog", "items", "services", "sku", "hsn", "sac"] },
          { ...available("Price Lists", "/sales/price-lists"), aliases: ["prices", "default price list"] },
        ],
      },
      {
        id: "operations",
        label: "Operations",
        icon: ArrowLeftRight,
        collapsible: true,
        featureRange: "F035-F058",
        items: [
          { ...available("Quotations", "/sales/quotations"), aliases: ["quotes", "estimates", "revisions"] },
          {
            ...available("Sales Orders", "/sales/orders"),
            aliases: ["orders", "order tracking", "order confirmation", "availability", "stock reservation", "partial delivery", "partial invoicing", "customer po"],
          },
          { ...available("Deliveries", "/sales/deliveries"), aliases: ["shipment", "delivery note", "dispatch", "tracking number", "carrier", "proof of delivery"] },
          { ...available("Sales Invoices", "/sales/invoices"), aliases: ["invoices", "billing", "balance due", "overdue invoices"] },
          { ...available("Sales Returns", "/sales/returns"), aliases: ["returns", "return note", "rma"] },
          { ...available("Credit Notes", "/sales/credit-notes"), aliases: ["credits", "price adjustment"] },
          // The customer refunds Finance owns, the same records as Finance → Customer Refunds.
          { ...available("Refunds", "/sales/refunds"), aliases: ["customer refunds", "refund credit"], requiredPermission: "accounting.refund.view" },
        ],
      },
      {
        id: "planning",
        label: "Planning & Control",
        icon: Gauge,
        collapsible: true,
        items: [
          {
            ...available("Order Fulfillment", "/sales/fulfillment"),
            aliases: ["remaining by order", "remaining by product", "delivery performance", "billing readiness", "backorders"],
            requiredPermission: "sales.reports.view",
          },
        ],
      },
      {
        id: "inquiries",
        label: "Inquiries",
        icon: Search,
        collapsible: true,
        items: [
          { ...available("Order Status", "/sales/order-status"), aliases: ["where is my order", "order inquiry"], requiredPermission: "sales.reports.view" },
        ],
      },
      {
        id: "reports",
        label: "Reports",
        icon: BarChart3,
        collapsible: true,
        featureRange: "F059-F062",
        items: [
          { ...available("Sales by Period", "/sales/reports?report=sales-by-period"), aliases: ["sales reports", "monthly sales", "revenue"], requiredPermission: "sales.reports.view" },
          { ...available("Sales by Customer", "/sales/reports?report=sales-by-customer"), aliases: ["top customers"], requiredPermission: "sales.reports.view" },
          { ...available("Sales by Item", "/sales/reports?report=sales-by-item"), aliases: ["top products", "product sales"], requiredPermission: "sales.reports.view" },
          {
            ...available("Sales Order Status", "/sales/reports?report=order-status"),
            aliases: ["pending approvals", "expiring quotations"],
            requiredPermission: "sales.reports.view",
          },
        ],
      },
      {
        id: "configuration",
        label: "Configuration",
        icon: Settings,
        collapsible: true,
        items: [
          { ...available("Sales Setup", "/sales/settings"), aliases: ["sales settings", "setup", "configuration"] },
          // ---- Commercial
          {
            ...available("Quotation & Order Rules", "/sales/settings/quotations-orders"),
            parent: "sales-setup",
            group: "commercial",
            description: "Quotation approval and validity, standard terms, and what an order needs before it is confirmed.",
            aliases: ["quotation approval", "quotation validity", "direct orders", "customer po required"],
          },
          // ---- Fulfillment
          {
            ...available("Fulfillment Settings", "/sales/settings/fulfillment"),
            parent: "sales-setup",
            group: "fulfillment",
            description: "Invoice based on order or delivery, availability and reservation on confirmation, default warehouse, delivery note.",
            aliases: ["invoice based on", "invoicing basis", "auto reserve", "default warehouse", "delivery note prices"],
          },
          {
            ...available("Discounts", "/sales/settings/discounts"),
            aliases: ["discount controls", "discount limits", "maximum discount"],
          },
          {
            ...available("Payment Terms", "/sales/settings/payment-terms"),
            aliases: ["credit terms", "net 30", "due date"],
          },
        ],
      },
    ],
    groups: [
      {
        id: "commercial",
        workspace: "sales-setup",
        label: "Commercial",
        description: "The rules for quotations and orders.",
        icon: Store,
      },
      {
        id: "fulfillment",
        workspace: "sales-setup",
        label: "Fulfillment",
        description: "How orders are reserved, delivered and invoiced.",
        icon: Truck,
      },
    ],
  },
  {
    moduleKey: "procurement",
    label: "Procurement",
    icon: Truck,
    requiredPermission: "procurement.view",
    // Partial receipts, rejections, partial billing, matching, direct bills and payment schedules live inside their documents (tabs and
    // contextual actions); the cross-document views are Receiving Exceptions and Invoice Matching.
    sections: [
      {
        id: "overview",
        label: "Overview",
        icon: LayoutDashboard,
        flat: true,
        items: [{ ...available("Overview", "/procurement"), aliases: ["procurement home", "procurement dashboard", "requires attention"] }],
      },
      {
        id: "master-data",
        label: "Master Data",
        icon: Database,
        collapsible: true,
        items: [
          { ...available("Suppliers", "/procurement/suppliers"), aliases: ["supplier master", "vendors", "vendor", "supplier import", "gstin", "supplier contacts", "supplier addresses"],
            requiredAnyPermission: ["procurement.suppliers.view", "procurement.suppliers.view_all"] },
        ],
      },
      {
        id: "operations",
        label: "Operations",
        icon: ArrowLeftRight,
        collapsible: true,
        items: [
          { ...available("Purchase Orders", "/procurement/purchase-orders"), aliases: ["po", "purchase order", "buy", "partial receipts", "partial billing"],
            requiredAnyPermission: ["procurement.po.view", "procurement.po.view_all"] },
          { ...available("Supplier Quotations", "/procurement/purchase-orders/quotations"), parent: "purchase-orders", aliases: ["quotation", "supplier quote", "rfq response"],
            description: "Supplier quotations an order can be created from.", requiredAnyPermission: ["procurement.po.view", "procurement.po.view_all"] },
          { ...available("Goods Receipts", "/procurement/goods-receipts"), aliases: ["grn", "goods received", "rejected receipts", "dock refusal"],
            requiredAnyPermission: ["procurement.po.view", "procurement.po.view_all"] },
          { ...available("Supplier Bills", "/procurement/supplier-bills"), aliases: ["supplier invoice", "vendor bill", "purchase invoice", "direct bill", "payment schedule"],
            requiredAnyPermission: ["procurement.bills.view", "accounting.payables.manage"] },
          { ...available("Payment Obligations & AP Aging", "/procurement/reports/payment-obligations"), parent: "supplier-bills", aliases: ["payment obligations", "due payments", "msme payments", "ap aging"],
            description: "Overdue and upcoming instalments, AP aging and statutory deadlines.", requiredAnyPermission: ["procurement.bills.view", "accounting.payables.manage"] },
          { ...available("Purchase Returns", "/procurement/purchase-returns"), aliases: ["return to supplier", "rtv", "replacement"],
            requiredAnyPermission: ["procurement.returns.view", "procurement.po.view", "procurement.po.view_all"] },
          { ...available("Supplier Credits / Debit Notes", "/procurement/debit-notes-credits"),
            aliases: ["debit note", "debit claim", "vendor credit", "supplier credit", "supplier credit note", "supplier refund"],
            requiredAnyPermission: ["procurement.claims.view", "procurement.claims.manage", "procurement.credits.manage", "procurement.bills.view", "accounting.payables.manage"] },
        ],
      },
      {
        id: "planning",
        label: "Planning & Control",
        icon: Gauge,
        collapsible: true,
        items: [
          { ...available("Receiving Exceptions", "/procurement/receiving-issues"), aliases: ["receiving issues", "refused goods", "quarantine", "shortage", "discrepancies", "wrong delivery"],
            description: "Dock refusals, shortages, wrong deliveries and post-receipt rejections.", requiredAnyPermission: ["procurement.rejections.view", "procurement.rejections.view_all"] },
          { ...available("Invoice Matching", "/procurement/invoice-matching"), aliases: ["2-way matching", "3-way matching", "matching exceptions", "price variance", "quantity variance"],
            requiredAnyPermission: ["procurement.bills.view", "accounting.payables.manage"] },
        ],
      },
      {
        id: "inquiries",
        label: "Inquiries",
        icon: Search,
        collapsible: true,
        items: [
          { ...available("Purchase Status", "/procurement/purchase-status"), aliases: ["purchase order progress", "open orders", "what is outstanding"] },
        ],
      },
      {
        id: "reports",
        label: "Reports",
        icon: BarChart3,
        collapsible: true,
        items: [
          { ...available("Purchases by Period", "/procurement/reports/purchases-by-period"), aliases: ["monthly purchases", "spend"],
            requiredAnyPermission: ["procurement.bills.view", "accounting.payables.manage"] },
          { ...available("Purchases by Supplier", "/procurement/reports/purchases-by-supplier"), aliases: ["supplier spend", "top suppliers"],
            requiredAnyPermission: ["procurement.bills.view", "accounting.payables.manage"] },
          { ...available("Purchases by Item", "/procurement/reports/purchases-by-item"), aliases: ["item spend"],
            requiredAnyPermission: ["procurement.bills.view", "accounting.payables.manage"] },
          // The report catalogue and its other reports (pending receipts, discrepancies, bills due, return summary, vendor credit balances).
          { ...available("All Procurement Reports", "/procurement/reports"), parent: "purchases-by-period",
            aliases: ["procurement reports", "overdue bills", "vendor credit balances", "unbilled receipts", "pending goods receipts"] },
        ],
      },
      {
        id: "configuration",
        label: "Configuration",
        icon: Settings,
        collapsible: true,
        items: [
          { ...available("Procurement Setup", "/procurement/settings"), aliases: ["procurement settings", "procurement configuration", "matching rules", "receiving rules"] },
          { ...available("Supplier Categories", "/procurement/settings/categories"), parent: "procurement-setup", description: "Categories suppliers are grouped by." },
          { ...available("Payment Terms", "/procurement/settings/payment-terms"), aliases: ["credit terms", "supplier payment terms"] },
        ],
      },
    ],
  },
  {
    // Views (Available, Reserved, Restricted, Negative), item identity (SKU, units, tracking), batch and serial drill-downs are tabs,
    // filters and detail pages inside these pages — never sidebar entries of their own.
    moduleKey: "stock",
    label: "Inventory",
    icon: Boxes,
    requiredPermission: "stock.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        icon: LayoutDashboard,
        flat: true,
        items: [{ ...available("Overview", "/inventory"), aliases: ["inventory home", "needs attention", "inventory search"] }],
      },
      {
        id: "master-data",
        label: "Master Data",
        icon: Database,
        collapsible: true,
        featureRange: "F097-F102, F109-F111",
        items: [
          { ...available("Items", "/inventory/items"), requiredPermission: "products.view", aliases: ["item master", "products", "sku", "barcode", "variants", "unit conversions", "multiple uom"] },
          { ...available("Item Categories", "/inventory/item-categories"), requiredPermission: "products.view", aliases: ["categories", "item groups", "category tree"] },
          { ...available("Warehouses", "/inventory/warehouses"), requiredPermission: "warehouses.view", aliases: ["locations", "bins", "warehouse locations"] },
          { ...available("Units of Measure", "/inventory/units-of-measure"), aliases: ["uom", "units", "uom conversions"] },
        ],
      },
      {
        id: "operations",
        label: "Operations",
        icon: ArrowLeftRight,
        collapsible: true,
        featureRange: "F112-F128",
        items: [
          // The one Goods Receipt is Procurement's: this entry opens the same list; each receipt is /procurement/goods-receipts/<id>.
          { ...available("Goods Receipts", "/inventory/goods-receipts"), requiredAnyPermission: ["procurement.po.view", "procurement.po.view_all"], aliases: ["grn", "receive goods"] },
          { ...available("Goods Issues", "/inventory/goods-issues"), requiredPermission: "stock.goods_issue.view", aliases: ["goods issue", "issue stock", "consumption", "scrap", "disposal", "samples", "maintenance issue"] },
          { ...available("Internal Transfers", "/inventory/transfers"), requiredPermission: "stock.transfers.view", aliases: ["transfers", "warehouse transfer", "location transfer", "in transit"] },
          { ...available("Inventory Journals", "/inventory/journals"), requiredAnyPermission: ["stock.adjustments.view", "stock.opening.view"], aliases: ["journals", "write off", "found stock"] },
          { ...available("Stock Adjustments", "/inventory/adjustments"), parent: "inventory-journals", requiredPermission: "stock.adjustments.view", aliases: ["adjustments", "adjustment"] },
          { ...available("Opening Stock", "/inventory/opening-stock"), parent: "inventory-journals", requiredPermission: "stock.opening.view", aliases: ["opening balance", "stock migration", "go live"] },
          { ...available("Stock Counts", "/inventory/stock-counts"), requiredPermission: "stock.counts.view", badge: "stockCounts", aliases: ["physical inventory", "stocktake", "cycle count", "count sheet"] },
          { ...available("Quality Holds", "/inventory/quality-holds"), requiredPermission: "stock.holds.view", badge: "qualityHolds", aliases: ["quarantine", "quality hold", "held stock", "inspection hold", "damaged stock"] },
        ],
      },
      {
        id: "planning",
        label: "Planning & Control",
        icon: Gauge,
        collapsible: true,
        items: [
          { ...available("Reservations", "/inventory/reservations"), requiredPermission: "stock.reservations.view", aliases: ["stock reservations", "allocations"] },
          {
            ...available("Replenishment", "/inventory/replenishment"),
            requiredAnyPermission: ["stock.reorder.view", "stock.alerts.view"],
            badge: "replenishment",
            aliases: ["reorder required", "requirements", "covered by incoming", "low stock alerts", "out of stock", "reorder level", "reorder point", "min max", "reorder rules"],
          },
        ],
      },
      {
        id: "inquiries",
        label: "Inquiries",
        icon: Search,
        collapsible: true,
        featureRange: "F103-F108",
        items: [
          { ...available("On-Hand Inventory", "/inventory/stock"), badge: "stock",
            aliases: ["stock overview", "stock balance", "available stock", "reserved stock", "restricted stock", "in transit", "negative stock", "by batch"] },
          { ...available("Negative Stock", "/inventory/negative-stock"), parent: "on-hand-inventory", aliases: ["negative stock exceptions", "overrides", "negative balance"] },
          { ...available("Inventory Transactions", "/inventory/transactions"), requiredPermission: "stock.ledger.view",
            aliases: ["movement history", "stock ledger", "ledger entries", "movements", "stock history", "serial journey", "batch history", "traceability"] },
          { ...available("Movement History", "/inventory/movements"), parent: "inventory-transactions", requiredPermission: "stock.ledger.view" },
          { ...available("Stock Ledger", "/inventory/stock-ledger"), parent: "inventory-transactions", requiredPermission: "stock.ledger.view", aliases: ["ledger", "reconciliation"] },
          { ...available("Inventory Valuation", "/inventory/valuation"), requiredPermission: "stock.valuation.view", aliases: ["valuation", "fifo layers", "stock value", "cogs"] },
        ],
      },
      {
        id: "reports",
        label: "Reports",
        icon: BarChart3,
        collapsible: true,
        items: [
          { ...available("Stock Balance", "/inventory/reports?report=stock-balance"), aliases: ["inventory reports", "stock as of", "closing stock"] },
          { ...available("Stock Valuation", "/inventory/reports?report=stock-valuation"), requiredPermission: "stock.valuation.view", aliases: ["valuation report", "stock value as of"] },
          { ...available("Stock Movement", "/inventory/reports?report=stock-movement"), requiredPermission: "stock.ledger.view", aliases: ["movement report", "opening in out closing"] },
        ],
      },
      {
        id: "configuration",
        label: "Configuration",
        icon: Settings,
        collapsible: true,
        items: [
          { ...available("Inventory Policies", "/inventory/settings?section=policies"), aliases: ["inventory settings", "negative stock policy", "allow negative stock"] },
          { ...available("Valuation Setup", "/inventory/settings?section=valuation"), aliases: ["valuation defaults", "costing method", "fifo", "moving average", "adjustment threshold"] },
          { ...available("Reason Codes", "/inventory/settings?section=reasons"), aliases: ["goods issue reasons", "hold reasons", "quarantine reasons", "adjustment reasons"] },
          { ...available("Item Numbering", "/inventory/settings?section=item-numbering"), parent: "inventory-policies", aliases: ["sku numbering", "sku prefix", "item codes"] },
        ],
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
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F152-F157",
        items: [
          available(
            "Material Availability",
            "/manufacturing/material-planning",
          ),
        ],
      },
      {
        id: "production",
        label: "Production",
        featureRange: "F158-F165",
        items: [
          available("Production Orders", "/manufacturing/production-orders"),
        ],
      },
      {
        id: "materials",
        label: "Materials",
        featureRange: "F166-F170",
        items: [
          available("Reservations", "/manufacturing/reservations"),
          available("Consumption", "/manufacturing/consumption"),
        ],
      },
      {
        id: "output",
        label: "Output",
        featureRange: "F171-F175",
        items: [
          available("Finished Output", "/manufacturing/finished-output"),
          available("Scrap", "/manufacturing/scrap"),
        ],
      },
      {
        id: "quality",
        label: "Quality",
        featureRange: "F176-F177",
        items: [available("Inspections", "/manufacturing/inspections")],
      },
      {
        id: "resources",
        label: "Resources",
        featureRange: "F178-F181",
        items: [available("Settings", "/manufacturing/settings")],
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
        items: [available("All Projects", "/projects/all")],
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
        id: "team",
        label: "Team",
        items: [available("Project Team", "/projects/team")],
      },
      {
        id: "time",
        label: "Time",
        featureRange: "F209-F210",
        items: [
          available("Time Entries", "/projects/time"),
          available("Timesheets", "/projects/timesheets"),
        ],
      },
      {
        id: "setup",
        label: "Setup",
        items: [available("Settings", "/projects/settings")],
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
        items: [available("Depreciation", "/assets/depreciation")],
      },
      {
        id: "maintenance",
        label: "Maintenance",
        featureRange: "F246-F250",
        items: [
          available("Maintenance Plans", "/assets/maintenance-plans"),
          available("Work Orders", "/assets/work-orders"),
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
        id: "setup",
        label: "Setup",
        items: [
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
      // surface — "Open POS" is deliberately not a normal
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
        featureRange: "F291-F292",
        items: [available("Returns", "/pos/returns")],
      },
      {
        id: "inventory",
        label: "Inventory",
        featureRange: "F291-F294",
        items: [
          // F294/F295/F296: one consolidated read-only workspace (store
          // availability + lot/batch + real-time stock-sync activity) --
          // a single coherent inventory-visibility capability, not two
          // destinations.
          available("POS Inventory", "/pos/inventory"),
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
        items: [available("Quality Plans", "/quality/plans")],
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
          available("Quality Holds", "/inventory/quality-holds"),
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
          available("Categories", "/support/categories"),
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
        ],
      },
      {
        id: "joining",
        label: "Joining",
        items: [available("Onboarding", "/hr/onboarding")],
      },
      {
        id: "time",
        label: "Time",
        featureRange: "F399-F404",
        items: [
          available("Attendance", "/hr/attendance"),
          available("My Attendance", "/hr/my-attendance"),
          available("Shifts", "/hr/shifts"),
          available("Shift Assignments", "/hr/shift-assignments"),
          available("Holiday Calendars", "/hr/holiday-calendars"),
          available("Holidays", "/hr/holidays"),
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
          available("Payslips", "/hr/payslips"),
          available("My Payslips", "/hr/my-payslips"),
        ],
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
          available("Close Checklist", "/accounting/close-checklist"),
        ],
      },
      {
        id: "receivables",
        label: "Receivables",
        featureRange: "F459-F464",
        items: [
          available("Customer Invoices", "/accounting/customer-invoices"),
          available("Receipts", "/accounting/receipts"),
          available("Customer Refunds", "/accounting/customer-refunds"),
        ],
      },
      {
        id: "payables",
        label: "Payables",
        featureRange: "F465-F470",
        items: [
          available("Supplier Invoices", "/accounting/supplier-invoices"),
          available("Payments", "/accounting/payments"),
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
        id: "reports",
        label: "Reports",
        featureRange: "F498-F505",
        items: [
          available("Trial Balance", "/accounting/trial-balance"),
          available("Profit & Loss", "/accounting/profit-loss"),
          available("Balance Sheet", "/accounting/balance-sheet"),
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
