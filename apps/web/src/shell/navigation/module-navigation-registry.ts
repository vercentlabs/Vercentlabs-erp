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
  // CRM is organised by the salesperson's job rather than the ERP's shape: Today (what to do next), Sell (leads, deals, the pipeline),
  // Customers (companies and contacts), Insights (dashboards and reports), Manage (data quality and imports) and Setup (one page, in the
  // order a company sets itself up). One word per thing: Deal, not Opportunity; Company, not Account; To-dos for the tasks page. Addresses
  // keep their original paths, and the old words stay as search aliases.
  {
    moduleKey: "crm",
    label: "CRM",
    icon: Users,
    requiredPermission: "crm.view",
    sections: [
      {
        id: "today",
        label: "Today",
        icon: LayoutDashboard,
        collapsible: true,
        items: [
          { ...available("Home", "/crm"), aliases: ["crm home", "overview", "dashboard", "agenda", "what to do next"], requiredPermission: "crm.view" },
          { ...available("To-dos", "/crm/activities"), aliases: ["to-do", "todos", "activities", "tasks", "follow-ups", "reminders"], requiredAnyPermission: ["crm.tasks.view", "crm.follow_ups.view", "crm.notes.view", "crm.attachments.view"] },
          { ...available("Tasks", "/crm/activities?tab=tasks"), parent: "to-dos", requiredPermission: "crm.tasks.view" },
          { ...available("Follow-ups", "/crm/activities?tab=follow-ups"), parent: "to-dos", requiredPermission: "crm.follow_ups.view" },
          { ...available("Notes", "/crm/activities?tab=notes"), parent: "to-dos", aliases: ["notes & files"], requiredPermission: "crm.notes.view" },
          { ...available("Files", "/crm/activities?tab=files"), parent: "to-dos", aliases: ["attachments", "documents"], requiredPermission: "crm.attachments.view" },
        ],
      },
      {
        id: "sell",
        label: "Sell",
        icon: ArrowLeftRight,
        collapsible: true,
        items: [
          { ...available("Leads", "/crm/leads"), aliases: ["prospects", "enquiries", "lead conversion", "qualification"], requiredPermission: "crm.leads.view" },
          { ...available("Deals", "/crm/opportunities"), aliases: ["deal", "opportunities", "opportunity", "won", "lost", "win rate"], requiredPermission: "crm.opportunities.view" },
          { ...available("Pipeline", "/crm/pipeline"), aliases: ["board", "kanban", "deals by stage"], requiredPermission: "crm.opportunities.view" },
        ],
      },
      {
        id: "customers",
        label: "Customers",
        icon: Database,
        collapsible: true,
        items: [
          { ...available("Companies", "/crm/accounts"), aliases: ["company", "accounts", "account", "customers", "account 360", "customer 360"], requiredPermission: "crm.accounts.view" },
          { ...available("Contacts", "/crm/contacts"), aliases: ["people", "contact persons"], requiredPermission: "crm.contacts.view" },
        ],
      },
      {
        id: "insights",
        label: "Insights",
        icon: BarChart3,
        collapsible: true,
        items: [
          { ...available("Lead dashboard", "/crm/leads/dashboard"), aliases: ["lead funnel", "lead metrics"], requiredPermission: "crm.leads.view" },
          { ...available("Deal dashboard", "/crm/opportunities/dashboard"), aliases: ["opportunity dashboard", "win rate", "won and lost"], requiredPermission: "crm.opportunities.view" },
          { ...available("Reports", "/crm/reports"), aliases: ["crm reports", "leads by status", "deals by stage", "opportunities by stage", "companies report", "account report"], requiredPermission: "crm.reports.view" },
        ],
      },
      {
        id: "manage",
        label: "Manage",
        icon: Gauge,
        collapsible: true,
        items: [
          {
            ...available("Data quality", "/crm/data-quality"),
            description: "Potential duplicate leads, contacts and companies to review and merge.",
            aliases: ["duplicates", "merge", "potential duplicates"],
            requiredPermission: "crm.duplicates.review",
          },
          {
            ...available("Import data", "/crm/data/import-export"),
            description: "Bring leads, companies and contacts in from a file.",
            aliases: ["import", "imports & exports", "csv", "upload leads"],
            requiredAnyPermission: ["crm.import", "crm.accounts.import", "crm.contacts.import"],
          },
        ],
      },
      {
        id: "setup",
        label: "Setup",
        icon: Settings,
        flat: true,
        items: [
          {
            ...available("Setup", "/crm/settings"),
            aliases: ["crm settings", "configuration", "lead setup", "opportunity setup", "deal setup"],
            requiredAnyPermission: ["crm.settings.manage", "crm.opportunities.manage_close_reasons"],
          },
          { ...available("Lead stages", "/crm/settings/leads/stages"), parent: "setup", aliases: ["lead stages & statuses", "lead process"], requiredPermission: "crm.settings.manage" },
          { ...available("Lead sources", "/crm/settings/leads/sources"), parent: "setup", requiredPermission: "crm.settings.manage" },
          { ...available("Qualification", "/crm/settings/leads/qualification"), parent: "setup", aliases: ["qualification criteria", "bant"], requiredPermission: "crm.settings.manage" },
          { ...available("Assignment", "/crm/settings/leads/assignment"), parent: "setup", aliases: ["assignment rules", "routing", "round robin"], requiredPermission: "crm.settings.manage" },
          { ...available("Deal stages", "/crm/settings/opportunities/stages"), parent: "setup", aliases: ["sales stages", "pipeline stages", "probability"], requiredPermission: "crm.settings.manage" },
          {
            ...available("Won and lost reasons", "/crm/settings/opportunities/close-reasons"), parent: "setup",
            aliases: ["close reasons", "won / lost reasons", "lost reasons", "won reasons"], requiredPermission: "crm.opportunities.manage_close_reasons",
          },
          { ...available("Task defaults", "/crm/settings/defaults/tasks"), parent: "setup", requiredPermission: "crm.settings.manage" },
          { ...available("Follow-up defaults", "/crm/settings/defaults/follow-ups"), parent: "setup", requiredPermission: "crm.settings.manage" },
          { ...available("Lead Setup", "/crm/settings/leads"), parent: "setup", requiredAnyPermission: ["crm.settings.manage", "crm.import"] },
          { ...available("Deal Setup", "/crm/settings/opportunities"), parent: "setup", requiredAnyPermission: ["crm.settings.manage", "crm.opportunities.manage_close_reasons"] },
        ],
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
          { ...available("Material Demand", "/procurement/material-demand"), aliases: ["manufacturing shortages", "material shortage", "bom shortage"],
            requiredAnyPermission: ["procurement.requisition.manage", "procurement.po.create", "procurement.po.manage", "procurement.view"] },
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
        icon: LayoutDashboard,
        flat: true,
        items: [{ ...available("Overview", "/manufacturing"), aliases: ["manufacturing home", "production dashboard"] }],
      },
      {
        id: "master-data",
        label: "Master Data",
        icon: Database,
        collapsible: true,
        featureRange: "F145-F151",
        items: [
          { ...available("Bills of Materials", "/manufacturing/boms"), aliases: ["bom", "boms", "recipe", "bill of materials", "bom revision", "where used", "compare revisions", "revision impact"], requiredPermission: "manufacturing.bom.view" },
          { ...available("Pending BOM Approvals", "/manufacturing/boms/approvals"), aliases: ["bom approval", "approve bom", "revision approval"], requiredPermission: "manufacturing.bom.view" },
          { ...available("Inspection Checklists", "/manufacturing/quality-checklists"), aliases: ["quality checklist", "inspection template", "tolerances", "critical checks", "qc checklist"], requiredPermission: "manufacturing.qi.view" },
        ],
      },
      {
        id: "operations",
        label: "Operations",
        icon: ArrowLeftRight,
        collapsible: true,
        featureRange: "F158-F177",
        items: [
          {
            ...available("Manufacturing Orders", "/manufacturing/orders"),
            aliases: ["mo", "production orders", "work orders", "issue materials", "material issue", "record production", "finished goods receipt", "quality decision", "scrap", "reserve materials"],
            requiredPermission: "manufacturing.mo.view",
          },
          { ...available("Variance Exceptions", "/manufacturing/material-variances"), aliases: ["material variance", "usage variance", "excess consumption", "consumption variance", "variance approval", "mvx"], requiredPermission: "manufacturing.variance.view" },
          { ...available("Production Holds", "/manufacturing/production-holds"), aliases: ["on hold", "held orders", "production hold", "stop production", "resume production", "downtime", "mph"], requiredPermission: "manufacturing.hold.view" },
          { ...available("Production Inspections", "/manufacturing/quality-inspections"), aliases: ["quality inspection", "final inspection", "inspection queue", "qc", "accept output", "reject output", "quality hold", "reinspection", "mqi"], requiredPermission: "manufacturing.qi.view" },
        ],
      },
      {
        id: "planning",
        label: "Planning & Control",
        icon: Gauge,
        collapsible: true,
        featureRange: "F152-F157",
        items: [
          { ...available("Sales Demand", "/manufacturing/sales-demand"), aliases: ["make to order", "customer demand", "sales order production", "mto", "demand coverage"], requiredPermission: "manufacturing.demand.view" },
          { ...available("Material Shortages", "/manufacturing/material-shortages"), aliases: ["material availability", "shortage list", "feasible output", "material readiness", "can we make it"], requiredPermission: "manufacturing.material.view" },
          { ...available("Material Demand", "/manufacturing/material-demands"), aliases: ["procurement handoff", "material shortage"] },
        ],
      },
      {
        id: "inquiries",
        label: "Inquiries",
        icon: Search,
        collapsible: true,
        items: [
          { ...available("Scrap", "/manufacturing/scrap"), aliases: ["scrap", "material scrap", "rejected output", "scrap disposition", "recoverable scrap", "wastage", "ms"], requiredPermission: "manufacturing.scrap.view" },
          { ...available("Finished-Goods Receipts", "/manufacturing/finished-goods-receipts"), aliases: ["finished goods receipt", "fgr", "receive finished goods", "receive production", "output into stock", "production receipt"], requiredPermission: "manufacturing.fgr.view" },
          { ...available("Production Entries", "/manufacturing/production-entries"), aliases: ["production entry", "output reported", "partial production", "production batch", "record production", "mpe"], requiredPermission: "manufacturing.mo.view" },
          { ...available("Material Consumption", "/manufacturing/material-consumptions"), aliases: ["material consumption", "consumption note", "record usage", "mc", "actual usage", "material used"], requiredPermission: "manufacturing.consumption.view" },
          { ...available("Material Issues", "/manufacturing/material-issues"), aliases: ["material issue", "issue note", "issue to production", "mi", "storekeeper issue", "issue materials"], requiredPermission: "manufacturing.issue.view" },
          { ...available("Production Activity", "/manufacturing/activity"), aliases: ["material issues", "material returns", "production entries", "receipts", "consumption"], requiredPermission: "manufacturing.mo.view" },
        ],
      },
      {
        id: "reports",
        label: "Reports",
        icon: BarChart3,
        collapsible: true,
        featureRange: "F182-F186",
        items: [
          { ...available("Production Summary", "/manufacturing/reports?report=summary"), aliases: ["production report", "yield", "output report"], requiredPermission: "manufacturing.mo.view" },
          { ...available("Cost Variance", "/manufacturing/reports?report=variance"), aliases: ["manufacturing variance", "production cost", "material variance"], requiredPermission: "manufacturing.mo.cost_view" },
          { ...available("Material Availability", "/manufacturing/material-reports?report=readiness"), aliases: ["order readiness", "material coverage", "reservation coverage", "issued vs required", "shortage aging", "incoming supply"], requiredPermission: "manufacturing.material.view" },
          { ...available("Production Costing Reports", "/manufacturing/production-costing-reports?report=exceptions"), aliases: ["production cost", "wip report", "unit cost", "cost per unit", "costing exceptions", "wip reconciliation", "planned vs actual cost", "overhead report", "overhead by category", "actual vs applied overhead"], requiredAnyPermission: ["manufacturing.cost.view", "manufacturing.mo.cost_view"] },
          { ...available("Material Usage Variance", "/manufacturing/material-variance-reports?report=by-mo"), aliases: ["usage variance report", "material efficiency", "bom review candidates", "favorable unfavorable", "scrap vs consumption"], requiredPermission: "manufacturing.variance.view" },
          { ...available("Production Hold Reports", "/manufacturing/production-hold-reports?report=active"), aliases: ["production downtime", "hold aging", "holds by reason", "delivery risk", "hold audit"], requiredPermission: "manufacturing.hold.view" },
          { ...available("Quality Reports", "/manufacturing/quality-reports?report=by-mo"), aliases: ["rejection rate", "acceptance rate", "defects by reason", "failed measurements", "inspection turnaround", "inspector activity", "quality holds report"], requiredPermission: "manufacturing.qi.view" },
          { ...available("Scrap Reports", "/manufacturing/scrap-reports?report=by-mo"), aliases: ["scrap summary", "scrap cost", "planned vs actual scrap", "scrap rate", "rejection rate", "abnormal loss"], requiredPermission: "manufacturing.scrap.view" },
          { ...available("Finished-Goods Receipt Reports", "/manufacturing/finished-goods-receipt-reports?report=exceptions"), aliases: ["accepted not received", "receipt exceptions", "lot traceability", "serial traceability", "receipt reversals", "partial receipts"], requiredPermission: "manufacturing.fgr.view" },
          { ...available("Production Progress", "/manufacturing/production-progress?report=summary"), aliases: ["production batches", "accepted not received", "yield", "short close", "overproduction", "wip summary", "partial production cost"], requiredPermission: "manufacturing.mo.view" },
          { ...available("Material Consumption Reports", "/manufacturing/material-consumption-reports?report=by-date"), aliases: ["usage variance", "planned vs actual", "actual material cost", "material reconciliation", "wip reconciliation"], requiredPermission: "manufacturing.consumption.view" },
          { ...available("Material Issue Reports", "/manufacturing/material-issue-reports?report=by-date"), aliases: ["issued vs consumed", "batch traceability", "serial traceability", "material custody", "issue approvals", "posting exceptions"], requiredPermission: "manufacturing.issue.view" },
          { ...available("Demand Coverage", "/manufacturing/demand-reports?report=traceability"), aliases: ["sales to mo traceability", "delivery risk", "excess production", "production by customer"], requiredPermission: "manufacturing.demand.view" },
        ],
      },
      {
        id: "configuration",
        label: "Configuration",
        icon: Settings,
        collapsible: true,
        items: [
          { ...available("Production Costing", "/manufacturing/production-costing"), aliases: ["labor rate", "overhead rate", "cost rates", "applied overhead", "production cost setup", "overhead categories", "cost pool", "overhead reconciliation", "rate approval", "factory overhead"], requiredAnyPermission: ["manufacturing.cost.view", "manufacturing.mo.cost_view"] },
          { ...available("Variance Tolerances", "/manufacturing/material-variance-tolerances"), aliases: ["material tolerance", "critical material", "variance threshold"], requiredPermission: "manufacturing.variance.view" },
          { ...available("Manufacturing Setup", "/manufacturing/settings"), aliases: ["manufacturing settings", "overproduction tolerance", "inspection required", "self approval"] },
        ],
      },
    ],
  },
  // Projects: ten destinations in five groups (Workspace, Execution, Time & Expenses, Financial Control, Management). A project's own work —
  // tasks, milestones, team, time, financials, documents, discussions, activity, settings — lives in its tabs, not in the sidebar; every
  // view and filter below a destination is registered with `parent`: searchable and breadcrumbed, never a sidebar entry of its own.
  {
    moduleKey: "projects",
    label: "Projects",
    icon: FolderKanban,
    requiredPermission: "projects.view",
    sections: [
      {
        id: "workspace",
        label: "Workspace",
        icon: LayoutDashboard,
        items: [
          { ...available("Overview", "/projects"), aliases: ["projects home", "project dashboard", "portfolio summary", "needing attention"] },
          { ...available("Portfolio Progress", "/projects/progress"), parent: "overview", aliases: ["project progress", "portfolio", "completion percentage", "progress tracking", "delivery status"] },
          { ...available("Needing Attention", "/projects/progress?view=attention"), parent: "overview", aliases: ["at risk projects", "blocked projects", "overdue projects", "delivery risks"] },
          { ...available("My Work", "/projects/my-work"), aliases: ["my work", "what to do next", "my day"] },
          { ...available("My Tasks", "/projects/my-work?tab=tasks&view=mine"), parent: "my-work", aliases: ["my tasks", "assigned to me", "task queue"], requiredPermission: "projects.tasks.view" },
          { ...available("My Projects", "/projects/my-work?tab=projects"), parent: "my-work", aliases: ["my projects", "assigned projects", "projects i manage"] },
          { ...available("My Timesheets", "/projects/my-work?tab=timesheets"), parent: "my-work", aliases: ["my timesheet", "log time", "record hours"], requiredPermission: "projects.time.view_own" },
          { ...available("My Expenses", "/projects/my-work?tab=expenses&view=mine"), parent: "my-work", aliases: ["my expenses", "expense claim", "reimbursement", "receipt"], requiredPermission: "projects.expenses.view_own" },
          { ...available("Mentions", "/projects/my-work?tab=mentions&view=mentions"), parent: "my-work", aliases: ["mentions", "mentioned me", "@ mentions"], requiredPermission: "projects.comments.view" },
          { ...available("Discussions", "/projects/my-work?tab=discussions&view=unread"), parent: "my-work", aliases: ["unread comments", "followed discussions", "project conversation"], requiredPermission: "projects.comments.view" },
          { ...available("My Approvals", "/projects/my-work?tab=approvals"), parent: "my-work", aliases: ["my pending approvals", "waiting for me"] },
          { ...available("All Projects", "/projects/all"), aliases: ["project list", "project directory", "import projects", "export projects"] },
          { ...available("New Project", "/projects/new"), parent: "all-projects", aliases: ["create project", "new project"], requiredPermission: "projects.create" },
          { ...available("Active Projects", "/projects/all?view=active"), parent: "all-projects", aliases: ["active projects", "in progress projects", "planned projects"] },
          { ...available("Projects on Hold", "/projects/all?view=on_hold"), parent: "all-projects", aliases: ["paused projects", "project hold"] },
          { ...available("Completed Projects", "/projects/all?view=completed"), parent: "all-projects", aliases: ["completed projects", "delivered projects"] },
          { ...available("Archived Projects", "/projects/all?view=archived"), parent: "all-projects", aliases: ["archived projects"] },
          { ...available("Draft Projects", "/projects/all?view=drafts"), parent: "all-projects", aliases: ["draft projects", "projects to finish"] },
        ],
      },
      {
        id: "execution",
        label: "Execution",
        icon: ArrowLeftRight,
        items: [
          { ...available("Tasks", "/projects/tasks?view=open"), aliases: ["project tasks", "task list", "task board", "kanban", "bulk tasks"], requiredPermission: "projects.tasks.view" },
          { ...available("Overdue Tasks", "/projects/tasks?view=overdue"), parent: "tasks", aliases: ["overdue tasks", "late tasks"], requiredPermission: "projects.tasks.view" },
          { ...available("Blocked Tasks", "/projects/tasks?view=blocked"), parent: "tasks", aliases: ["blocked tasks"], requiredPermission: "projects.tasks.view" },
          { ...available("Tasks in Review", "/projects/tasks?view=in_review"), parent: "tasks", aliases: ["tasks in review", "task approval", "review tasks"], requiredPermission: "projects.tasks.view" },
          { ...available("Unassigned Tasks", "/projects/tasks?view=unassigned"), parent: "tasks", aliases: ["needs an owner", "orphaned tasks", "reassign tasks"], requiredPermission: "projects.tasks.view" },
          { ...available("Milestones", "/projects/milestones"), aliases: ["project milestones", "milestone list", "deliverables", "phase gates"], requiredPermission: "projects.milestones.view" },
          { ...available("Milestones Due Soon", "/projects/milestones?view=upcoming"), parent: "milestones", aliases: ["upcoming milestones", "milestones due"], requiredPermission: "projects.milestones.view" },
          { ...available("Overdue Milestones", "/projects/milestones?view=overdue"), parent: "milestones", aliases: ["overdue milestones", "late milestones"], requiredPermission: "projects.milestones.view" },
          { ...available("Milestones Awaiting Approval", "/projects/milestones?view=pending_approval"), parent: "milestones", aliases: ["milestone approval", "customer acceptance"], requiredPermission: "projects.milestones.view" },
        ],
      },
      {
        id: "time-expenses",
        label: "Time & Expenses",
        icon: Gauge,
        items: [
          { ...available("Timesheets", "/projects/timesheets"), aliases: ["weekly timesheet", "submit timesheet", "daily time", "time entry"], requiredPermission: "projects.time.view_own" },
          { ...available("Team Timesheets", "/projects/timesheets/team"), parent: "timesheets", aliases: ["team time", "missing timesheets", "timesheet reminders"], requiredPermission: "projects.time.view_team" },
          { ...available("Timesheet Approvals", "/projects/timesheets/approvals"), parent: "timesheets", aliases: ["approve timesheets", "timesheet approval", "review time"], requiredPermission: "projects.time.approve" },
          { ...available("Time Corrections", "/projects/timesheets/corrections"), parent: "timesheets", aliases: ["correct approved time", "timesheet corrections"] },
          { ...available("Labor Rates", "/projects/timesheets/rates"), parent: "timesheets", aliases: ["cost rates", "internal hourly rate", "labour cost"], requiredPermission: "projects.time.view_cost" },
          { ...available("Billable Hours", "/projects/timesheets/billable"), parent: "timesheets", aliases: ["billable time", "unbilled hours", "time billing", "billing requests", "invoice time"],
            requiredPermission: "projects.time.view_billing" },
          { ...available("Expenses", "/projects/expenses?view=mine"), aliases: ["submit expense", "expense claims", "project expenses"], requiredPermission: "projects.expenses.view_own" },
          { ...available("Expense Approvals", "/projects/expenses?view=approvals"), parent: "expenses", aliases: ["approve expenses", "expense approval"], requiredPermission: "projects.expenses.approve" },
          { ...available("Team Expenses", "/projects/expenses?view=team"), parent: "expenses", aliases: ["team claims"], requiredPermission: "projects.expenses.view_team" },
          { ...available("Expense Finance Review", "/projects/expenses?view=finance"), parent: "expenses", aliases: ["verify expenses", "gst review", "expense tax"], requiredPermission: "projects.expenses.finance_review" },
          { ...available("Reimbursements", "/projects/expenses?view=reimbursements"), parent: "expenses", aliases: ["pay employees", "reimburse expenses"], requiredPermission: "projects.expenses.finance_review" },
          { ...available("Expense Corrections", "/projects/expenses?view=corrections"), parent: "expenses", aliases: ["expense corrections", "wrong expense"], requiredPermission: "projects.expenses.correct" },
        ],
      },
      {
        id: "financial-control",
        label: "Financial Control",
        icon: Landmark,
        items: [
          { ...available("Project Financials", "/projects/financials"), aliases: ["project financials", "project cost", "project revenue", "project profitability", "margin", "contribution"],
            requiredAnyPermission: ["projects.cost.view_summary", "projects.revenue.view_summary", "projects.profitability.view_summary"] },
          { ...available("Project Costs", "/projects/financials?tab=costs"), parent: "project-financials", aliases: ["cost summary", "budget vs actual"], requiredPermission: "projects.cost.view_summary" },
          { ...available("Project Revenue", "/projects/financials?tab=revenue"), parent: "project-financials", aliases: ["contract value", "net invoiced", "recognized revenue", "collections"], requiredPermission: "projects.revenue.view_summary" },
          { ...available("Project Billing", "/projects/financials?tab=billing"), parent: "project-financials", aliases: ["approved unbilled time", "invoice from time", "billing requests"], requiredPermission: "projects.time.view_billing" },
          { ...available("Budget & Forecast", "/projects/financials?tab=budget"), parent: "project-financials", aliases: ["estimate at completion", "eac", "etc", "forecast"], requiredPermission: "projects.profitability.view_forecast" },
          { ...available("Profitability", "/projects/financials?tab=profitability"), parent: "project-financials", aliases: ["project margin", "loss making projects", "forecast margin"], requiredPermission: "projects.profitability.view_summary" },
          { ...available("Financial Reconciliation", "/projects/financials?tab=reconciliation"), parent: "project-financials", aliases: ["financial exceptions", "unreconciled", "missing sources"], requiredPermission: "projects.profitability.view_summary" },
        ],
      },
      {
        id: "management",
        label: "Management",
        icon: BarChart3,
        items: [
          { ...available("Approvals", "/projects/approvals"), aliases: ["pending approvals", "decisions", "task reviews", "milestone reviews", "approve", "review queue"] },
          { ...available("Reports", "/projects/reports"), aliases: ["project reports", "deadlines", "projects by manager", "projects by customer", "report directory"], requiredPermission: "projects.reports.view" },
          { ...available("Work by Priority", "/projects/reports?report=pr-distribution"), parent: "reports", aliases: ["priority report", "urgent work", "priority distribution", "high priority"],
            requiredPermission: "projects.reports.view" },
          { ...available("Priority Changes", "/projects/reports?report=pr-changes"), parent: "reports", aliases: ["priority history", "escalations", "priority audit"],
            requiredPermission: "projects.reports.view" },
          { ...available("Projects by Status", "/projects/reports?report=st-by-status"), parent: "reports", aliases: ["status report", "project lifecycle", "status changes"],
            requiredPermission: "projects.reports.view" },
          { ...available("On-Hold Projects", "/projects/reports?report=st-on-hold"), parent: "reports", aliases: ["paused projects", "hold reasons", "hold duration", "blocked projects"],
            requiredPermission: "projects.reports.view" },
          { ...available("Completion Exceptions", "/projects/reports?report=st-completion-exceptions"), parent: "reports", aliases: ["waived tasks", "closeout exceptions", "reopened projects"],
            requiredPermission: "projects.reports.view" },
          { ...available("Project Time", "/projects/reports?report=tm-project-hours"), parent: "reports", aliases: ["project hours", "time by project", "task hours"], requiredPermission: "projects.time.view_team" },
          { ...available("Employee Hours", "/projects/reports?report=tm-employee-hours"), parent: "reports", aliases: ["hours by employee", "workload evidence"], requiredPermission: "projects.time.view_team" },
          { ...available("Billable vs Non-Billable", "/projects/reports?report=bt-billable-vs-nonbillable"), parent: "reports", aliases: ["billable hours", "non-billable reasons", "utilization"],
            requiredPermission: "projects.time.view_team" },
          { ...available("Unbilled Time", "/projects/reports?report=bt-approved-unbilled"), parent: "reports", aliases: ["approved unbilled hours", "billing backlog", "invoiced hours"],
            requiredPermission: "projects.time.view_billing" },
          { ...available("Time Billing Exceptions", "/projects/reports?report=bt-exceptions"), parent: "reports", aliases: ["billing exceptions", "missing contract line", "cancelled invoice time"],
            requiredPermission: "projects.time.view_billing" },
          { ...available("Timesheet Exceptions", "/projects/reports?report=tm-exceptions"), parent: "reports", aliases: ["overlapping time", "late timesheets", "unsubmitted timesheets"], requiredPermission: "projects.time.view_team" },
          { ...available("Project Settings", "/projects/settings"), aliases: ["project types", "project roles", "project templates", "project approval", "overhead policy"], requiredPermission: "projects.settings.manage" },
        ],
      },
    ],
  },
  {
    moduleKey: "assets",
    label: "Assets",
    icon: Wrench,
    requiredPermission: "assets.view",
    // Register → acquire → assign → move → maintain → depreciate → dispose. Nine groups; the features inside them (identification, status,
    // straight-line depreciation, sale / scrap, gain / loss…) are tabs, views and actions of these workspaces, not menu entries of their own.
    sections: [
      {
        id: "overview",
        label: "Overview",
        icon: LayoutDashboard,
        flat: true,
        items: [{ ...available("Overview", "/assets"), aliases: ["assets home", "asset dashboard", "what needs attention", "quick actions", "find asset", "scan asset", "recent asset activity"] }],
      },
      {
        id: "asset-management",
        label: "Asset Management",
        icon: Database,
        collapsible: true,
        items: [
          { ...available("Asset Register", "/assets/register"), aliases: ["all assets", "asset list", "fixed assets", "equipment", "scan asset", "qr label", "asset tag", "serial number", "asset status", "identification"] },
          { ...available("Active Assets", "/assets/register?view=active"), parent: "asset-register", aliases: ["assets in use"] },
          { ...available("Available Assets", "/assets/register?view=available"), parent: "asset-register", aliases: ["spare assets", "free equipment"] },
          { ...available("On Hold, Lost or Retired", "/assets/register?view=ended"), parent: "asset-register", aliases: ["held assets", "lost assets", "retired assets", "missing assets"] },
          { ...available("Disposed Assets", "/assets/register?lifecycle=DISPOSED"), parent: "asset-register", aliases: ["disposed assets", "sold assets", "scrapped assets"] },
          { ...available("Add Asset", "/assets/register/new"), parent: "asset-register", aliases: ["new asset", "register asset", "create asset"], requiredPermission: "assets.create" },
          { ...available("Print Asset Labels", "/assets/register/labels"), parent: "asset-register", aliases: ["asset labels", "qr labels", "barcode labels", "reprint label"], requiredPermission: "assets.identification.bulk_print" },
          { ...available("My Assets", "/assets/my-assets"), aliases: ["my equipment", "assets in my care", "acknowledge asset", "request an asset", "report an issue", "return asset"] },
          { ...available("Asset Categories", "/assets/categories"), aliases: ["asset classes", "category master", "depreciation policy reference"] },
          { ...available("Asset Locations", "/assets/locations"), aliases: ["locations", "offices", "rooms", "sites", "location hierarchy"] },
          { ...available("New Location", "/assets/locations/new"), parent: "asset-locations", aliases: ["add location", "create location"], requiredPermission: "assets.location.create" },
        ],
      },
      {
        id: "acquisition",
        label: "Acquisition",
        icon: BadgeCheck,
        collapsible: true,
        items: [
          { ...available("Purchases & Capitalization", "/assets/capitalization"), aliases: ["capitalize assets", "finance confirmation", "capitalization", "create assets from invoice", "invoice to asset", "cwip", "capital work in progress", "asset purchases", "cost allocation", "register from purchase"],
            requiredAnyPermission: ["assets.acquisition.view", "assets.capitalization.request", "assets.capitalization.approve", "assets.cwip.manage", "assets.invoice.view_source", "assets.register_bulk"] },
          { ...available("Opening / Existing Assets", "/assets/opening"), aliases: ["import assets", "opening asset register", "asset csv", "migrate assets", "existing assets", "cutover", "legacy register"],
            requiredAnyPermission: ["assets.opening.create", "assets.opening.upload", "assets.opening.view_financials", "assets.opening.approve_financials", "assets.opening.view_audit"] },
        ],
      },
      {
        id: "assignment-movement",
        label: "Assignment & Movement",
        icon: ArrowLeftRight,
        collapsible: true,
        items: [
          { ...available("Assignments & Custody", "/assets/assignments"), aliases: ["assign asset", "issue laptop", "asset request", "returns due", "reassign asset", "bulk assignment", "custodian", "acknowledgment"] },
          { ...available("Custody & Handovers", "/assets/custody"), parent: "assignments-custody", aliases: ["handover", "employee clearance", "offboarding assets", "custody exceptions"] },
          { ...available("Asset Transfers", "/assets/transfers"), aliases: ["transfers", "move asset", "relocate asset", "in transit", "dispatch", "receive asset", "send for repair", "branch transfer"] },
          { ...available("Movement History", "/assets/movements"), aliases: ["asset movements", "where was this asset", "asset trail", "custody history", "as of date", "movement audit"], requiredPermission: "assets.movement.view" },
          { ...available("Location Discrepancies", "/assets/locations/discrepancies"), parent: "movement-history", aliases: ["misplaced assets", "location exceptions", "observations"] },
        ],
      },
      {
        id: "maintenance",
        label: "Maintenance",
        icon: Wrench,
        collapsible: true,
        items: [
          { ...available("Maintenance Requests", "/assets/maintenance?view=requests"), aliases: ["report a problem", "asset issue", "broken asset", "reported problems", "triage"],
            requiredAnyPermission: ["assets.maintenance.view", "assets.maintenance.request"] },
          { ...available("Work Orders", "/assets/maintenance?view=work-orders"), aliases: ["repairs", "repair orders", "open repairs", "technician", "breakdown", "service"], requiredPermission: "assets.maintenance.view" },
          { ...available("My Maintenance Work", "/assets/maintenance?view=mine"), parent: "work-orders", aliases: ["technician queue", "my repairs"], requiredPermission: "assets.maintenance.execute" },
          { ...available("Preventive Maintenance", "/assets/maintenance?view=plans"), aliases: ["service schedule", "preventive plans", "maintenance plans", "maintenance due", "upcoming service", "overdue service"], requiredPermission: "assets.maintenance.view" },
        ],
      },
      {
        id: "depreciation",
        label: "Depreciation",
        icon: BarChart3,
        collapsible: true,
        items: [
          { ...available("Asset Schedules", "/assets/depreciation?view=assets"), aliases: ["depreciation", "depreciation schedule", "straight-line depreciation", "net book value", "estimate revision"], requiredPermission: "assets.depreciation.view" },
          { ...available("Monthly Runs", "/assets/depreciation?view=runs"), aliases: ["depreciation run", "prepare run", "journal preview", "post depreciation"], requiredPermission: "assets.depreciation.view" },
          { ...available("Automatic Accounting", "/assets/depreciation?view=automation"), aliases: ["automatic depreciation", "depreciation automation", "scheduled posting"], requiredPermission: "assets.depreciation.automation_view" },
        ],
      },
      {
        id: "disposals",
        label: "Disposals",
        icon: Truck,
        collapsible: true,
        items: [
          { ...available("All Disposals", "/assets/disposals"), aliases: ["dispose", "new disposal", "write off", "donate asset", "derecognition", "retire asset", "disposal approval", "gain or loss on disposal"], requiredPermission: "assets.disposal.view" },
          { ...available("Asset Sales", "/assets/disposals?view=sales"), aliases: ["sell asset", "asset sale", "buyer", "sale invoice for asset", "sale proceeds"], requiredPermission: "assets.disposal.view" },
          { ...available("Scrap / Write-offs", "/assets/disposals?view=scrap"), aliases: ["scrap", "e-waste", "recycler", "scrap dealer", "destruction certificate", "lost write-off", "damaged write-off"], requiredPermission: "assets.disposal.view" },
        ],
      },
      {
        id: "reports-control",
        label: "Reports & Control",
        icon: Gauge,
        collapsible: true,
        items: [
          { ...available("Asset Reports", "/assets/reports"), aliases: ["reports", "assets by location", "assets by custodian", "warranty expiry", "net book value", "disposal register", "disposal gain loss", "audit history", "downtime"] },
          { ...available("Exceptions & Reconciliation", "/assets/exceptions"), aliases: ["exceptions", "reconciliation", "control center", "failed postings", "depreciation vs gl", "acquisition exceptions"],
            requiredAnyPermission: ["assets.manage", "assets.capitalization.approve", "assets.depreciation.reconcile", "assets.disposal.reconcile", "assets.maintenance.triage", "assets.transfer.approve", "assets.audit.view"] },
        ],
      },
      {
        id: "administration",
        label: "Administration",
        icon: Settings,
        collapsible: true,
        items: [
          { ...adminOnly("Asset Settings", "/assets/settings", "assets.settings.manage"), aliases: ["asset settings", "approval policies", "maintenance defaults", "disposal thresholds", "asset code format", "labels"] },
        ],
      },
    ],
  },
  {
    moduleKey: "point-of-sale",
    label: "POS",
    icon: Store,
    requiredPermission: "pos.view",
    // The standard sections (as CRM, Sales, Procurement and Inventory). Smaller POS features are tabs, dialogs or actions inside these pages:
    // barcode scanning, discounts and split payments in the Register; refunds and approvals in Returns & Refunds; cash movements and cash
    // differences in Shifts & Cash; sales, payments and documents in Transactions.
    sections: [
      {
        id: "overview",
        label: "Overview",
        icon: LayoutDashboard,
        flat: true,
        items: [{ ...available("Overview", "/pos"), aliases: ["pos home", "pos dashboard", "retail overview", "today"] }],
      },
      {
        id: "master-data",
        label: "Master Data",
        icon: Database,
        collapsible: true,
        items: [
          { ...available("Stores & Outlets", "/pos/outlets"), aliases: ["stores", "outlets", "shops", "showroom", "kiosk", "retail locations"], requiredPermission: "pos.outlets.view" },
          { ...available("POS Terminals", "/pos/terminals"), aliases: ["terminals", "counters", "tills"], requiredPermission: "pos.terminals.view" },
          { ...available("Cashiers", "/pos/cashiers"), aliases: ["cashier access", "cashier profiles", "operators", "store access"], requiredPermission: "pos.cashiers.view" },
        ],
      },
      {
        id: "operations",
        label: "Operations",
        icon: ArrowLeftRight,
        collapsible: true,
        items: [
          { ...available("Register", "/pos/register"), aliases: ["sell", "checkout", "point of sale", "billing counter", "new sale", "scan barcode", "split payment", "cart discount"],
            requiredAnyPermission: ["pos.sale.create", "pos.operate"] },
          { ...available("Held Carts", "/pos/held-carts"), aliases: ["held bills", "resume sale", "parked sale", "on hold"], requiredAnyPermission: ["pos.sale.create", "pos.operate"] },
          { ...available("Returns & Refunds", "/pos/returns"), aliases: ["returns", "exchanges", "refunds", "refund status", "return approval", "supervisor approvals"] },
          { ...available("Shifts & Cash", "/pos/shifts"), aliases: ["shifts", "sessions", "open shift", "close shift", "cash in", "cash out", "float", "cash difference", "handover"] },
        ],
      },
      {
        id: "planning",
        label: "Planning & Control",
        icon: Gauge,
        collapsible: true,
        items: [
          { ...available("Day-End / Z Reports", "/pos/day-end"), aliases: ["z report", "x report", "day end", "close day"], requiredAnyPermission: ["pos.report.view", "pos.report.generate", "pos.report.finalize"] },
          { ...available("Payment Reconciliation", "/pos/reconciliation"), aliases: ["reconciliation", "settlements", "card settlement", "upi settlement", "bank match"],
            requiredPermission: "pos.reconciliation.view" },
          { ...available("Accounting Posting", "/pos/accounting"), aliases: ["gl posting", "posting failures", "retry posting"], requiredPermission: "pos.accounting.view" },
        ],
      },
      {
        id: "inquiries",
        label: "Inquiries",
        icon: Search,
        collapsible: true,
        items: [
          { ...available("Transactions", "/pos/transactions"), aliases: ["sales", "receipts", "reprint", "gst invoice", "credit notes", "payment status", "pos sales"] },
          { ...available("Stock Lookup", "/pos/stock"), aliases: ["store stock", "availability", "in stock", "batches at store"] },
          { ...available("Scan Diagnostics", "/pos/scan-diagnostics"), aliases: ["barcode errors", "unknown barcodes", "scanner", "scan failures"],
            requiredPermission: "pos.terminals.view_transactions" },
        ],
      },
      {
        id: "reports",
        label: "Reports",
        icon: BarChart3,
        collapsible: true,
        items: [
          { ...available("Sales Reports", "/pos/reports?tab=sales"), aliases: ["pos reports", "walk-in sales", "discount summary"], requiredAnyPermission: ["pos.report.view", "pos.reports.view"] },
          { ...available("Payment Reports", "/pos/reports?tab=payments"), aliases: ["cash collections", "card collections", "upi collections", "split payments"], requiredAnyPermission: ["pos.report.view", "pos.reports.view"] },
          { ...available("Returns & Refund Reports", "/pos/reports?tab=returns-refunds"), aliases: ["returns by reason", "refunds by method"], requiredAnyPermission: ["pos.report.view", "pos.reports.view"] },
          { ...available("Cash & Shift Reports", "/pos/reports?tab=cash-shifts"), aliases: ["shift summary", "cash differences report"], requiredAnyPermission: ["pos.report.view", "pos.reports.view"] },
          { ...available("Inventory Reports", "/pos/reports?tab=inventory"), aliases: ["quantity sold", "stock reduced"], requiredAnyPermission: ["pos.report.view", "pos.reports.view"] },
          { ...available("GST & Document Reports", "/pos/reports?tab=tax-documents"), aliases: ["gst summary", "tax breakdown", "reprints"], requiredAnyPermission: ["pos.report.view", "pos.reports.view"] },
        ],
      },
      {
        id: "configuration",
        label: "Configuration",
        icon: Settings,
        collapsible: true,
        items: [
          { ...available("POS Setup", "/pos/settings"), aliases: ["pos settings", "pos policy", "return rules", "receipt printer", "payment settings"], requiredPermission: "pos.settings.manage" },
          { ...available("Cashier Permissions", "/pos/settings/cashier-permissions"), aliases: ["permission profiles", "discount limits", "refund limits", "cashier limits"],
            requiredPermission: "pos.permission_profiles.view" },
          // Every other POS route belongs to one of the pages above: searchable and breadcrumbed, never a sidebar entry of its own.
          { ...available("Supervisor Approvals", "/pos/returns?tab=approvals"), parent: "returns-refunds", aliases: ["discount approval", "price override approval", "refund approval", "cash approval"] },
          { ...available("Refunds", "/pos/returns?tab=refunds"), parent: "returns-refunds", aliases: ["refund status", "cash refund", "card refund", "upi refund"] },
          { ...available("Refund", "/pos/refunds"), parent: "returns-refunds" },
          { ...available("Receipt", "/pos/receipts"), parent: "transactions", aliases: ["receipt preview"] },
          { ...available("GST Documents", "/pos/transactions?tab=documents"), parent: "transactions", aliases: ["invoices", "bill of supply", "invoice number"] },
          { ...available("Payments Needing a Decision", "/pos/transactions?tab=payments"), parent: "transactions", aliases: ["payment exceptions", "duplicate payment", "excess payment", "unknown payment"] },
          { ...available("Cash Movements", "/pos/shifts?tab=cash-movements"), parent: "shifts-cash", aliases: ["cash in", "cash out", "petty cash"] },
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
        id: "specifications",
        label: "Inspection Specifications",
        items: [
          { ...available("All Specifications", "/quality/specifications?view=all"), requiredPermission: "quality.spec.view",
            aliases: ["inspection specification", "quality plan", "inspection checklist", "acceptance criteria", "tolerance", "qsp", "sampling plan"] },
          { ...available("Drafts", "/quality/specifications?view=drafts"), requiredPermission: "quality.spec.edit_draft" },
          { ...available("Pending Approval", "/quality/specifications?view=pending"), requiredPermission: "quality.spec.review", aliases: ["approve specification", "specification review"] },
          { ...available("Active Specifications", "/quality/specifications?view=active"), requiredPermission: "quality.spec.view" },
          { ...available("Superseded / Retired", "/quality/specifications?view=retired"), requiredPermission: "quality.spec.view", aliases: ["specification history", "old versions"] },
          { ...available("Templates", "/quality/specifications?view=templates"), requiredPermission: "quality.spec.view", aliases: ["checklist template", "copy specification"] },
          { ...available("Applicability Conflicts", "/quality/specifications?view=conflicts"), requiredPermission: "quality.spec.view",
            aliases: ["specification conflict", "configuration exception", "missing specification", "coverage gap"] },
        ],
      },
      {
        id: "control-points",
        label: "Quality Control Points",
        items: [
          { ...available("All Control Points", "/quality/control-points?view=all"), requiredPermission: "quality.qcp.view",
            aliases: ["qcp", "quality control point", "quality gate", "incoming inspection rule", "inspection requirement", "quality hold rule"] },
          { ...available("Drafts", "/quality/control-points?view=drafts"), requiredPermission: "quality.qcp.edit_draft" },
          { ...available("Pending Approval", "/quality/control-points?view=pending"), requiredPermission: "quality.qcp.review" },
          { ...available("Active Rules", "/quality/control-points?view=active"), requiredPermission: "quality.qcp.view" },
          { ...available("Future Effective", "/quality/control-points?view=future"), requiredPermission: "quality.qcp.edit_draft" },
          { ...available("Inspection Requirements", "/quality/control-points?view=requirements"), requiredPermission: "quality.qcp.view",
            aliases: ["inspections required", "stock awaiting quality clearance", "quality waiver", "deviation"] },
          { ...available("Conflicts & Exceptions", "/quality/control-points?view=conflicts"), requiredPermission: "quality.qcp.view", aliases: ["quality control exceptions", "qcp conflict"] },
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
          available("Quality Holds", "/inventory/quality-holds"),
        ],
      },
      {
        id: "reports",
        label: "Reports",
        items: [{ ...available("Control Point Reports", "/quality/control-points?view=reports"), requiredPermission: "quality.qcp.view",
          aliases: ["control point register", "inspection requirement coverage", "quality gate exceptions", "qcp execution history", "trigger history"] },
          { ...available("Specification Reports", "/quality/specifications?view=reports"), requiredPermission: "quality.spec.view",
          aliases: ["specification register", "specifications missing approval", "specification version history", "applicability", "specification usage", "inspection coverage"] }],
      },
      {
        id: "settings",
        label: "Settings",
        items: [{ ...available("Quality Settings", "/quality/settings"), requiredPermission: "quality.spec.view",
          aliases: ["inspection stage defaults", "specification approval policy", "inspection requirement rules", "self approval"] }],
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
        items: [available("Home", "/accounting"), { ...available("Automatic Postings", "/accounting/postings"), aliases: ["posting failures", "retry posting", "missing postings", "trial balance check"] }],
      },
      {
        id: "ledger",
        label: "Ledger",
        featureRange: "F453-F458",
        items: [
          available("Chart of Accounts", "/accounting/chart-of-accounts"),
          available("Journals", "/accounting/journals"),
          available("General Ledger", "/accounting/general-ledger"),
          { ...available("Opening Balances", "/accounting/opening-balances"), aliases: ["opening journal", "go-live balances"] },
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
          { ...available("Expenses", "/accounting/expenses"), aliases: ["expense claim", "petty cash", "reimbursement"] },
          { ...available("Input Tax Credit", "/accounting/input-tax-credit"), aliases: ["itc", "gstr-2b", "gst credit"] },
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
          { ...available("Bank & Cash Transfers", "/accounting/fund-transfers"), aliases: ["fund transfer", "cash deposit", "contra"] },
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
          { ...available("Posting Accounts", "/accounting/settings"), aliases: ["account mapping", "default accounts", "gst accounts", "accounting settings"] },
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
