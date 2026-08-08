import Link from "next/link";
import { LANDING_SOLUTIONS } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { InformationBand } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
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
        <div className="flex min-h-[calc(100vh-4rem)] flex-col">
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container>
              <Breadcrumbs trail={[{ name: "Solutions", path: "/solutions" }]} />
            </Container>
          </Section>

          <Section tone="page" paddingTop={{ base: 8, sm: 10 }} className="flex flex-1 items-center">
            <Container>
              <Stack gap={5} className="max-w-[760px]">
                <Text variant="eyebrow">Solutions</Text>
                <Heading level="display" as="h1">
                  Five real business problems, five real answers.
                </Heading>
                <Text variant="lead">
                  Not a repeat of the platform capability pages — each solution below starts from the actual problem, not the
                  feature that eventually solves it.
                </Text>
              </Stack>
            </Container>
          </Section>
        </div>
      </TrackView>

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Choose your problem" title="Start from what's actually broken." />
          <div className="mt-10 flex flex-col">
            {LANDING_SOLUTIONS.map((solution) => (
              <InformationBand key={solution.slug}>
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
        </Container>
      </Section>

      <Section tone="inverse">
        <Container>
          <div className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              See your real problem solved in a live demo.
            </Heading>
            <div className="mt-6 flex justify-center">
              <Inline gap={3}>
                <TrackedCtaLink href="/book-demo" event="solution_cta_click" ctaLocation="solutions_index_final">
                  Book a Product Demo
                </TrackedCtaLink>
              </Inline>
            </div>
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
