import { createPageMetadata } from "@/lib/metadata";

import LegalPage, {
  type LegalSection,
} from "@/components/marketing/legal-page";
import { landingConfig } from "@/lib/landing-config";

export const metadata = createPageMetadata({
  title: "Website Terms",
  description:
    "Review the terms governing use of the VercentLabs public product website.",
  path: "/terms",
});

const sections: LegalSection[] = [
  {
    title: "1. Website purpose",
    paragraphs: [
      "The VercentLabs website provides information about a developing ERP platform, intended capabilities, implementation approach and partnership opportunities.",
      "The website does not itself provide authenticated production ERP functionality.",
    ],
  },
  {
    title: "2. No unsupported commitment",
    paragraphs: [
      "Product descriptions may explain planned or developing capabilities. They are not a guarantee that every described capability is currently available, suitable for a specific organisation or included in a future commercial agreement.",
      "Pricing, implementation scope, timelines, service levels, security commitments and warranties require a separate written agreement.",
    ],
  },
  {
    title: "3. Acceptable use",
    paragraphs: [
      "You must not misuse the website, attempt unauthorised access, disrupt operation, submit unlawful content, impersonate another person or use automated methods that create unreasonable load.",
    ],
  },
  {
    title: "4. Intellectual property",
    paragraphs: [
      "The VercentLabs name, product identity, website design, original content and software are protected to the extent permitted by applicable law.",
      "These terms do not transfer ownership or grant permission to copy, resell or misrepresent the product.",
    ],
  },
  {
    title: "5. Third-party services",
    paragraphs: [
      "The website may rely on or link to third-party hosting, communication, development or application services. Those services may apply their own terms and policies.",
    ],
  },
  {
    title: "6. Disclaimer",
    paragraphs: [
      "The public website is provided on an as-available basis. VercentLabs does not promise that all information will always be complete, current or error-free.",
      "Nothing on the website should be treated as legal, accounting, tax, security or professional implementation advice.",
    ],
  },
  {
    title: "7. Limitation and agreements",
    paragraphs: [
      "Any liability relating to a future paid ERP service must be governed by the signed commercial agreement for that service.",
      "To the extent permitted by applicable law, VercentLabs is not responsible for decisions made solely from preliminary marketing information.",
    ],
  },
  {
    title: "8. Contact",
    paragraphs: [
      "Questions about these website terms may be sent to " +
        landingConfig.contactEmail +
        ".",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Website Terms"
      description="Terms for using the public VercentLabs website while the ERP platform remains under active development."
      updated="12 July 2026"
      sections={sections}
    />
  );
}
