import { AUTOMATION_PAGE } from "@vercentlabs/landing-content";
import { AutomationPageTemplate } from "@/components/platform/automation-page-template";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: AUTOMATION_PAGE.title,
  description: AUTOMATION_PAGE.metaDescription,
  path: AUTOMATION_PAGE.slug,
});

export default function AutomationPage() {
  return (
    <AutomationPageTemplate
      content={AUTOMATION_PAGE}
      breadcrumbTrail={[
        { name: "Product", path: "/product" },
        { name: "Automation", path: AUTOMATION_PAGE.slug },
      ]}
    />
  );
}
