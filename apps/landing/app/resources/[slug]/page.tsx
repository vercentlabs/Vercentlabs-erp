import { notFound } from "next/navigation";
import Link from "next/link";
import { RESOURCE_GUIDES, getResourceGuide, getFreshness, getLandingModule, getWorkflow, CONTENT_AUTHORS } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack, Inline } from "@/components/layout/container";
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
const PROSE_GUIDE_SLUGS = RESOURCE_GUIDES.filter((guide) => guide.slug !== "erp-requirements-checklist").map((guide) => guide.slug);

export function generateStaticParams() { return PROSE_GUIDE_SLUGS.map((slug) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!PROSE_GUIDE_SLUGS.includes(slug)) return {};
  const guide = getResourceGuide(slug);
  if (!guide) return {};
  return buildPageMetadata({ title: guide.title, description: guide.metaDescription, path: `/resources/${guide.slug}` });
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
  const breadcrumbTrail = [{ name: "Resources", path: "/resources" }, { name: guide.title, path: `/resources/${guide.slug}` }];
  const techArticleJsonLd = { "@context": "https://schema.org", "@type": "TechArticle", headline: guide.title, description: guide.metaDescription, url: absoluteUrl(`/resources/${guide.slug}`), author: { "@type": "Organization", name: AUTHOR.name }, datePublished: freshness.publishedAt, dateModified: freshness.lastModifiedAt, isPartOf: { "@id": SOFTWARE_APPLICATION_ID } };
  const faqPageJsonLd = guide.faqs.length ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: guide.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) } : null;

  return <>
    <TrackView event="resource_page_view" properties={{ section: guide.slug }}>
      <div>
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}><Container><Breadcrumbs trail={breadcrumbTrail} /></Container></Section>
        <ArticleHeader eyebrow={guide.category} title={guide.title} dek={guide.dek} author={AUTHOR} freshness={freshness} variant="resource" />
      </div>
    </TrackView>

    <Section tone="page">
      <Container>
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[220px_minmax(0,760px)] lg:gap-16 xl:gap-24">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <span className="vl-folio">REFERENCE JOURNAL</span>
            <div className="mt-6 border-t border-(--color-border-strong) pt-5"><TableOfContents entries={guide.sections.map((section) => ({ id: section.id, label: section.heading }))} /></div>
            {relatedModules.length ? <div className="mt-8 border-t border-(--color-border-default) pt-5"><Text variant="dataLabel">Relevant modules</Text><Inline gap={2} className="mt-3 flex-wrap">{relatedModules.map((m) => <Link key={m.key} href={`/modules/${m.key}`} prefetch={false}><ModuleTag name={m.name} accentColor={m.accentColor.hex} /></Link>)}</Inline></div> : null}
          </aside>
          <article>
            <div className="border-y border-(--color-border-strong) py-7"><KeyTakeaways items={guide.keyTakeaways} /></div>
            <div className="mt-4 border-t border-(--color-border-strong)">
              {guide.sections.map((section, index) => <section key={section.id} id={section.id} className="scroll-mt-24 grid grid-cols-[3rem_minmax(0,1fr)] gap-5 border-b border-(--color-border-default) py-9 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-8">
                <span className="vl-index">{String(index + 1).padStart(2, "0")}</span>
                <div><Heading level="h2">{section.heading}</Heading><div className="mt-5 space-y-4">{section.paragraphs.map((p, i) => <Text key={i} variant="body">{p}</Text>)}</div></div>
              </section>)}
            </div>
          </article>
        </div>
      </Container>
    </Section>

    <ContextualCta prompt={guide.conversion.heading} href="/book-demo" event="resource_cta_click" ctaLocation={`resource_${guide.slug}`} />
    {relatedWorkflows.length ? <Section tone="subtle"><Container><SectionHeader eyebrow="Applied reference" title="Where this guidance appears in a real workflow" /><div className="mt-8 border-t border-(--color-border-strong)">{relatedWorkflows.map((workflow, index) => <Link key={workflow.slug} href={`/workflows/${workflow.slug}`} prefetch={false} className="grid grid-cols-[3rem_1fr_auto] gap-4 border-b border-(--color-border-default) py-5 text-sm"><span className="vl-index">W{index + 1}</span><span className="font-semibold text-(--color-text-primary)">{workflow.name}</span><span className="text-(--color-text-brand)">Open runbook →</span></Link>)}</div></Container></Section> : null}
    <Section tone="page"><Container><SectionHeader eyebrow="Reader questions" title="Straight answers" /><Reveal group><FaqAccordion items={guide.faqs} className="mt-10 max-w-[900px]" /></Reveal></Container></Section>
    {relatedGuides.length ? <Section tone="subtle"><Container><Stack gap={4}><Text variant="dataLabel">Next in the reference journal</Text><RelatedPages pages={[...relatedGuides.map((related) => ({ label: related.title, href: `/resources/${related.slug}` })), { label: "See all resources", href: "/resources" }]} /></Stack></Container></Section> : null}
    <Section tone="inverse"><Container><div className="grid grid-cols-1 items-end gap-8 border-y border-white/20 py-9 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12"><div><span className="vl-folio text-white/55">REFERENCE → WORKING SESSION</span><Heading level="h1" as="h2" className="mt-4 max-w-[18ch] text-(--color-text-inverse)">{guide.conversion.heading}</Heading></div><TrackedCtaLink href="/book-demo" event="resource_cta_click" ctaLocation={`resource_final_${guide.slug}`}>{guide.conversion.ctaLabel}</TrackedCtaLink></div></Container></Section>
    <script {...jsonLdScriptProps(techArticleJsonLd)} />{faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
  </>;
}
