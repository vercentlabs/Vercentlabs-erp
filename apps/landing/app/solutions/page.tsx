import Link from "next/link";
import { LANDING_SOLUTIONS } from "@vercentlabs/landing-content";
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
  title: "Solutions",
  description: "Real business problems Vercentlabs ERP solves — replacing spreadsheets, connecting operations, running multiple companies, automating governed workflows, and real-time reporting.",
  path: "/solutions",
});

export default function SolutionsIndexPage() {
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Solutions",
    description: "Vercentlabs ERP by business problem, not just by module or industry.",
    url: absoluteUrl("/solutions"),
    hasPart: LANDING_SOLUTIONS.map((solution) => ({
      "@type": "WebPage",
      name: solution.name,
      url: absoluteUrl(`/solutions/${solution.slug}`),
    })),
  };

  return (
    <>
      <TrackView event="solutions_index_view">
        {/* Header is a sticky h-16 (4rem) bar — this wrapper fills exactly the
            remaining viewport height, so the hero neither leaves dead space
            above the next section nor requires a scroll to see all of it. */}
        <div>
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container>
              <Breadcrumbs trail={[{ name: "Solutions", path: "/solutions" }]} />
            </Container>
          </Section>

          <CollectionHero
            eyebrow="Solutions"
            heading="Five real business problems, five real answers."
            supportingText="Each solution starts from the actual operating problem, then shows the connected capability that resolves it."
            listLabel="Business outcomes"
            items={LANDING_SOLUTIONS.map((solution) => ({ label: solution.name }))}
          />
        </div>
      </TrackView>

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Choose your problem" title="Start from what's actually broken." />
          <Reveal group>
            <div className="mt-10 flex flex-col">
              {LANDING_SOLUTIONS.map((solution, index) => (
                <InformationBand key={solution.slug} data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}>
                  <div className="sm:w-3/5">
                    <Link href={`/solutions/${solution.slug}`} prefetch={false}>
                      <Heading level="h3">{solution.name}</Heading>
                    </Link>
                    <Text variant="bodySmall" className="mt-2 max-w-[60ch]">
                      {solution.problemStatement}
                    </Text>
                  </div>
                  <Link
                    href={`/solutions/${solution.slug}`}
                    prefetch={false}
                    className="flex-none text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4"
                  >
                    View solution →
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
              See your real problem solved in a live demo.
            </Heading>
            <div className="mt-6 flex justify-center">
              <Inline gap={3}>
                <TrackedCtaLink href="/book-demo" event="solution_cta_click" ctaLocation="solutions_index_final">
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
