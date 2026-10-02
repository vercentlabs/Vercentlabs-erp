import { CTAS } from "../navigation.js";
import { capabilityGroup } from "./capability-group.js";
import { PLATFORM_GOVERNANCE } from "./platform-governance.js";

/**
 * POS — marketing content for the `point-of-sale` module of the ERP
 * module catalog (@vercentlabs/shared-types). The catalog owns `key`, `name`,
 * and `description`; `displayName` is the public label. Everything here must
 * stay inside this module's approved launch capabilities
 * (capabilities/launch-capabilities.js).
 */
export const POINT_OF_SALE_MODULE = Object.freeze({
  key: "point-of-sale",
  displayName: "POS",
  purpose: "Store checkout, payments, returns, and shift reconciliation.",
  navGroup: "revenue",
  personas: ["Store cashiers", "Shift supervisors", "Store and finance admins"],
  painPoints: [
    "Till sales disconnected from stock",
    "End-of-day cash that doesn't add up",
    "Returns handled off the books",
  ],
  bestAngle:
    "A cashier sells from a terminal with cash, card, or UPI payments, stock reduces in real time, and every shift closes with a Day-End / Z report and payment reconciliation.",
  accentColor: { hex: "#be185d", soft: "#fdf0f5", sourcedFromProduct: false },
  directDefinition:
    "The Vercentlabs Point of Sale module runs in-store selling — stores, terminals, and cashiers with permissions, product search and cart, taxes, cash, card, and UPI payments, receipts, returns and refunds, shift control, and day-end reconciliation.",
  heroVariant: "operational-sequence",
  searchIntent: "Point of sale ERP",
  metaDescription:
    "Vercentlabs Point of Sale handles checkout with cash, card, and UPI payments, receipts, returns and refunds, real-time stock reduction, shift opening and closing, and Day-End / Z reports.",
  businessProblems: [
    { title: "The till and the stockroom disagree", description: "Sales are rung up in one system and stock is updated later, if at all." },
    { title: "Cash that doesn't add up", description: "Shift and day-end totals are counted by hand and the differences go unexplained." },
    { title: "Returns off the books", description: "Returns and refunds are handled informally, with no clean record." },
    { title: "Anyone can do anything at the till", description: "Cashiers share logins, and there's no control over who can do what." },
  ],
  businessOutcomes: [
    { title: "Stock that matches sales", description: "Every sale reduces stock in real time." },
    { title: "Shifts that reconcile", description: "Shift opening, closing, the Day-End / Z report, and payment reconciliation account for every payment method." },
    { title: "Returns on record", description: "Returns and refunds are recorded at the till like any other transaction." },
    { title: "Controlled cashier access", description: "Each cashier works under their own permissions." },
  ],
  capabilityGroups: [
    capabilityGroup(
      "pos-store-setup",
      "Stores, terminals & cashiers",
      "Where you sell, the terminals you sell from, and the cashiers who use them.",
      ["pos-stores-outlets", "pos-terminals", "pos-cashiers", "pos-cashier-permissions"],
    ),
    capabilityGroup(
      "pos-checkout",
      "Checkout & payments",
      "Finding products, building the cart, applying taxes, taking payment, and printing the receipt.",
      ["pos-product-search", "pos-cart", "pos-taxes", "pos-cash-payments", "pos-card-payments", "pos-upi-digital-payments", "pos-receipt-printing"],
    ),
    capabilityGroup(
      "pos-returns-inventory",
      "Returns & inventory",
      "Returns and refunds at the till, and stock that updates as you sell.",
      ["pos-returns", "pos-refunds", "pos-stock-reduction", "pos-real-time-inventory"],
    ),
    capabilityGroup(
      "pos-shifts-reconciliation",
      "Shifts & reconciliation",
      "Opening and closing shifts, and reconciling what was taken at day end.",
      ["pos-shift-opening", "pos-shift-closing", "pos-day-end-z-report", "pos-payment-reconciliation"],
    ),
  ],
  primaryWorkflow: {
    name: "Checkout to Day-End",
    trigger: "A cashier opens a shift.",
    steps: [
      { step: "Open shift", detail: "The cashier opens a shift on a POS terminal." },
      { step: "Sell", detail: "Products are found by search, added to the cart, and taxed." },
      { step: "Take payment", detail: "Payment is taken by cash, card, or UPI, and a receipt is printed." },
      { step: "Update stock", detail: "The sale reduces stock in real time." },
      { step: "Close and reconcile", detail: "The shift is closed, the Day-End / Z report is produced, and payments are reconciled." },
    ],
    approvals: [],
    automatedActions: ["Real-time stock reduction on sale", "Day-End / Z report totals"],
    connectedModuleKeys: ["stock"],
    outcome: "A closed, reconciled shift whose sales are already reflected in stock.",
  },
  connectedModules: [
    { moduleKey: "stock", relationship: "POS sales and returns update the same stock balances the warehouse uses, in real time." },
    { moduleKey: "accounting", relationship: "Store takings are reconciled by payment method and sit alongside the books kept in Accounting." },
  ],
  reporting: [
    { name: "Day-End / Z report", measures: "Sales, returns, and takings for the day by payment method", audience: "Store managers, finance" },
  ],
  automation: [
    { title: "Real-time stock reduction", description: "Each sale reduces stock as it's completed." },
    { title: "Day-end totals", description: "The Day-End / Z report totals the day's activity by payment method." },
  ],
  governance: [
    { title: "Cashier permissions", description: "Each cashier works under their own permissions, so sensitive actions are limited to the people allowed to take them." },
    PLATFORM_GOVERNANCE.concurrency,
    PLATFORM_GOVERNANCE.audit,
  ],
  implementationConsiderations: [
    "Stores, terminals, and cashiers are set up with the right permissions before opening.",
    "Products, prices, and taxes must already be configured.",
    "Shift and reconciliation procedures are agreed with store managers.",
  ],
  faqs: [
    { question: "Which payment methods does Vercentlabs POS support?", answer: "Cash, card, and UPI / digital payments, reconciled by payment method at day end." },
    { question: "Does a POS sale update stock immediately?", answer: "Yes. Each sale reduces stock in real time." },
  ],
  screenshots: {},
  conversion: { heading: "See how Vercentlabs Point of Sale would run your store checkout.", ctaLabel: CTAS.talkToSpecialist.label },
});
