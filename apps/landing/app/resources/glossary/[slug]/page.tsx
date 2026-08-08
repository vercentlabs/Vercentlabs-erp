import { notFound } from "next/navigation";
import Link from "next/link";
import { STANDALONE_GLOSSARY_SLUGS, getGlossaryTerm, getLandingModule, getWorkflow, getFreshness, CONTENT_AUTHORS } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { BorderedPanel } from "@/components/ui/card";
import { ModuleTag } from "@/components/ui/tag";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ArticleHeader } from "@/components/content/article-header";
import { DefinitionBlock } from "@/components/content/definition-block";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
import { TrackView } from "@/components/analytics/track-view";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

const AUTHOR = CONTENT_AUTHORS[0];

export function generateStaticParams() {
  return STANDALONE_GLOSSARY_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = getGlossaryTerm(slug);
  if (!entry) return {};
  return buildPageMetadata({
    title: `${entry.term} — ERP Glossary`,
    description: entry.shortDefinition,
    path: `/resources/glossary/${entry.slug}`,
  });
}

export default async function GlossaryTermPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!STANDALONE_GLOSSARY_SLUGS.includes(slug)) notFound();
  const entry = getGlossaryTerm(slug);
  if (!entry) notFound();

  const relatedModules = entry.relatedModules.map((key) => getLandingModule(key)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const relatedWorkflow = entry.relatedWorkflow ? getWorkflow(entry.relatedWorkflow) : null;
  const relatedTermEntries = entry.relatedTerms.map((relatedSlug) => getGlossaryTerm(relatedSlug)).filter((t): t is NonNullable<typeof t> => Boolean(t));
  const freshness = getFreshness(`/resources/glossary/${entry.slug}`);

  const breadcrumbTrail = [
    { name: "Resources", path: "/resources" },
    { name: "Glossary", path: "/resources/glossary" },
    { name: entry.term, path: `/resources/glossary/${entry.slug}` },
  ];

  const definedTermJsonLd = {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name: entry.term,
    description: entry.definition,
    url: absoluteUrl(`/resources/glossary/${entry.slug}`),
    inDefinedTermSet: absoluteUrl("/resources/glossary"),
  };

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${entry.term} — Vercentlabs ERP Glossary`,
    description: entry.shortDefinition,
    url: absoluteUrl(`/resources/glossary/${entry.slug}`),
    isPartOf: { "@id": SOFTWARE_APPLICATION_ID },
    dateModified: freshness.lastModifiedAt,
  };

  return (
    <>
      <TrackView event="glossary_page_view" properties={{ section: entry.slug }}>
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container>
            <Breadcrumbs trail={breadcrumbTrail} />
          </Container>
        </Section>

        <ArticleHeader eyebrow="Glossary" title={entry.term} dek={entry.shortDefinition} author={AUTHOR} freshness={freshness} />
      </TrackView>

      <Section tone="page">
        <Container>
          <Stack gap={10} className="max-w-[820px]">
            <DefinitionBlock term={entry.term} definition={entry.definition} />

            <Stack gap={3}>
              <Heading level="h2">Why it matters</Heading>
              <Text variant="body">{entry.whyItMatters}</Text>
            </Stack>

            <Stack gap={3}>
              <Heading level="h2">How it works</Heading>
              <Text variant="body">{entry.howItWorks}</Text>
            </Stack>

            <Stack gap={3}>
              <Heading level="h2">Example</Heading>
              <Text variant="body">{entry.example}</Text>
            </Stack>

            <BorderedPanel>
              <Text variant="label">How Vercentlabs handles it</Text>
              <Text variant="body" className="mt-2">
                {entry.vercentlabsHandling}
              </Text>
              <Inline gap={2} className="mt-4 flex-wrap">
                {relatedModules.map((moduleInfo) => (
                  <Link key={moduleInfo.key} href={`/modules/${moduleInfo.key}`} prefetch={false}>
                    <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
                  </Link>
                ))}
              </Inline>
              {relatedWorkflow ? (
                <Link
                  href={`/workflows/${relatedWorkflow.slug}`}
                  prefetch={false}
                  className="mt-4 inline-block text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4"
                >
                  See the {relatedWorkflow.name} workflow →
                </Link>
              ) : null}
            </BorderedPanel>
          </Stack>
        </Container>
      </Section>

      {relatedTermEntries.length > 0 ? (
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow="Keep exploring" title="Related terms" />
            <Inline gap={4} className="mt-6 flex-wrap">
              {relatedTermEntries.map((related) => (
                <Link
                  key={related.slug}
                  href={`/resources/glossary/${related.slug}`}
                  prefetch={false}
                  className="text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4"
                >
                  {related.term} →
                </Link>
              ))}
            </Inline>
          </Container>
        </Section>
      ) : null}

      <ContextualCta
        prompt={`See how Vercentlabs implements ${entry.term} on your own data.`}
        href="/book-demo"
        event="resource_cta_click"
        ctaLocation={`glossary_${entry.slug}`}
      />

      <Section tone="page">
        <Container>
          <Stack gap={4}>
            <Text variant="label">Related pages</Text>
            <RelatedPages
              pages={[
                { label: "See all glossary terms", href: "/resources/glossary" },
                { label: "See all resources", href: "/resources" },
              ]}
            />
          </Stack>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(definedTermJsonLd)} />
      <script {...jsonLdScriptProps(webPageJsonLd)} />
    </>
  );
}
