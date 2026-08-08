import { PRIVACY_PAGE } from "@vercentlabs/landing-content";
import { LegalPageBody } from "@/components/legal/legal-page-body";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: PRIVACY_PAGE.title,
  description: PRIVACY_PAGE.metaDescription,
  path: PRIVACY_PAGE.slug,
});

export default function PrivacyPage() {
  return <LegalPageBody content={PRIVACY_PAGE} />;
}
