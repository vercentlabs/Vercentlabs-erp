import { ANALYTICS_PAGE } from "@vercentlabs/landing-content";
import { PlatformPageTemplate } from "@/components/platform/platform-page-template";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: ANALYTICS_PAGE.title,
  description: ANALYTICS_PAGE.metaDescription,
  path: ANALYTICS_PAGE.slug,
});

export default function AnalyticsPage() {
  return (
    <PlatformPageTemplate
      content={ANALYTICS_PAGE}
      breadcrumbTrail={[
        { name: "Product", path: "/product" },
        { name: "Reporting & Analytics", path: ANALYTICS_PAGE.slug },
      ]}
    />
  );
}
