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
        eyebrow: "Data movement",
        stat: "03",
        statLabel: "Three ways data moves in and out at launch.",
        items: [
          { label: "CSV import", detail: "Analyze, preview, commit, and rollback — available today for CRM leads.", color: "var(--color-module-crm)" },
          { label: "CSV export", detail: "Export for use in other tools — available today for CRM leads.", color: "var(--color-module-sales)" },
          { label: "PDF and print", detail: "Business documents produced as PDFs and printed.", color: "var(--color-module-accounting)" },
        ],
        definitionLabel: "What data import & export means here",
        bodyEyebrow: "Clearly labeled scope",
        bodyTitle: "Import, export, and documents — no connector catalogue implied.",
        bodyDescription: "Anything beyond these needs to be discussed, not assumed.",
        moduleEyebrow: "Where data moves today",
        moduleTitle: "Modules involved in getting data in and out.",
      }}
      breadcrumbTrail={[
        { name: "Product", path: "/product" },
        { name: "Data Import & Export", path: INTEGRATIONS_PAGE.slug },
      ]}
    />
  );
}
