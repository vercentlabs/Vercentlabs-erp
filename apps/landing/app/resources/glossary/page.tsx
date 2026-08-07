import Link from "next/link";
import { GLOSSARY_TERMS } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { DirectDefinition } from "@/components/modules/direct-definition";
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
      itemListElement: sorted.map((entry, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: entry.term,
      })),
    },
  };

  return (
    <>
      <TrackView event="glossary_index_view">
        <Section tone="page" className="pb-0 pt-6">
          <Container>
            <Breadcrumbs trail={breadcrumbTrail} />
          </Container>
        </Section>

        <Section tone="page" className="pt-10 sm:pt-12">
          <Container>
            <Stack gap={5} className="max-w-[780px]">
              <Text variant="eyebrow">Resources</Text>
              <Heading level="display" as="h1">
                ERP Glossary
              </Heading>
              <Text variant="lead">
                Real, plain-language definitions for the ERP and operations terms that come up most — from ERP and MRP to RBAC and maker-checker.
              </Text>
            </Stack>
          </Container>
        </Section>
      </TrackView>

      <DirectDefinition definition="This glossary defines the ERP, manufacturing, and operations terminology referenced throughout Vercentlabs' product and content — general industry definitions first, with real, cited detail on how Vercentlabs specifically implements the subset that connects directly to the product." />

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="A to Z" title={`${sorted.length} terms`} description="Terms with a full write-up link through; the rest link straight to the real product or workflow page that covers them." />
          <dl className="mt-10 flex flex-col divide-y divide-(--color-border-default) border-t border-(--color-border-default)">
            {sorted.map((entry) => {
              const href = glossaryHref(entry);
              return (
                <div key={entry.term} className="py-5">
                  <dt className="text-base font-semibold text-(--color-text-primary)">
                    {href ? (
                      <Link href={href} prefetch={false} className="hover:text-(--color-text-brand) hover:underline underline-offset-4">
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
        </Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
    </>
  );
}
