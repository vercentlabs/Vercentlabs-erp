import { WORKSPACE_EMAILS } from "@vercentlabs/config";

/**
 * Site-wide identity and the master brand contract. Brand surfaces (homepage,
 * metadata, OpenGraph image, manifest, footer, llms.txt) read from here.
 *
 * Vercentlabs ERP is positioned as horizontal ERP: one system for the whole
 * business. Industries and regions are use-case and localisation contexts on
 * their own pages, never the master positioning.
 */
export const SITE_IDENTITY = Object.freeze({
  name: "Vercentlabs",
  productName: "Vercentlabs ERP",
  titleTemplate: "%s | Vercentlabs ERP",
  category: "ERP / Business Management Software",
});

export const POSITIONING = Object.freeze({
  /** The master headline — exact punctuation and capitalisation. */
  heroHeadline: "One ERP. Your entire business.",
  masterPromise: "Run your entire business in one ERP.",
  coreIdea: "Every major business function connected in one system.",
  problemStatement: "Stop running one business through disconnected systems.",
  /** Short descriptor for footers, manifests, and summaries. */
  descriptor:
    "Vercentlabs ERP connects CRM, sales, procurement, inventory, manufacturing, projects, assets, POS, quality, support, HR & payroll, and finance in one business system.",
});

/**
 * Single source of truth for legal/company identity. Only fields
 * verifiable against real, existing usage elsewhere in the codebase are
 * populated with confidence: "Vercentlabs LLP" is the real legal name already
 * used in apps/web's production auth emails (src/core/mailer.ts) and account
 * UI (src/core/components/auth-card.tsx), not invented.
 *
 * registeredAddress and llpin are intentionally null — no registered office
 * address or LLP Identification Number exists anywhere in this repository,
 * and neither may be fabricated. Both are real BLOCKERs for a fully complete
 * Privacy Policy/Terms of Use under India's DPDPA — the pages ship with
 * accurate placeholder language rather than an invented address, and the gap
 * is flagged explicitly, not hidden.
 *
 * Contact emails use provisioned, monitored Google Workspace addresses on the
 * verified production domain (vercentlabs.com). Role addresses stay distinct
 * so buyer, customer, legal, security, hiring, and billing messages reach the
 * responsible team without exposing a person's mailbox.
 */
export const COMPANY_IDENTITY = Object.freeze({
  legalName: "Vercentlabs LLP",
  entityType: "Limited Liability Partnership",
  country: "India",
  registeredAddress: null,
  llpin: null,
  primaryContactEmail: WORKSPACE_EMAILS.primary,
  salesContactEmail: WORKSPACE_EMAILS.sales,
  privacyContactEmail: WORKSPACE_EMAILS.privacy,
  supportContactEmail: WORKSPACE_EMAILS.support,
  securityContactEmail: WORKSPACE_EMAILS.security,
  careersContactEmail: WORKSPACE_EMAILS.careers,
  billingContactEmail: WORKSPACE_EMAILS.billing,
});
