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
  const breadcrumbTrail = [{ name: "Resources", path: "/resources" }, { name: "Glossary", path: "/resources/glossary" }];
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
        return { "@type": "ListItem", position: index + 1, name: entry.term, ...(href ? { item: absoluteUrl(href) } : {}) };
      }),
    },
  };

  return (
    <>
      <TrackView event="glossary_index_view">
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container><Breadcrumbs trail={breadcrumbTrail} /></Container>
        </Section>
        <CollectionHero
          eyebrow="Resources"
          heading="ERP Glossary"
          supportingText="Plain-language definitions for the ERP and operations terms that come up most — from ERP and MRP to RBAC and maker-checker."
          listLabel="Reference terms"
          items={sorted.map((entry) => ({ label: entry.term, meta: entry.standalone ? "Full guide" : "Definition" }))}
          variant="glossary"
        />
      </TrackView>

      <Reveal><DirectDefinition definition="This glossary defines the ERP, manufacturing, and operations terminology referenced throughout Vercentlabs' product and content — general industry definitions first, with real, cited detail on how Vercentlabs specifically implements the subset that connects directly to the product." /></Reveal>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Lexicon" title={`${sorted.length} terms, one operating language.`} description="Standalone terms open a full definition sheet. Index-only terms route to the product or workflow page that actually owns the concept." />
          <Reveal group>
            <ul className="mt-10 border-y border-(--color-border-strong)">
              {sorted.map((entry, index) => {
                const href = glossaryHref(entry);
                const initial = entry.term.charAt(0).toUpperCase();
                const row = (
                  <div className="group grid gap-4 py-5 sm:grid-cols-[60px_minmax(190px,.6fr)_minmax(0,1fr)_110px] sm:items-start sm:gap-6 sm:py-6">
                    <span className="font-mono text-2xl font-semibold leading-none tracking-[-0.05em] text-(--color-text-muted)" aria-hidden="true">{initial}</span>
                    <div>
                      <h3 className="text-base font-semibold text-(--color-text-primary) group-hover:text-(--color-text-brand)">{entry.term}</h3>
                      <span className="vl-index mt-1 block">{entry.standalone ? "TERM / FULL SHEET" : "TERM / ROUTED"}</span>
                    </div>
                    <p className="max-w-[76ch] text-sm leading-relaxed text-(--color-text-secondary)">{entry.shortDefinition}</p>
                    <span className="vl-index sm:text-right" aria-hidden="true">{String(index + 1).padStart(2, "0")} {href ? "→" : ""}</span>
                  </div>
                );
                return (
                  <li key={entry.term} data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 40}ms` }} className="border-t border-(--color-border-default) first:border-t-0">
                    {href ? <Link href={href} prefetch={false} className="block">{row}</Link> : row}
                  </li>
                );
              })}
            </ul>
          </Reveal>
        </Container>
      </Section>

      <ContextualCta prompt="See these terms in the actual product, not just a definition." href="/book-demo" event="resource_cta_click" ctaLocation="glossary_index_mid" />

      <Section tone="inverse" paddingTop={{ base: 14, sm: 18 }} paddingBottom={{ base: 14, sm: 18 }}>
        <Container>
          <Reveal className="grid items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <div className="max-w-[820px]">
              <span className="vl-index text-white/50">LEXICON → PRODUCT</span>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">Ready to see it running on your own data?</Heading>
            </div>
            <TrackedCtaLink href="/book-demo" event="resource_cta_click" ctaLocation="glossary_index_final">Book a Demo</TrackedCtaLink>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
    </>
  );
}
