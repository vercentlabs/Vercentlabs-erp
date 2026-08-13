import { notFound } from "next/navigation";
import Link from "next/link";
import { RESOURCE_GUIDES, getResourceGuide, getFreshness, getLandingModule, getWorkflow, CONTENT_AUTHORS } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack, Inline, SidebarLayout } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ArticleHeader } from "@/components/content/article-header";
import { KeyTakeaways } from "@/components/content/key-takeaways";
import { TableOfContents } from "@/components/content/table-of-contents";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
import { Reveal } from "@/components/motion/reveal";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

const AUTHOR = CONTENT_AUTHORS[0];

// Excludes erp-requirements-checklist, which has its own bespoke, interactive route
// (app/resources/erp-requirements-checklist/page.tsx) — this route renders the 5
// prose-style cornerstone guides only.
const PROSE_GUIDE_SLUGS = RESOURCE_GUIDES.filter((guide) => guide.slug !== "erp-requirements-checklist").map((guide) => guide.slug);

export function generateStaticParams() {
  return PROSE_GUIDE_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!PROSE_GUIDE_SLUGS.includes(slug)) return {};
  const guide = getResourceGuide(slug);
  if (!guide) return {};
  return buildPageMetadata({
    title: guide.title,
    description: guide.metaDescription,
    path: `/resources/${guide.slug}`,
  });
}

export default async function ResourceGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!PROSE_GUIDE_SLUGS.includes(slug)) notFound();
  const guide = getResourceGuide(slug);
  if (!guide) notFound();

  const freshness = getFreshness(`/resources/${guide.slug}`);
  const relatedModules = guide.relatedModuleKeys.map((key) => getLandingModule(key)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const relatedWorkflows = guide.relatedWorkflowSlugs.map((s) => getWorkflow(s)).filter((w): w is NonNullable<typeof w> => Boolean(w));
  const relatedGuides = guide.relatedResourceSlugs.map((s) => getResourceGuide(s)).filter((g): g is NonNullable<typeof g> => Boolean(g));

  const breadcrumbTrail = [
    { name: "Resources", path: "/resources" },
    { name: guide.title, path: `/resources/${guide.slug}` },
  ];

  const techArticleJsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: guide.title,
    description: guide.metaDescription,
    url: absoluteUrl(`/resources/${guide.slug}`),
    author: { "@type": "Organization", name: AUTHOR.name },
    datePublished: freshness.publishedAt,
    dateModified: freshness.lastModifiedAt,
    isPartOf: { "@id": SOFTWARE_APPLICATION_ID },
  };

  const faqPageJsonLd =
    guide.faqs.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: guide.faqs.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: { "@type": "Answer", text: faq.answer },
          })),
        }
      : null;

  return (
    <>
      <TrackView event="resource_page_view" properties={{ section: guide.slug }}>
        {/* Header is a sticky h-16 (4rem) bar — this wrapper fills exactly the
            remaining viewport height, so the hero neither leaves dead space
            above the next section nor requires a scroll to see all of it. */}
        <div>
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container>
              <Breadcrumbs trail={breadcrumbTrail} />
            </Container>
          </Section>

          <ArticleHeader eyebrow={guide.category} title={guide.title} dek={guide.dek} author={AUTHOR} freshness={freshness} />
        </div>
      </TrackView>

      <Section tone="page">
        <Container>
          <SidebarLayout
            content={
              <Reveal group>
                <Stack gap={10} className="max-w-[70ch]">
                  <KeyTakeaways items={guide.keyTakeaways} />
                  {guide.sections.map((section, sectionIndex) => (
                    <div
                      key={section.id}
                      id={section.id}
                      className="scroll-mt-24 flex flex-col gap-3"
                      data-reveal-item
                      style={{ transitionDelay: `${Math.min(sectionIndex, 4) * 60}ms` }}
                    >
                      <Heading level="h2">{section.heading}</Heading>
                      {section.paragraphs.map((paragraph, index) => (
                        <Text key={index} variant="body">
                          {paragraph}
                        </Text>
                      ))}
                    </div>
                  ))}
                </Stack>
              </Reveal>
            }
            sidebar={
              <div className="sticky top-24 flex flex-col gap-8">
                <TableOfContents entries={guide.sections.map((section) => ({ id: section.id, label: section.heading }))} />
                {relatedModules.length > 0 ? (
                  <div>
                    <Text variant="dataLabel" as="p" className="mb-3">
                      Related modules
                    </Text>
                    <Inline gap={2} className="flex-wrap">
                      {relatedModules.map((moduleInfo) => (
                        <Link key={moduleInfo.key} href={`/modules/${moduleInfo.key}`} prefetch={false}>
                          <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
                        </Link>
                      ))}
                    </Inline>
                  </div>
                ) : null}
              </div>
            }
          />
        </Container>
      </Section>

      <ContextualCta prompt={guide.conversion.heading} href="/book-demo" event="resource_cta_click" ctaLocation={`resource_${guide.slug}`} />

      {relatedWorkflows.length > 0 ? (
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow="Where this lives" title="Related workflow" />
            <Reveal group>
              <Inline gap={4} className="mt-6 flex-wrap">
                {relatedWorkflows.map((workflow, index) => (
                  <Link
                    key={workflow.slug}
                    href={`/workflows/${workflow.slug}`}
                    prefetch={false}
                    className="text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4"
                    data-reveal-item
                    style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}
                  >
                    {workflow.name} workflow →
                  </Link>
                ))}
              </Inline>
            </Reveal>
          </Container>
        </Section>
      ) : null}

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Straight answers" title="Questions buyers ask" />
          <Reveal group>
            <FaqAccordion items={guide.faqs} className="mt-10 max-w-[820px]" />
          </Reveal>
        </Container>
      </Section>

      {relatedGuides.length > 0 ? (
        <Section tone="subtle">
          <Container>
            <Stack gap={4}>
              <Text variant="label">Related resources</Text>
              <RelatedPages
                pages={[
                  ...relatedGuides.map((related) => ({ label: related.title, href: `/resources/${related.slug}` })),
                  { label: "See all resources", href: "/resources" },
                ]}
              />
            </Stack>
          </Container>
        </Section>
      ) : null}

      <Section tone="inverse">
        <Container>
          <Reveal className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              {guide.conversion.heading}
            </Heading>
            <div className="mt-6 flex justify-center">
              <TrackedCtaLink href="/book-demo" event="resource_cta_click" ctaLocation={`resource_final_${guide.slug}`}>
                {guide.conversion.ctaLabel}
              </TrackedCtaLink>
            </div>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(techArticleJsonLd)} />
      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
