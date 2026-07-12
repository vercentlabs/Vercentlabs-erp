import { createPageMetadata } from "@/lib/metadata";

import LegalPage, {
  type LegalSection,
} from "@/components/marketing/legal-page";
import { landingConfig } from "@/lib/landing-config";

export const metadata = createPageMetadata({
  title: "Privacy Policy",
  description:
    "Review how VercentLabs handles website, demo and account information.",
  path: "/privacy",
});

const sections: LegalSection[] = [
  {
    title: "1. Scope",
    paragraphs: [
      "This policy describes personal information handled through the public VercentLabs landing application, contact forms and early-access request forms.",
      "It does not yet describe customer production ERP processing. Any production service will require separate customer agreements, security documentation and processing terms.",
    ],
  },
  {
    title: "2. Information collected",
    paragraphs: [
      "VercentLabs may collect information that you choose to submit through the website.",
    ],
    bullets: [
      "Name, work email, phone number and organisation",
      "ERP interests, team size and business requirements",
      "Messages, partnership enquiries and implementation context",
      "Basic technical logs required to operate and secure the website",
    ],
  },
  {
    title: "3. Purposes",
    paragraphs: [
      "Submitted information is used to respond to enquiries, evaluate early-access or design-partner fit, plan product discussions, prevent abuse and maintain the website.",
    ],
  },
  {
    title: "4. Sharing",
    paragraphs: [
      "Information may be processed by hosting, communication, security or enquiry-management providers used by VercentLabs. Information is not presented as being sold to advertisers.",
      "Information may also be disclosed when required by applicable law or necessary to protect the rights, security and integrity of the company, users or services.",
    ],
  },
  {
    title: "5. Retention and security",
    paragraphs: [
      "Enquiry information should be retained only for as long as reasonably required for the stated purpose, business records, dispute handling and applicable legal obligations.",
      "Reasonable organisational and technical safeguards should be applied. No internet service can promise absolute security.",
    ],
  },
  {
    title: "6. Your choices",
    paragraphs: [
      "You may ask VercentLabs to review, correct or delete enquiry information, subject to applicable law and legitimate record-keeping requirements.",
      "Send privacy requests to " + landingConfig.contactEmail + ".",
    ],
  },
  {
    title: "7. Children",
    paragraphs: [
      "The public ERP website is intended for business and professional audiences and is not designed to knowingly collect personal information from children.",
    ],
  },
  {
    title: "8. Changes",
    paragraphs: [
      "This policy may change as the product, website, service providers and applicable obligations evolve. The updated date will be revised when material changes are published.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy Policy"
      description="A transparent description of the information currently handled through the VercentLabs public website."
      updated="12 July 2026"
      sections={sections}
    />
  );
}
