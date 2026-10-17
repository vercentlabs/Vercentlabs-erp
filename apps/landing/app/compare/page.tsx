import Link from "next/link";
import { VERCENTLABS_VS_ODOO } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { CollectionHero } from "@/components/shared/collection-hero";
import { Reveal } from "@/components/motion/reveal";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Compare Vercentlabs",
  description: "Evidence-backed, neutrally-framed comparisons between Vercentlabs ERP and other ERP platforms — every claim sourced and dated.",
  path: "/compare",
});

export default function CompareIndexPage() {
  const breadcrumbTrail = [{ name: "Compare", path: "/compare" }];
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Compare Vercentlabs — Vercentlabs ERP",
    description: "Evidence-backed, neutrally-framed comparisons between Vercentlabs ERP and other ERP platforms.",
    url: absoluteUrl("/compare"),
    isPartOf: { "@id": SOFTWARE_APPLICATION_ID },
  };

  return (
    <>
      <TrackView event="compare_index_view">
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container><Breadcrumbs trail={breadcrumbTrail} /></Container>
        </Section>
        <CollectionHero
          eyebrow="Compare"
          heading="Compare Vercentlabs"
          supportingText="Evidence-led comparisons that show where each platform may be the stronger fit, with every material claim sourced and dated."
          listLabel="Live comparisons"
          items={[{ label: `Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}`, meta: "Evidence checked" }]}
          variant="compare"
        />
      </TrackView>

      <Reveal><DirectDefinition definition="This page indexes Vercentlabs' evidence-based ERP comparisons — currently one, against Odoo, with more added only where real intent, verifiable evidence, and a maintainable difference exist. See docs/landing-redesign/phase-6/comparison-policy.md for the standard every comparison here has to clear." /></Reveal>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Decision docket" title="One live comparison. A higher bar for every future one." description="A comparison is published only when the competitor claim can be independently verified, dated, and presented without turning the page into an attack ad." />
          <Reveal>
            <Link href={`/compare/${VERCENTLABS_VS_ODOO.slug}`} prefetch={false} className="group mt-10 block border-y border-(--color-border-strong) bg-(--color-bg-elevated)">
              <div className="grid lg:grid-cols-[160px_minmax(0,.8fr)_minmax(0,1.2fr)]">
                <div className="border-b border-(--color-border-default) p-6 lg:border-b-0 lg:border-r lg:p-8">
                  <span className="vl-index">DOCKET / 01</span>
                  <p className="mt-10 font-mono text-5xl font-semibold leading-none tracking-[-0.08em] text-(--color-border-strong)">VS</p>
                </div>
                <div className="border-b border-(--color-border-default) p-6 lg:border-b-0 lg:border-r lg:p-8">
                  <span className="vl-index">Case</span>
                  <Heading level="h2" as="h3" className="mt-6 group-hover:text-(--color-text-brand)">Vercentlabs vs. {VERCENTLABS_VS_ODOO.competitor}</Heading>
                  <div className="mt-8 grid grid-cols-2 border-y border-(--color-border-default) py-4">
                    <div className="border-r border-(--color-border-default)">
                      <span className="vl-index">Evidence</span>
                      <p className="mt-1 text-xs font-semibold text-(--color-text-primary)">Checked</p>
                    </div>
                    <div className="pl-4">
                      <span className="vl-index">Framing</span>
                      <p className="mt-1 text-xs font-semibold text-(--color-text-primary)">Neutral</p>
                    </div>
                  </div>
                </div>
                <div className="p-6 lg:p-8">
                  <span className="vl-index">Direct answer</span>
                  <Text variant="bodyLarge" className="mt-6 max-w-[66ch]">{VERCENTLABS_VS_ODOO.directAnswer}</Text>
                  <div className="mt-8 flex items-center justify-between border-t border-(--color-border-default) pt-4">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-(--color-text-brand)">Open comparison</span>
                    <span className="vl-hover-arrow text-xl text-(--color-text-brand)" aria-hidden="true">→</span>
                  </div>
                </div>
              </div>
            </Link>
          </Reveal>
        </Container>
      </Section>

      <Section tone="subtle" paddingTop={{ base: 12, sm: 16 }} paddingBottom={{ base: 12, sm: 16 }}>
        <Container>
          <div className="grid gap-8 border-y border-(--color-border-strong) py-8 lg:grid-cols-[180px_1fr] lg:gap-12">
            <span className="vl-index">Comparison policy</span>
            <div className="grid gap-8 md:grid-cols-3">
              {[
                ["Source it", "Material competitor claims must trace to a real source."],
                ["Date it", "The page states when evidence was reviewed so staleness is visible."],
                ["Admit fit", "If the other platform may be stronger for a buyer, the comparison says so."],
              ].map(([title, copy], index) => (
                <div key={title} className="border-t border-(--color-border-default) pt-4">
                  <span className="vl-index text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                  <p className="mt-3 text-base font-semibold text-(--color-text-primary)">{title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-(--color-text-secondary)">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      <ContextualCta prompt="See whether Vercentlabs fits your specific requirements." href="/book-demo" event="comparison_cta_click" ctaLocation="compare_index_mid" />

      <Section tone="inverse" paddingTop={{ base: 14, sm: 18 }} paddingBottom={{ base: 14, sm: 18 }}>
        <Container>
          <Reveal className="grid items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <div className="max-w-[820px]">
              <span className="vl-index text-white/50">DECISION DOCKET → LIVE PROOF</span>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">Ready to see it running on your own data?</Heading>
            </div>
            <TrackedCtaLink href="/book-demo" event="comparison_cta_click" ctaLocation="compare_index_final">Book a Demo</TrackedCtaLink>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
