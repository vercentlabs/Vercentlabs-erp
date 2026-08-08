import Link from "next/link";
import { RESOURCE_GUIDES, RESOURCE_CATEGORIES, getFreshness } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Resources",
  description: "ERP buying guides, implementation checklists, a requirements checklist, a glossary, and comparisons — real, evidence-grounded content for evaluating and implementing ERP software.",
  path: "/resources",
});

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export default function ResourcesIndexPage() {
  const breadcrumbTrail = [{ name: "Resources", path: "/resources" }];

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Resources — Vercentlabs ERP",
    description: "ERP buying guides, implementation checklists, a requirements checklist, a glossary, and comparisons.",
    url: absoluteUrl("/resources"),
    isPartOf: { "@id": SOFTWARE_APPLICATION_ID },
  };

  return (
    <>
      <TrackView event="resources_index_view">
        {/* Header is a sticky h-16 (4rem) bar — this wrapper fills exactly the
            remaining viewport height, so the hero neither leaves dead space
            above the next section nor requires a scroll to see all of it. */}
        <div className="flex min-h-[calc(100vh-4rem)] flex-col">
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container>
              <Breadcrumbs trail={breadcrumbTrail} />
            </Container>
          </Section>

          <Section tone="page" paddingTop={{ base: 10, sm: 12 }} className="flex flex-1 items-center">
            <Container>
              <Stack gap={5} className="max-w-[780px]">
                <Text variant="eyebrow">Resources</Text>
                <Heading level="display" as="h1">
                  ERP buying, implementation, and reference guides
                </Heading>
                <Text variant="lead">
                  Real, evidence-grounded guides for evaluating and implementing ERP software — vendor-neutral where the topic calls for it, specific about Vercentlabs where that&apos;s genuinely useful.
                </Text>
              </Stack>
            </Container>
          </Section>
        </div>
      </TrackView>

      <DirectDefinition definition="This resource hub covers the ERP buying, implementation, and terminology questions a real evaluation runs into — a buying guide, a requirements checklist, an implementation checklist, a migration guide, a manufacturing ERP guide, an ERP-vs-spreadsheets breakdown, a glossary, and vendor comparisons." />

      {RESOURCE_CATEGORIES.map((category) => {
        const guidesInCategory = RESOURCE_GUIDES.filter((guide) => guide.category === category);
        if (guidesInCategory.length === 0) return null;
        return (
          <Section key={category} tone={RESOURCE_CATEGORIES.indexOf(category) % 2 === 0 ? "page" : "subtle"}>
            <Container>
              <SectionHeader eyebrow={category} title={category} />
              <div className="mt-8 flex flex-col divide-y divide-(--color-border-default) border-t border-(--color-border-default)">
                {guidesInCategory.map((guide) => {
                  const freshness = getFreshness(`/resources/${guide.slug}`);
                  return (
                    <Link key={guide.slug} href={`/resources/${guide.slug}`} prefetch={false} className="group py-6">
                      <Heading level="h3" className="group-hover:text-(--color-text-brand)">
                        {guide.title}
                      </Heading>
                      <Text variant="body" className="mt-2 max-w-[70ch]">
                        {guide.dek}
                      </Text>
                      <Text variant="caption" className="mt-2">
                        Published {formatDate(freshness.publishedAt)}
                      </Text>
                    </Link>
                  );
                })}
              </div>
            </Container>
          </Section>
        );
      })}

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Reference" title="Glossary and comparisons" />
          <div className="mt-8 flex flex-col divide-y divide-(--color-border-default) border-t border-(--color-border-default)">
            <Link href="/resources/glossary" prefetch={false} className="group py-6">
              <Heading level="h3" className="group-hover:text-(--color-text-brand)">
                ERP Glossary
              </Heading>
              <Text variant="body" className="mt-2 max-w-[70ch]">
                Real, plain-language definitions for the ERP and operations terms that come up most.
              </Text>
            </Link>
            <Link href="/compare" prefetch={false} className="group py-6">
              <Heading level="h3" className="group-hover:text-(--color-text-brand)">
                Compare Vercentlabs
              </Heading>
              <Text variant="body" className="mt-2 max-w-[70ch]">
                Evidence-backed, neutrally-framed comparisons against other ERP platforms.
              </Text>
            </Link>
          </div>
          <Text variant="caption" className="mt-8">
            <a href="/resources/feed.xml" className="hover:text-(--color-text-brand) hover:underline underline-offset-4">
              RSS feed
            </a>{" "}
            of new and updated resources.
          </Text>
        </Container>
      </Section>

      <ContextualCta
        prompt="See how Vercentlabs handles the requirements that matter most to you."
        href="/book-demo"
        event="resource_cta_click"
        ctaLocation="resources_index_mid"
      />

      <Section tone="inverse">
        <Container>
          <div className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              Ready to see it running on your own data?
            </Heading>
            <div className="mt-6 flex justify-center">
              <TrackedCtaLink href="/book-demo" event="resource_cta_click" ctaLocation="resources_index_final">
                Book a Product Demo
              </TrackedCtaLink>
            </div>
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
