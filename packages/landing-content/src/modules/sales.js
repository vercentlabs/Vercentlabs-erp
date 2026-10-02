import { CTAS } from "../navigation.js";
import { capabilityGroup } from "./capability-group.js";
import { PLATFORM_GOVERNANCE } from "./platform-governance.js";

/**
 * Sales — marketing content for the `sales` module of the ERP
 * module catalog (@vercentlabs/shared-types). The catalog owns `key`, `name`,
 * and `description`; `displayName` is the public label. Everything here must
 * stay inside this module's approved launch capabilities
 * (capabilities/launch-capabilities.js).
 */
export const SALES_MODULE = Object.freeze({
  key: "sales",
  displayName: "Sales",
  purpose: "Quotations, sales orders, deliveries, invoices, and credit notes.",
  navGroup: "revenue",
  personas: ["Sales reps and managers", "Order desk / sales operations", "Billing and finance teams"],
  painPoints: [
    "Quotations and orders built in separate tools",
    "Promising stock that isn't available",
    "Invoices re-keyed from orders",
  ],
  bestAngle:
    "A quotation with the right discounts and taxes becomes a confirmed sales order, checks availability and reserves stock, ships, and is invoiced — with the order's status visible at every step.",
  accentColor: { hex: "#2468d7", soft: "#edf4ff", sourcedFromProduct: false },
  directDefinition:
    "The Vercentlabs Sales module runs quote-to-invoice: customers, products and services, quotations with discounts and taxes, sales orders with availability checks and stock reservation, delivery, invoicing, and credit notes.",
  heroVariant: "operational-sequence",
  searchIntent: "Sales management ERP",
  metaDescription:
    "Vercentlabs Sales manages quotations, discounts, taxes, sales orders, stock availability and reservation, delivery, invoicing, and credit notes — with order status tracking throughout.",
  businessProblems: [
    { title: "Quotes and orders drift apart", description: "A quotation is agreed in one place and the order is typed again somewhere else, so prices and quantities stop matching." },
    { title: "Promising stock you don't have", description: "Orders are confirmed without anyone checking what's actually available in the warehouse." },
    { title: "Invoices re-keyed from orders", description: "Billing re-enters what was ordered and shipped, and mistakes surface only when the customer complains." },
    { title: "Nobody can answer \"where's my order?\"", description: "Order status lives in someone's head or inbox instead of on the order itself." },
  ],
  businessOutcomes: [
    { title: "Consistent pricing", description: "Discounts and taxes are applied on the quotation and carried through to the order and invoice." },
    { title: "Promises you can keep", description: "Availability is checked and stock reserved for confirmed orders." },
    { title: "Invoices from real orders", description: "Sales invoices are created from what was ordered and delivered, not re-typed." },
    { title: "Status anyone can check", description: "Order status tracking shows where each order is, from confirmation to invoice." },
  ],
  capabilityGroups: [
    capabilityGroup(
      "sales-customers-catalog",
      "Customers & catalog",
      "The customers you sell to and the products and services you sell, with the payment terms agreed with each.",
      ["sales-customer-master", "sales-customer-addresses-contacts", "sales-products-services", "sales-payment-terms"],
    ),
    capabilityGroup(
      "sales-quotations-pricing",
      "Quotations & pricing",
      "Quotations priced with discounts and taxes applied consistently.",
      ["sales-quotations", "sales-discounts", "sales-taxes"],
      "lead-to-cash",
    ),
    capabilityGroup(
      "sales-orders-fulfilment",
      "Orders & fulfilment",
      "Sales orders confirmed against available stock, reserved, shipped, and tracked.",
      ["sales-sales-orders", "sales-order-confirmation", "sales-availability-check", "sales-stock-reservation", "sales-delivery-shipment", "sales-order-status-tracking"],
    ),
    capabilityGroup(
      "sales-invoicing",
      "Invoicing & credit notes",
      "Invoices raised from orders, and credit notes and refunds when something needs to be reversed.",
      ["sales-sales-invoices", "sales-credit-notes-refunds"],
    ),
  ],
  primaryWorkflow: {
    name: "Quote to Invoice",
    trigger: "A customer asks for a price, or a CRM opportunity is ready to be quoted.",
    steps: [
      { step: "Quote", detail: "A quotation is prepared with the customer's products, discounts, and taxes." },
      { step: "Order", detail: "The accepted quotation becomes a sales order, and the order is confirmed." },
      { step: "Check and reserve", detail: "Availability is checked and stock is reserved for the order." },
      { step: "Deliver", detail: "The order is delivered and its shipment recorded." },
      { step: "Invoice", detail: "A sales invoice is raised from the order; credit notes handle returns or corrections." },
    ],
    approvals: [],
    automatedActions: ["Tax calculation on quotations and orders", "Stock reservation for confirmed orders"],
    connectedModuleKeys: ["crm", "stock", "accounting"],
    outcome: "A delivered, invoiced order whose status was visible at every step.",
  },
  connectedModules: [
    { moduleKey: "crm", relationship: "A CRM opportunity converts into a Sales quotation, so the customer context carries through." },
    { moduleKey: "stock", relationship: "Order availability checks and stock reservations read and update the same stock records the warehouse uses." },
    { moduleKey: "accounting", relationship: "Sales invoices become customer invoices in Accounting, where receipts are recorded and allocated." },
  ],
  reporting: [
    { name: "Order status", measures: "Where each order is between confirmation, delivery, and invoice", audience: "Sales operations, customer-facing teams" },
  ],
  automation: [
    { title: "Tax calculation", description: "Taxes are applied to quotation and order lines from the configured tax rules." },
    { title: "Stock reservation", description: "Confirmed orders reserve stock so the same units aren't promised twice." },
  ],
  governance: [PLATFORM_GOVERNANCE.permissions, PLATFORM_GOVERNANCE.concurrency, PLATFORM_GOVERNANCE.audit],
  implementationConsiderations: [
    "Customers, products and services, and payment terms are set up before go-live as part of data migration.",
    "Tax configuration is set up so quotations, orders, and invoices apply the right taxes.",
    "Discount rules are agreed with sales leadership before they're configured.",
  ],
  faqs: [
    { question: "Can a sales order check stock before it's confirmed?", answer: "Yes. The availability check shows what's available, and confirmed orders can reserve stock so it isn't promised twice." },
    { question: "How are mistakes on an invoice corrected?", answer: "Through credit notes and refunds, so the original invoice stays on record and the correction is traceable." },
    { question: "Can customers have their own payment terms?", answer: "Yes. Payment terms are set for customers and carried onto their orders and invoices." },
  ],
  screenshots: { primary: "sales-order-list" },
  conversion: { heading: "See how Vercentlabs Sales would run your quote-to-invoice process.", ctaLabel: CTAS.talkToSpecialist.label },
});
