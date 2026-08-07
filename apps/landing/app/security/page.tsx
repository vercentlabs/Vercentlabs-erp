import { SECURITY_PAGE } from "@vercentlabs/landing-content";
import { PlatformPageTemplate } from "@/components/platform/platform-page-template";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: SECURITY_PAGE.title,
  description: SECURITY_PAGE.metaDescription,
  path: SECURITY_PAGE.slug,
});

export default function SecurityPage() {
  return <PlatformPageTemplate content={SECURITY_PAGE} breadcrumbTrail={[{ name: "Security & Governance", path: SECURITY_PAGE.slug }]} />;
}
