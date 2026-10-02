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
        eyebrow: "Responsive access",
        stat: "01",
        statLabel: "One browser-based application, on every screen size.",
        items: [
          { label: "Responsive UI", detail: "Layouts adapt to desktop, tablet, and phone browsers.", color: "var(--color-module-crm)" },
          { label: "Same access rules", detail: "The same sign-in, roles, and permissions on every device.", color: "var(--color-module-accounting)" },
          { label: "Current boundary", detail: "No native app and no offline mode at launch.", color: "var(--color-state-warning)" },
        ],
        definitionLabel: "What responsive access covers",
        bodyEyebrow: "Coverage, without overclaiming",
        bodyTitle: "A responsive web application — not a native app.",
        bodyDescription: "Every screen is the same browser-based application, adapted to the device.",
        moduleEyebrow: "Used on the move",
        moduleTitle: "Modules people often open from a phone or tablet browser.",
      }}
      breadcrumbTrail={[
        { name: "Product", path: "/product" },
        { name: "Responsive Access", path: MOBILE_PAGE.slug },
      ]}
    />
  );
}
