import LegalPage, {
  type LegalSection,
} from "@/components/marketing/legal-page";
import { siteConfig } from "@/lib/site-config";
import { createPageMetadata } from "@/lib/metadata";

export const metadata = createPageMetadata({
  title: "Vercentlabs Privacy Policy",
  description:
    "Review how Vercentlabs handles website, workspace, billing and payment-related personal information.",
  path: "/privacy",
});

const sections: LegalSection[] = [
  {
    title: "1. Scope",
    paragraphs: [
      "This policy covers personal information handled through the Vercentlabs website, enquiries, trials, authenticated ERP workspaces, support and subscription billing.",
      "A customer organisation controls the business data it enters into the ERP. A production agreement should identify controller, processor and sub-processor responsibilities for that deployment.",
    ],
  },
  {
    title: "2. Information collected",
    paragraphs: [
      "We may collect account identity, contact details, organisation information, access logs, security events, support communications, product usage, billing profile, GSTIN, invoice details and subscription status.",
      "Payment credentials are entered into the payment provider's checkout. Vercentlabs stores provider identifiers, payment status, amounts, fees, tax and invoice metadata needed for reconciliation, but should not store full card, bank or UPI credentials.",
    ],
  },
  {
    title: "3. Purposes",
    paragraphs: [
      "Information is used to create and secure accounts, provide the ERP, enforce permissions and plan limits, process subscriptions, reconcile payments, prevent abuse, deliver support, maintain audit history and meet legal obligations.",
      "Product analytics should be minimised and used to improve reliability, adoption and cost planning rather than to sell personal information.",
    ],
  },
  {
    title: "4. Payment providers and processors",
    paragraphs: [
      "Razorpay or another disclosed provider may process payment authorisation, mandates and collections. The provider receives information required to complete the transaction and applies its own terms and privacy policy.",
      "Hosting, email, monitoring, support and infrastructure providers may process limited information under contractual and security controls appropriate to their role.",
    ],
  },
  {
    title: "5. Security and access",
    paragraphs: [
      "Vercentlabs uses role-based access, organisation scoping, session controls, audit records and technical safeguards designed to protect information. No service can guarantee absolute security.",
      "Customers are responsible for configuring access, protecting credentials, reviewing authorised users and promptly reporting suspected compromise.",
    ],
  },
  {
    title: "6. Retention and deletion",
    paragraphs: [
      "Information is retained while needed to provide the service, resolve disputes, reconcile financial records, maintain security evidence and satisfy legal or contractual requirements.",
      "Payment, invoice, audit and tax-related records may require longer retention than ordinary workspace content. Deletion requests are evaluated against those obligations.",
    ],
  },
  {
    title: "7. Rights and choices",
    paragraphs: [
      "Depending on applicable law and the customer's role, a person may request access, correction, export, withdrawal of consent or deletion. Requests involving customer-controlled ERP data may need to be directed to the relevant customer organisation.",
      "Marketing communication preferences can be changed without affecting essential account, security or billing notices.",
    ],
  },
  {
    title: "8. Contact",
    paragraphs: [
      `Privacy questions may be sent to ${siteConfig.email}. Production customers should also use the privacy and security contacts stated in their signed agreement.`,
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy across the website, ERP workspace and billing"
      description="This policy explains the baseline handling of account, business, usage and subscription information."
      updated="16 July 2026"
      sections={sections}
    />
  );
}
