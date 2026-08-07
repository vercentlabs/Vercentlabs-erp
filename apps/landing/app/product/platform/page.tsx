import { PLATFORM_PAGE } from "@vercentlabs/landing-content";
import { PlatformPageTemplate } from "@/components/platform/platform-page-template";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: PLATFORM_PAGE.title,
  description: PLATFORM_PAGE.metaDescription,
  path: PLATFORM_PAGE.slug,
});

export default function PlatformArchitecturePage() {
  return (
    <PlatformPageTemplate
      content={PLATFORM_PAGE}
      breadcrumbTrail={[
        { name: "Product", path: "/product" },
        { name: "Platform", path: PLATFORM_PAGE.slug },
      ]}
    />
  );
}
