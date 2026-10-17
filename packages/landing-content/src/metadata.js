import { WORKSPACE_EMAILS } from "@vercentlabs/config";

/**
 * Site-wide metadata constants from docs/landing-redesign/phase-1/positioning-and-messaging.md.
 * Consumed by the generateMetadata helper Prompt 2 scaffolds — no page content is written here.
 */
export const SITE_IDENTITY = Object.freeze({
  name: "Vercentlabs",
  productName: "Vercentlabs ERP",
  titleTemplate: "%s | Vercentlabs ERP",
  category: "Operational ERP for growing, multi-location businesses",
});

export const POSITIONING = Object.freeze({
  heroHeadline: "The ERP for businesses that outgrew spreadsheets.",
  heroSubhead:
    "Sales, inventory, procurement, production, and finance — on one live system, from the first order to the balance sheet.",
  promise:
    "Every part of the business runs on the same live numbers — because it's the same system, not five that happen to export to Excel.",
});

/**
 * Single source of truth for legal/company identity — Phase 8. Only fields
 * verifiable against real, existing usage elsewhere in the codebase are
 * populated with confidence: "Vercentlabs LLP" is the real legal name already
 * used in apps/web's production auth emails (src/core/mailer.ts) and account
 * UI (src/core/components/auth-card.tsx), not invented for this phase.
 *
 * registeredAddress and llpin are intentionally null — no registered office
 * address or LLP Identification Number exists anywhere in this repository,
 * and neither may be fabricated (see docs/landing-redesign/phase-8/
 * company-identity-and-trust.md). Both are real BLOCKERs for a fully complete
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
