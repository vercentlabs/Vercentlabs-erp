import { IMPLEMENTATION_PAGE } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { ImplementationTimeline } from "@/components/implementation/implementation-timeline";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { CollectionHero } from "@/components/shared/collection-hero";
import { RelatedPages } from "@/components/modules/related-pages";
import { Reveal } from "@/components/motion/reveal";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export const metadata = buildPageMetadata({ title: IMPLEMENTATION_PAGE.title, description: IMPLEMENTATION_PAGE.metaDescription, path: IMPLEMENTATION_PAGE.slug });

export default function ImplementationPage() {
  const webPageJsonLd = { "@context": "https://schema.org", "@type": "WebPage", name: `${IMPLEMENTATION_PAGE.title} — Vercentlabs ERP`, description: IMPLEMENTATION_PAGE.metaDescription, url: absoluteUrl(IMPLEMENTATION_PAGE.slug), isPartOf: { "@id": SOFTWARE_APPLICATION_ID } };
  const faqPageJsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: IMPLEMENTATION_PAGE.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) };

  return (
    <>
      <TrackView event="implementation_page_view">
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}><Container><Breadcrumbs trail={[{ name: "Implementation", path: "/implementation" }]} /></Container></Section>
        <CollectionHero
          eyebrow={IMPLEMENTATION_PAGE.eyebrow}
          heading={IMPLEMENTATION_PAGE.heading}
          supportingText={IMPLEMENTATION_PAGE.supportingText}
          listLabel="Implementation phases"
          items={IMPLEMENTATION_PAGE.phases.map((phase) => ({ label: phase.name, meta: `${phase.activities.length} activities` }))}
          variant="implementation"
        />
      </TrackView>

      <Reveal><DirectDefinition definition={IMPLEMENTATION_PAGE.directDefinition} /></Reveal>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <div className="mb-10 grid gap-7 border-y border-(--color-border-strong) py-6 lg:grid-cols-[170px_1fr] lg:gap-12">
            <span className="vl-index">ROLLOUT CONTROL / 01</span>
            <div className="grid gap-6 sm:grid-cols-3">
              {[
                ["Scope before configuration", "Decide operating scope, owners and constraints before changing the system."],
                ["Data before go-live", "Migration, reconciliation and ownership are treated as implementation work, not an upload task."],
                ["Adoption after launch", "Post-launch support and operating discipline are part of the methodology, not an afterthought."],
              ].map(([title, copy], index) => (
                <div key={title} className="border-t border-(--color-border-default) pt-4">
                  <span className="vl-index text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                  <p className="mt-3 text-sm font-semibold text-(--color-text-primary)">{title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-(--color-text-secondary)">{copy}</p>
                </div>
              ))}
            </div>
          </div>
          <SectionHeader eyebrow="The rollout" title="Eight gates from discovery to post-launch." description="Each phase has a purpose, named activities and tangible outputs. The timeline is designed to make implementation legible before a project starts." />
          <Reveal><div className="mt-10"><ImplementationTimeline phases={IMPLEMENTATION_PAGE.phases} /></div></Reveal>
        </Container>
      </Section>

      <ContextualCta prompt="Ready to talk through your real implementation scope?" href="/book-demo" event="implementation_cta_click" ctaLocation="implementation_mid" />

      <Section tone="subtle" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Buyer questions" title="Implementation questions deserve operational answers." description="The FAQ stays practical: scope, migration, rollout, adoption and the things teams need to know before committing." />
          <FaqAccordion items={IMPLEMENTATION_PAGE.faqs} className="mt-10 max-w-[880px]" />
        </Container>
      </Section>

      <Section tone="page" paddingTop={{ base: 10, sm: 12 }} paddingBottom={{ base: 10, sm: 12 }}>
        <Container>
          <div className="grid gap-7 border-y border-(--color-border-strong) py-7 lg:grid-cols-[170px_1fr] lg:gap-12">
            <Text variant="dataLabel">Related operating documents</Text>
            <Stack gap={4}><RelatedPages pages={[{ label: "Security & governance", href: "/security" }, { label: "Explore the platform", href: "/product/platform" }, { label: "See all industries", href: "/industries" }]} /></Stack>
          </div>
        </Container>
      </Section>

      <Section tone="inverse" paddingTop={{ base: 14, sm: 18 }} paddingBottom={{ base: 14, sm: 18 }}>
        <Container>
          <Reveal className="grid items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <div className="max-w-[820px]">
              <span className="vl-index text-white/50">ROLLOUT PLAN → WORKING SESSION</span>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">{IMPLEMENTATION_PAGE.conversion.heading}</Heading>
            </div>
            <TrackedCtaLink href="/book-demo" event="implementation_cta_click" ctaLocation="implementation_final">{IMPLEMENTATION_PAGE.conversion.ctaLabel}</TrackedCtaLink>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
      <script {...jsonLdScriptProps(faqPageJsonLd)} />
    </>
  );
}
