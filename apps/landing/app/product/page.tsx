import { PRODUCT_OVERVIEW_PAGE } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { Heading } from "@/components/ui/text";
import { LabeledItemGrid } from "@/components/ui/labeled-item-grid";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { PlatformHero } from "@/components/platform/platform-hero";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps } from "@/lib/seo/json-ld";

export const metadata = buildPageMetadata({
  title: PRODUCT_OVERVIEW_PAGE.title,
  description: PRODUCT_OVERVIEW_PAGE.metaDescription,
  path: PRODUCT_OVERVIEW_PAGE.slug,
});

export default function ProductOverviewPage() {
  const faqPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: PRODUCT_OVERVIEW_PAGE.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  return (
    <>
      <TrackView event="platform_page_view" properties={{ workflow: "product-overview" }}>
        <Section tone="page" className="pb-0 pt-6">
          <Container>
            <Breadcrumbs trail={[{ name: "Product", path: "/product" }]} />
          </Container>
        </Section>

        <PlatformHero
          eyebrow={PRODUCT_OVERVIEW_PAGE.eyebrow}
          heading={PRODUCT_OVERVIEW_PAGE.heading}
          supportingText={PRODUCT_OVERVIEW_PAGE.supportingText}
          heroScreenshotId={PRODUCT_OVERVIEW_PAGE.heroScreenshotId}
          ctaHref={PRODUCT_OVERVIEW_PAGE.primaryCta.href}
          ctaLabel={PRODUCT_OVERVIEW_PAGE.primaryCta.label}
          ctaEvent="platform_cta_click"
          ctaLocation="product_overview_hero"
        />
      </TrackView>

      <DirectDefinition definition={PRODUCT_OVERVIEW_PAGE.directDefinition} />

      {PRODUCT_OVERVIEW_PAGE.sections.map((section, index) => (
        <Section key={section.id} tone={index % 2 === 0 ? "page" : "subtle"}>
          <Container>
            <SectionHeader eyebrow={section.eyebrow} title={section.heading} description={section.supportingText} />
            {section.items && section.items.length > 0 ? (
              <div className="mt-10">
                <LabeledItemGrid items={section.items} columns={section.items.length >= 5 ? 3 : 2} />
              </div>
            ) : null}
          </Container>
        </Section>
      ))}

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Straight answers" title="Questions buyers ask about the platform" />
          <FaqAccordion items={PRODUCT_OVERVIEW_PAGE.faqs} className="mt-10 max-w-[820px]" />
        </Container>
      </Section>

      <Section tone="inverse">
        <Container>
          <div className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              See the connected platform in a live demo.
            </Heading>
            <div className="mt-6 flex justify-center">
              <TrackedCtaLink href={PRODUCT_OVERVIEW_PAGE.primaryCta.href} event="platform_cta_click" ctaLocation="product_overview_final">
                {PRODUCT_OVERVIEW_PAGE.primaryCta.label}
              </TrackedCtaLink>
            </div>
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(faqPageJsonLd)} />
    </>
  );
}
