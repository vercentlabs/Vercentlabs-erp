import { IMPLEMENTATION_PAGE } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { ImplementationTimeline } from "@/components/implementation/implementation-timeline";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: IMPLEMENTATION_PAGE.title,
  description: IMPLEMENTATION_PAGE.metaDescription,
  path: IMPLEMENTATION_PAGE.slug,
});

export default function ImplementationPage() {
  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${IMPLEMENTATION_PAGE.title} — Vercentlabs ERP`,
    description: IMPLEMENTATION_PAGE.metaDescription,
    url: absoluteUrl(IMPLEMENTATION_PAGE.slug),
    isPartOf: { "@id": SOFTWARE_APPLICATION_ID },
  };

  const faqPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: IMPLEMENTATION_PAGE.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  return (
    <>
      <TrackView event="implementation_page_view">
        {/* Header is a sticky h-16 (4rem) bar — this wrapper fills exactly the
            remaining viewport height, so the hero neither leaves dead space
            above the next section nor requires a scroll to see all of it. */}
        <div className="flex min-h-[calc(100vh-4rem)] flex-col">
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container>
              <Breadcrumbs trail={[{ name: "Implementation", path: "/implementation" }]} />
            </Container>
          </Section>

          <Section tone="page" paddingTop={{ base: 12, sm: 16 }} className="flex flex-1 items-center">
            <Container>
              <Stack gap={5} className="max-w-[760px]">
                <Text variant="eyebrow">{IMPLEMENTATION_PAGE.eyebrow}</Text>
                <Heading level="display" as="h1">
                  {IMPLEMENTATION_PAGE.heading}
                </Heading>
                <Text variant="lead">{IMPLEMENTATION_PAGE.supportingText}</Text>
                <div>
                  <TrackedCtaLink href="/book-demo" event="implementation_cta_click" ctaLocation="implementation_hero">
                    {IMPLEMENTATION_PAGE.conversion.ctaLabel}
                  </TrackedCtaLink>
                </div>
              </Stack>
            </Container>
          </Section>
        </div>
      </TrackView>

      <DirectDefinition definition={IMPLEMENTATION_PAGE.directDefinition} />

      {/* 8-phase journey */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="The real methodology" title="Eight phases, discovery through post-launch." />
          <div className="mt-10">
            <ImplementationTimeline phases={IMPLEMENTATION_PAGE.phases} />
          </div>
        </Container>
      </Section>

      <ContextualCta
        prompt="Ready to talk through your real implementation scope?"
        href="/book-demo"
        event="implementation_cta_click"
        ctaLocation="implementation_mid"
      />

      {/* FAQs */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Straight answers" title="Questions buyers ask about implementation" />
          <FaqAccordion items={IMPLEMENTATION_PAGE.faqs} className="mt-10 max-w-[820px]" />
        </Container>
      </Section>

      {/* Related pages */}
      <Section tone="subtle">
        <Container>
          <Stack gap={4}>
            <Text variant="label">Related pages</Text>
            <RelatedPages
              pages={[
                { label: "Security & governance", href: "/security" },
                { label: "Explore the platform", href: "/product/platform" },
                { label: "See all industries", href: "/industries" },
              ]}
            />
          </Stack>
        </Container>
      </Section>

      {/* Final CTA */}
      <Section tone="inverse">
        <Container>
          <div className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              {IMPLEMENTATION_PAGE.conversion.heading}
            </Heading>
            <div className="mt-6 flex justify-center">
              <Inline gap={3}>
                <TrackedCtaLink href="/book-demo" event="implementation_cta_click" ctaLocation="implementation_final">
                  {IMPLEMENTATION_PAGE.conversion.ctaLabel}
                </TrackedCtaLink>
              </Inline>
            </div>
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
      <script {...jsonLdScriptProps(faqPageJsonLd)} />
    </>
  );
}
