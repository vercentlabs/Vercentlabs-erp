import { MOBILE_PAGE } from "@vercentlabs/landing-content";
import { EvidencePlatformPageTemplate } from "@/components/platform/evidence-platform-page-template";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: MOBILE_PAGE.title,
  description: MOBILE_PAGE.metaDescription,
  path: MOBILE_PAGE.slug,
});

export default function MobilePage() {
  return (
    <EvidencePlatformPageTemplate
      content={MOBILE_PAGE}
      visual={{
        eyebrow: "Mobile coverage",
        stat: "01",
        statLabel: "One native, offline-capable module today.",
        items: [
          { label: "Native & offline", detail: "CRM leads, opportunities, activities, and pipeline.", color: "var(--color-module-crm)" },
          { label: "Secure browser", detail: "Selected Procurement and platform workspaces.", color: "var(--color-module-procurement)" },
          { label: "Current boundary", detail: "The remaining modules are stated plainly as unavailable.", color: "var(--color-state-warning)" },
        ],
        definitionLabel: "What mobile covers",
        bodyEyebrow: "Coverage, without overclaiming",
        bodyTitle: "Native capability, secure handoff, and honest gaps.",
        bodyDescription: "Every mobile experience is labeled by what it actually is today.",
        moduleEyebrow: "Available paths",
        moduleTitle: "The modules with a real mobile access path today.",
      }}
      breadcrumbTrail={[
        { name: "Product", path: "/product" },
        { name: "Mobile", path: MOBILE_PAGE.slug },
      ]}
    />
  );
}
