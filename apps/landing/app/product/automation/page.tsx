import { AUTOMATION_PAGE } from "@vercentlabs/landing-content";
import { PlatformPageTemplate } from "@/components/platform/platform-page-template";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: AUTOMATION_PAGE.title,
  description: AUTOMATION_PAGE.metaDescription,
  path: AUTOMATION_PAGE.slug,
});

export default function AutomationPage() {
  return (
    <PlatformPageTemplate
      content={AUTOMATION_PAGE}
      breadcrumbTrail={[
        { name: "Product", path: "/product" },
        { name: "Automation", path: AUTOMATION_PAGE.slug },
      ]}
    />
  );
}
