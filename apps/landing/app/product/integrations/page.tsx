import { INTEGRATIONS_PAGE } from "@vercentlabs/landing-content";
import { EvidencePlatformPageTemplate } from "@/components/platform/evidence-platform-page-template";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: INTEGRATIONS_PAGE.title,
  description: INTEGRATIONS_PAGE.metaDescription,
  path: INTEGRATIONS_PAGE.slug,
});

export default function IntegrationsPage() {
  return (
    <EvidencePlatformPageTemplate
      content={INTEGRATIONS_PAGE}
      visual={{
        eyebrow: "Integration surface",
        stat: "04",
        statLabel: "Four evidenced connection mechanisms.",
        items: [
          { label: "Native sync", detail: "OAuth email and calendar connections inside CRM.", color: "var(--color-module-crm)" },
          { label: "Public API", detail: "HMAC-authenticated lead capture from external systems.", color: "var(--color-module-sales)" },
          { label: "Signed webhooks", detail: "Verified, replay-protected inbound events.", color: "var(--color-module-procurement)" },
          { label: "CSV movement", detail: "Previewed imports and injection-safe exports.", color: "var(--color-module-accounting)" },
        ],
        definitionLabel: "What integration means here",
        bodyEyebrow: "Clearly labeled connections",
        bodyTitle: "Native, API-supported, or configurable—never blurred together.",
        bodyDescription: "The implementation path and reliability safeguards are visible for every connection type.",
        moduleEyebrow: "Connected in product",
        moduleTitle: "CRM carries the evidenced integration surface today.",
      }}
      breadcrumbTrail={[
        { name: "Product", path: "/product" },
        { name: "Integrations & APIs", path: INTEGRATIONS_PAGE.slug },
      ]}
    />
  );
}
