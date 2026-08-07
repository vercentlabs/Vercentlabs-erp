import { INTEGRATIONS_PAGE } from "@vercentlabs/landing-content";
import { PlatformPageTemplate } from "@/components/platform/platform-page-template";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: INTEGRATIONS_PAGE.title,
  description: INTEGRATIONS_PAGE.metaDescription,
  path: INTEGRATIONS_PAGE.slug,
});

export default function IntegrationsPage() {
  return (
    <PlatformPageTemplate
      content={INTEGRATIONS_PAGE}
      breadcrumbTrail={[
        { name: "Product", path: "/product" },
        { name: "Integrations & APIs", path: INTEGRATIONS_PAGE.slug },
      ]}
    />
  );
}
