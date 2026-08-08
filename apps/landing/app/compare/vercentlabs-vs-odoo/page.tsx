import { VERCENTLABS_VS_ODOO, ODOO_COMPARISON_EVIDENCE, EDITORIAL_SOURCES, getFreshness, CONTENT_AUTHORS } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Checklist } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ArticleHeader } from "@/components/content/article-header";
import { DecisionMatrix } from "@/components/content/decision-matrix";
import { Callout } from "@/components/content/callout";
import { SourceList } from "@/components/content/source-list";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

const AUTHOR = CONTENT_AUTHORS[0];

export const metadata = buildPageMetadata({
  title: `Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}`,
  description: VERCENTLABS_VS_ODOO.metaDescription,
  path: `/compare/${VERCENTLABS_VS_ODOO.slug}`,
});

export default function VercentlabsVsOdooPage() {
  const freshness = getFreshness(`/compare/${VERCENTLABS_VS_ODOO.slug}`);
  const usedSourceUrls = new Set(ODOO_COMPARISON_EVIDENCE.map((e) => e.sourceUrl));
  const usedSources = EDITORIAL_SOURCES.filter((source) => usedSourceUrls.has(source.url));

  const breadcrumbTrail = [
    { name: "Compare", path: "/compare" },
    { name: `Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}`, path: `/compare/${VERCENTLABS_VS_ODOO.slug}` },
  ];

  const techArticleJsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: `Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}`,
    description: VERCENTLABS_VS_ODOO.metaDescription,
    url: absoluteUrl(`/compare/${VERCENTLABS_VS_ODOO.slug}`),
    author: { "@type": "Organization", name: AUTHOR.name },
    datePublished: freshness.publishedAt,
    dateModified: freshness.lastModifiedAt,
    isPartOf: { "@id": SOFTWARE_APPLICATION_ID },
  };

  const faqPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: VERCENTLABS_VS_ODOO.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  return (
    <>
      <TrackView event="comparison_page_view" properties={{ section: VERCENTLABS_VS_ODOO.slug }}>
        {/* Header is a sticky h-16 (4rem) bar — this wrapper fills exactly the
            remaining viewport height, so the hero neither leaves dead space
            above the next section nor requires a scroll to see all of it. */}
        <div className="flex min-h-[calc(100vh-4rem)] flex-col">
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container>
              <Breadcrumbs trail={breadcrumbTrail} />
            </Container>
          </Section>

          <ArticleHeader
            eyebrow="Compare"
            title={`Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}`}
            dek={VERCENTLABS_VS_ODOO.directAnswer}
            author={AUTHOR}
            freshness={freshness}
          />
        </div>
      </TrackView>

      <Section tone="page">
        <Container>
          <Callout label="How to read this comparison">
            Every claim about {VERCENTLABS_VS_ODOO.competitor} on this page traces to a real, live-fetched source (see Sources below), verified on {freshness.lastReviewedAt}. Where a claim couldn&apos;t be independently verified, this page says so explicitly rather than guessing.
          </Callout>
        </Container>
      </Section>

      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow="Side by side" title="Where they actually differ" />
          <div className="mt-8">
            <DecisionMatrix
              rowHeader="Dimension"
              columns={[VERCENTLABS_VS_ODOO.competitor, "Vercentlabs"]}
              rows={VERCENTLABS_VS_ODOO.dimensions.map((dimension) => ({
                label: dimension.title,
                values: [dimension.odoo, dimension.vercentlabs],
              }))}
            />
          </div>
        </Container>
      </Section>

      <Section tone="page">
        <Container>
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-2">
            <Stack gap={4}>
              <Heading level="h2">Where {VERCENTLABS_VS_ODOO.competitor} may be the stronger fit</Heading>
              <Checklist items={VERCENTLABS_VS_ODOO.strongerFitForOdoo} />
            </Stack>
            <Stack gap={4}>
              <Heading level="h2">Where Vercentlabs may be the stronger fit</Heading>
              <Checklist items={VERCENTLABS_VS_ODOO.strongerFitForVercentlabs} />
            </Stack>
          </div>
        </Container>
      </Section>

      <ContextualCta prompt="See whether Vercentlabs fits your specific requirements." href="/book-demo" event="comparison_cta_click" ctaLocation="comparison_vercentlabs-vs-odoo" />

      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow="Straight answers" title="Questions buyers ask" />
          <FaqAccordion items={VERCENTLABS_VS_ODOO.faqs} className="mt-10 max-w-[820px]" />
        </Container>
      </Section>

      <Section tone="page">
        <Container>
          <SourceList sources={usedSources} className="max-w-[780px]" />
        </Container>
      </Section>

      <Section tone="subtle">
        <Container>
          <Stack gap={4}>
            <Text variant="label">Related pages</Text>
            <RelatedPages
              pages={[
                { label: "The ERP Buying Guide", href: "/resources/erp-buying-guide" },
                { label: "The ERP Requirements Checklist", href: "/resources/erp-requirements-checklist" },
                { label: "See all comparisons", href: "/compare" },
              ]}
            />
          </Stack>
        </Container>
      </Section>

      <Section tone="inverse">
        <Container>
          <div className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              See how Vercentlabs handles your specific requirements.
            </Heading>
            <div className="mt-6 flex justify-center">
              <TrackedCtaLink href="/book-demo" event="comparison_cta_click" ctaLocation="comparison_final_vercentlabs-vs-odoo">
                Book a Product Demo
              </TrackedCtaLink>
            </div>
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(techArticleJsonLd)} />
      <script {...jsonLdScriptProps(faqPageJsonLd)} />
    </>
  );
}
