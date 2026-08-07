import Link from "next/link";
import { LANDING_INDUSTRIES } from "@vercentlabs/landing-content";
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
        <Section tone="page" className="pb-0 pt-6">
          <Container>
            <Breadcrumbs trail={[{ name: "Industries", path: "/industries" }]} />
          </Container>
        </Section>

        <Section tone="page" className="pt-8 sm:pt-10">
          <Container>
            <Stack gap={5} className="max-w-[760px]">
              <Text variant="eyebrow">Industries</Text>
              <Heading level="display" as="h1">
                Built for how your industry actually operates.
              </Heading>
              <Text variant="lead">
                Not a generic ERP page with your industry name inserted — a real operating model, module stack, and evidence
                specific to each of the four industries below.
              </Text>
            </Stack>
          </Container>
        </Section>
      </TrackView>

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Choose your industry" title="Four operating models, each grounded in real capability." />
          <div className="mt-10 flex flex-col">
            {LANDING_INDUSTRIES.map((industry) => (
              <InformationBand key={industry.slug}>
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
        </Container>
      </Section>

      <Section tone="inverse">
        <Container>
          <div className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              See your industry&rsquo;s real operating model in a live demo.
            </Heading>
            <div className="mt-6 flex justify-center">
              <Inline gap={3}>
                <TrackedCtaLink href="/book-demo" event="industry_final_cta_click" ctaLocation="industries_index_final">
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
