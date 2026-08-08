import { TERMS_PAGE } from "@vercentlabs/landing-content";
import { LegalPageBody } from "@/components/legal/legal-page-body";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: TERMS_PAGE.title,
  description: TERMS_PAGE.metaDescription,
  path: TERMS_PAGE.slug,
});

export default function TermsPage() {
  return <LegalPageBody content={TERMS_PAGE} />;
}
