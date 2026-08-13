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
        {/* Header is a sticky h-16 (4rem) bar — this wrapper fills exactly the
            remaining viewport height, so the hero neither leaves dead space
            above the next section nor requires a scroll to see all of it. */}
        <div>
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container>
              <Breadcrumbs trail={breadcrumbTrail} />
            </Container>
          </Section>

          <CollectionHero
            eyebrow="Compare"
            heading="Compare Vercentlabs"
            supportingText="Evidence-led comparisons that show where each platform may be the stronger fit, with every material claim sourced and dated."
            listLabel="Live comparisons"
            items={[{ label: `Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}`, meta: "Evidence checked" }]}
          />
        </div>
      </TrackView>

      <Reveal>
        <DirectDefinition definition="This page indexes Vercentlabs' evidence-based ERP comparisons — currently one, against Odoo, with more added only where real intent, verifiable evidence, and a maintainable difference exist. See docs/landing-redesign/phase-6/comparison-policy.md for the standard every comparison here has to clear." />
      </Reveal>

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Comparisons" title="1 comparison" />
          <Reveal>
            <div className="mt-8 flex flex-col divide-y divide-(--color-border-default) border-t border-(--color-border-default)">
              <Link href={`/compare/${VERCENTLABS_VS_ODOO.slug}`} prefetch={false} className="group py-6">
                <Heading level="h3" className="group-hover:text-(--color-text-brand)">
                  Vercentlabs vs. {VERCENTLABS_VS_ODOO.competitor}
                </Heading>
                <Text variant="body" className="mt-2 max-w-[70ch]">
                  {VERCENTLABS_VS_ODOO.directAnswer}
                </Text>
              </Link>
            </div>
          </Reveal>
        </Container>
      </Section>

      <ContextualCta
        prompt="See whether Vercentlabs fits your specific requirements."
        href="/book-demo"
        event="comparison_cta_click"
        ctaLocation="compare_index_mid"
      />

      <Section tone="inverse">
        <Container>
          <Reveal className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              Ready to see it running on your own data?
            </Heading>
            <div className="mt-6 flex justify-center">
              <TrackedCtaLink href="/book-demo" event="comparison_cta_click" ctaLocation="compare_index_final">
                Book a Demo
              </TrackedCtaLink>
            </div>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
