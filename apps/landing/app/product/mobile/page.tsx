import { MOBILE_PAGE } from "@vercentlabs/landing-content";
import { PlatformPageTemplate } from "@/components/platform/platform-page-template";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: MOBILE_PAGE.title,
  description: MOBILE_PAGE.metaDescription,
  path: MOBILE_PAGE.slug,
});

export default function MobilePage() {
  return (
    <PlatformPageTemplate
      content={MOBILE_PAGE}
      breadcrumbTrail={[
        { name: "Product", path: "/product" },
        { name: "Mobile", path: MOBILE_PAGE.slug },
      ]}
    />
  );
}
