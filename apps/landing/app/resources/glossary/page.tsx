import Link from "next/link";
import { GLOSSARY_TERMS } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { Heading } from "@/components/ui/text";
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
  title: "ERP Glossary",
  description: "Plain-language definitions of ERP, manufacturing, and operations terminology — from ERP and MRP to RBAC and maker-checker — with real detail on how Vercentlabs implements the terms that matter most.",
  path: "/resources/glossary",
});

function glossaryHref(entry: (typeof GLOSSARY_TERMS)[number]): string | null {
  if (entry.standalone) return `/resources/glossary/${entry.slug}`;
  return entry.relatedRoute ?? null;
}

export default function GlossaryIndexPage() {
  const sorted = [...GLOSSARY_TERMS].sort((a, b) => a.term.localeCompare(b.term));

  const breadcrumbTrail = [
    { name: "Resources", path: "/resources" },
    { name: "Glossary", path: "/resources/glossary" },
  ];

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "ERP Glossary — Vercentlabs ERP",
    description: "Plain-language definitions of ERP, manufacturing, and operations terminology.",
    url: absoluteUrl("/resources/glossary"),
    isPartOf: { "@id": SOFTWARE_APPLICATION_ID },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: sorted.map((entry, index) => {
        const href = glossaryHref(entry);
        return {
          "@type": "ListItem",
          position: index + 1,
          name: entry.term,
          ...(href ? { item: absoluteUrl(href) } : {}),
        };
      }),
    },
  };

  return (
    <>
      <TrackView event="glossary_index_view">
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
            eyebrow="Resources"
            heading="ERP Glossary"
            supportingText="Plain-language definitions for the ERP and operations terms that come up most — from ERP and MRP to RBAC and maker-checker."
            listLabel="Reference terms"
            items={sorted.map((entry) => ({ label: entry.term, meta: entry.standalone ? "Full guide" : "Definition" }))}
          />
        </div>
      </TrackView>

      <Reveal>
        <DirectDefinition definition="This glossary defines the ERP, manufacturing, and operations terminology referenced throughout Vercentlabs' product and content — general industry definitions first, with real, cited detail on how Vercentlabs specifically implements the subset that connects directly to the product." />
      </Reveal>

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="A to Z" title={`${sorted.length} terms`} description="Terms with a full write-up link through; the rest link straight to the real product or workflow page that covers them." />
          <Reveal group>
            <dl className="mt-10 flex flex-col divide-y divide-(--color-border-default) border-t border-(--color-border-default)">
              {sorted.map((entry, index) => {
                const href = glossaryHref(entry);
                return (
                  <div key={entry.term} className="py-5" data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}>
                    <dt className="text-base font-semibold text-(--color-text-primary)">
                      {href ? (
                        <Link
                          href={href}
                          prefetch={false}
                          className="underline decoration-(--color-border-strong) underline-offset-4 hover:text-(--color-text-brand) hover:decoration-(--color-text-brand)"
                        >
                          {entry.term}
                        </Link>
                      ) : (
                        entry.term
                      )}
                    </dt>
                    <dd className="mt-1.5 max-w-[70ch] text-sm leading-relaxed text-(--color-text-secondary)">{entry.shortDefinition}</dd>
                  </div>
                );
              })}
            </dl>
          </Reveal>
        </Container>
      </Section>

      <ContextualCta
        prompt="See these terms in the actual product, not just a definition."
        href="/book-demo"
        event="resource_cta_click"
        ctaLocation="glossary_index_mid"
      />

      <Section tone="inverse">
        <Container>
          <Reveal className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              Ready to see it running on your own data?
            </Heading>
            <div className="mt-6 flex justify-center">
              <TrackedCtaLink href="/book-demo" event="resource_cta_click" ctaLocation="glossary_index_final">
                Book a Demo
              </TrackedCtaLink>
            </div>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
    </>
  );
}
