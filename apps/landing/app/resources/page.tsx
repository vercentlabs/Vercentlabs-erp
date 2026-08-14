import Link from "next/link";
import { RESOURCE_GUIDES, RESOURCE_CATEGORIES, getFreshness } from "@vercentlabs/landing-content";
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
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container><Breadcrumbs trail={breadcrumbTrail} /></Container>
        </Section>
        <CollectionHero
          eyebrow="Resources"
          heading="ERP buying, implementation, and reference guides"
          supportingText="Evidence-grounded guidance for evaluating and implementing ERP software — vendor-neutral where the topic calls for it, specific where that is genuinely useful."
          listLabel="Published guides"
          items={RESOURCE_GUIDES.map((guide) => ({ label: guide.title, meta: guide.category, href: `/resources/${guide.slug}` }))}
          variant="resources"
        />
      </TrackView>

      <Reveal><DirectDefinition definition="This resource hub covers the ERP buying, implementation, and terminology questions a real evaluation runs into — a buying guide, a requirements checklist, an implementation checklist, a migration guide, a manufacturing ERP guide, an ERP-vs-spreadsheets breakdown, a glossary, and vendor comparisons." /></Reveal>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <div className="flex items-end justify-between gap-6 border-y border-(--color-border-strong) py-5">
            <div>
              <span className="vl-index">VERCENTLABS / REFERENCE JOURNAL</span>
              <p className="mt-2 text-sm font-semibold text-(--color-text-primary)">Guides organised by evaluation question, not publishing chronology.</p>
            </div>
            <span className="font-mono text-4xl font-semibold leading-none tracking-[-0.07em] text-(--color-text-primary)">{String(RESOURCE_GUIDES.length).padStart(2, "0")}</span>
          </div>
        </Container>
      </Section>

      {RESOURCE_CATEGORIES.map((category, categoryIndex) => {
        const guidesInCategory = RESOURCE_GUIDES.filter((guide) => guide.category === category);
        if (guidesInCategory.length === 0) return null;
        return (
          <Section key={category} tone={categoryIndex % 2 === 0 ? "page" : "subtle"} paddingTop={{ base: 10, sm: 14 }} paddingBottom={{ base: 10, sm: 14 }}>
            <Container>
              <div className="grid gap-8 lg:grid-cols-[190px_1fr] lg:gap-12">
                <div className="border-t border-(--color-border-strong) pt-4">
                  <span className="font-mono text-4xl font-semibold leading-none tracking-[-0.06em] text-(--color-border-strong)">{String(categoryIndex + 1).padStart(2, "0")}</span>
                  <Text variant="dataLabel" className="mt-3 block">Desk</Text>
                  <p className="mt-1 text-base font-semibold text-(--color-text-primary)">{category}</p>
                </div>
                <Reveal group>
                  <div className="border-y border-(--color-border-strong)">
                    {guidesInCategory.map((guide, index) => {
                      const freshness = getFreshness(`/resources/${guide.slug}`);
                      return (
                        <Link
                          key={guide.slug}
                          href={`/resources/${guide.slug}`}
                          prefetch={false}
                          data-reveal-item
                          style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}
                          className="group grid gap-4 border-t border-(--color-border-default) py-6 first:border-t-0 sm:grid-cols-[56px_minmax(210px,.72fr)_minmax(0,1fr)_130px] sm:gap-6 sm:py-7"
                        >
                          <span className="vl-index pt-1 text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                          <Heading level="h3" className="group-hover:text-(--color-text-brand)">{guide.title}</Heading>
                          <Text variant="bodySmall" className="max-w-[70ch]">{guide.dek}</Text>
                          <div className="sm:text-right">
                            <span className="vl-index">Published</span>
                            <p className="mt-1 text-[0.7rem] leading-relaxed text-(--color-text-muted)">{formatDate(freshness.publishedAt)}</p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </Reveal>
              </div>
            </Container>
          </Section>
        );
      })}

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Reference desks" title="Definitions and decisions." description="Two permanent desks sit beside the guides: a terminology index for shared language, and sourced comparisons for vendor evaluation." />
          <Reveal group>
            <div className="mt-10 grid border-l border-t border-(--color-border-strong) md:grid-cols-2">
              <Link href="/resources/glossary" prefetch={false} data-reveal-item className="group min-h-[260px] border-b border-r border-(--color-border-strong) bg-(--color-bg-elevated) p-7 sm:p-9">
                <span className="vl-index">DESK / A</span>
                <Heading level="h2" as="h3" className="mt-12 group-hover:text-(--color-text-brand)">ERP Glossary</Heading>
                <Text variant="body" className="mt-4 max-w-[60ch]">Real, plain-language definitions for the ERP and operations terms that come up most.</Text>
                <span className="vl-hover-arrow mt-8 block text-lg text-(--color-text-brand)" aria-hidden="true">→</span>
              </Link>
              <Link href="/compare" prefetch={false} data-reveal-item style={{ transitionDelay: "60ms" }} className="group min-h-[260px] border-b border-r border-(--color-border-strong) bg-(--color-bg-elevated) p-7 sm:p-9">
                <span className="vl-index">DESK / B</span>
                <Heading level="h2" as="h3" className="mt-12 group-hover:text-(--color-text-brand)">Compare Vercentlabs</Heading>
                <Text variant="body" className="mt-4 max-w-[60ch]">Evidence-backed, neutrally-framed comparisons against other ERP platforms.</Text>
                <span className="vl-hover-arrow mt-8 block text-lg text-(--color-text-brand)" aria-hidden="true">→</span>
              </Link>
            </div>
          </Reveal>
          <Text variant="caption" className="mt-7"><a href="/resources/feed.xml" className="vl-editorial-link text-(--color-text-brand)">RSS feed of new and updated resources</a></Text>
        </Container>
      </Section>

      <ContextualCta prompt="See how Vercentlabs handles the requirements that matter most to you." href="/book-demo" event="resource_cta_click" ctaLocation="resources_index_mid" />

      <Section tone="inverse" paddingTop={{ base: 14, sm: 18 }} paddingBottom={{ base: 14, sm: 18 }}>
        <Container>
          <Reveal className="grid items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <div className="max-w-[820px]">
              <span className="vl-index text-white/50">REFERENCE → WORKING SESSION</span>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">Ready to see it running on your own data?</Heading>
            </div>
            <TrackedCtaLink href="/book-demo" event="resource_cta_click" ctaLocation="resources_index_final">Book a Demo</TrackedCtaLink>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
