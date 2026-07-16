import LegalPage, {
  type LegalSection,
} from "@/components/marketing/legal-page";
import { siteConfig } from "@/lib/site-config";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "VercentLabs ERP Terms",
  description:
    "Review website, trial, subscription, billing and acceptable-use terms for VercentLabs ERP.",
  path: "/terms",
});

const sections: LegalSection[] = [
  {
    title: "1. Scope and agreement",
    paragraphs: [
      "These terms govern use of the VercentLabs public website, trial workspaces and paid ERP subscriptions. A signed order form, implementation statement of work, data-processing agreement or service-level agreement may add or replace terms for a specific customer.",
      "Marketing descriptions explain the intended product and may include developing capabilities. Only capabilities confirmed in the applicable order form or product documentation are contractual commitments.",
    ],
  },
  {
    title: "2. Trials and account responsibility",
    paragraphs: [
      "A trial is intended for evaluation, may be limited by capacity and does not include a production service-level commitment. Trial data may be restricted or removed after the trial and applicable retention period.",
      "The customer is responsible for authorised users, accurate account information, access controls, lawful use and activity performed through its workspace.",
    ],
  },
  {
    title: "3. Subscription pricing and capacity",
    paragraphs: [
      "Standard plans include unlimited users but are limited by the subscribed operating capacity, such as companies, branches, storage, API requests, automation actions, outbound messages or other published entitlements.",
      "Taxes, implementation, migration, custom development, premium support, third-party provider charges, dedicated infrastructure, high-volume communication and AI consumption may be charged separately.",
      "VercentLabs may introduce fair-use limits or paid overages to protect service reliability and prevent one workspace from imposing unreasonable cost on other customers. Material commercial changes apply prospectively with reasonable notice unless required for security, law or provider changes.",
    ],
  },
  {
    title: "4. Billing, renewals and Razorpay",
    paragraphs: [
      "Subscriptions are generally billed in advance and renew automatically for the selected billing cycle until cancelled. Razorpay or another disclosed payment provider may process payment authorisation, recurring collections and provider invoices under its own terms and privacy practices.",
      "A customer must maintain a valid authorised payment method. Failed collections may be retried. Access may enter a grace period and later become read-only or suspended when payment remains overdue.",
      "Cancellation normally takes effect at the end of the current paid billing cycle. Fees already paid are non-refundable except where required by law or expressly agreed in writing. Implementation and custom-work fees are governed by the applicable statement of work.",
    ],
  },
  {
    title: "5. Customer data and acceptable use",
    paragraphs: [
      "The customer retains ownership of its business data and grants VercentLabs the limited rights needed to host, secure, process, back up and support the service.",
      "The service must not be used for unlawful activity, unauthorised access, malware, abusive messaging, infringement, fraudulent transactions, excessive automated load or processing prohibited data without an appropriate written agreement.",
    ],
  },
  {
    title: "6. Availability, support and changes",
    paragraphs: [
      "Unless a separate service-level agreement applies, the service is provided on a commercially reasonable, as-available basis. Maintenance, security response, provider outages and product improvements may affect availability.",
      "VercentLabs may update features, interfaces and limits while preserving paid value in a commercially reasonable manner. Beta or preview capabilities may change or be withdrawn.",
    ],
  },
  {
    title: "7. Suspension and termination",
    paragraphs: [
      "VercentLabs may suspend access for overdue payment, security risk, unlawful use, material breach or activity that threatens the service. Where practical, notice and an opportunity to cure will be provided.",
      "After termination, data export and deletion are governed by the applicable agreement, retention policy and legal obligations. Customers should export required records before access ends.",
    ],
  },
  {
    title: "8. Warranty and liability",
    paragraphs: [
      "VercentLabs does not provide legal, tax, accounting or regulatory advice. Customers remain responsible for business decisions, statutory filings, configuration review and verification of generated records.",
      "Liability limits, indemnities, warranties and dispute terms for production customers should be defined in the signed commercial agreement and reviewed by qualified legal counsel.",
    ],
  },
  {
    title: "9. Contact",
    paragraphs: [
      `Questions about these terms may be sent to ${siteConfig.email}.`,
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms for trials, subscriptions and ERP use"
      description="These terms describe the baseline commercial and acceptable-use rules for VercentLabs ERP."
      updated="16 July 2026"
      sections={sections}
    />
  );
}
