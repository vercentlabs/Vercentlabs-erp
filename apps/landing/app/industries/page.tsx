import Link from "next/link";
import { LANDING_INDUSTRIES } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { InformationBand } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CollectionHero } from "@/components/shared/collection-hero";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { Reveal } from "@/components/motion/reveal";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Industries",
  description: "See how Vercentlabs ERP runs manufacturing, distribution, retail, and professional-services operations — real module stacks and evidence, not generic ERP copy.",
  path: "/industries",
});

export default function IndustriesIndexPage() {
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Industries",
    description: "Vercentlabs ERP by industry: manufacturing, distribution, retail, and professional services.",
    url: absoluteUrl("/industries"),
    hasPart: LANDING_INDUSTRIES.map((industry) => ({
      "@type": "WebPage",
      name: industry.name,
      url: absoluteUrl(`/industries/${industry.slug}`),
    })),
  };

  return (
    <>
      <TrackView event="industries_index_view">
        {/* Header is a sticky h-16 (4rem) bar — this wrapper fills exactly the
            remaining viewport height, so the hero neither leaves dead space
            above the next section nor requires a scroll to see all of it. */}
        <div>
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container>
              <Breadcrumbs trail={[{ name: "Industries", path: "/industries" }]} />
            </Container>
          </Section>

          <CollectionHero
            eyebrow="Industries"
            heading="Built for how your industry actually operates."
            supportingText="A real operating model, module stack, and evidence specific to each industry — never generic ERP copy with the industry name swapped in."
            listLabel="Operating models"
            items={LANDING_INDUSTRIES.map((industry) => ({ label: industry.name, meta: `${industry.moduleStack.length} modules` }))}
          />
        </div>
      </TrackView>

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Choose your industry" title="Four operating models, each grounded in real capability." />
          <Reveal group>
            <div className="mt-10 flex flex-col">
              {LANDING_INDUSTRIES.map((industry, index) => (
                <InformationBand key={industry.slug} data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}>
                  <div className="sm:w-2/5">
                    <Link href={`/industries/${industry.slug}`} prefetch={false}>
                      <Heading level="h3">{industry.name}</Heading>
                    </Link>
                    <Text variant="bodySmall" className="mt-2 max-w-[52ch]">
                      {industry.directDefinition}
                    </Text>
                  </div>
                  <div className="sm:w-1/4">
                    <Text variant="caption">Primary modules</Text>
                    <Text variant="bodySmall" className="mt-1">
                      {industry.moduleStack.slice(0, 3).map((entry) => entry.moduleKey).join(", ")}
                    </Text>
                  </div>
                  <Link
                    href={`/industries/${industry.slug}`}
                    prefetch={false}
                    className="flex-none text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4"
                  >
                    View industry →
                  </Link>
                </InformationBand>
              ))}
            </div>
          </Reveal>
        </Container>
      </Section>

      <Section tone="inverse">
        <Container>
          <Reveal className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              See your industry&rsquo;s real operating model in a live demo.
            </Heading>
            <div className="mt-6 flex justify-center">
              <Inline gap={3}>
                <TrackedCtaLink href="/book-demo" event="industry_final_cta_click" ctaLocation="industries_index_final">
                  Book a Demo
                </TrackedCtaLink>
              </Inline>
            </div>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
