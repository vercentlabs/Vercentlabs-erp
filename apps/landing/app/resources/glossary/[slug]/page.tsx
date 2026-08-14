import { notFound } from "next/navigation";
import Link from "next/link";
import { STANDALONE_GLOSSARY_SLUGS, getGlossaryTerm, getLandingModule, getWorkflow, getFreshness, CONTENT_AUTHORS } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ArticleHeader } from "@/components/content/article-header";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
import { TrackView } from "@/components/analytics/track-view";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

const AUTHOR = CONTENT_AUTHORS[0];
export function generateStaticParams() { return STANDALONE_GLOSSARY_SLUGS.map((slug) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const entry = getGlossaryTerm(slug); if (!entry) return {}; return buildPageMetadata({ title: `${entry.term} — ERP Glossary`, description: entry.shortDefinition, path: `/resources/glossary/${entry.slug}` }); }

export default async function GlossaryTermPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; if (!STANDALONE_GLOSSARY_SLUGS.includes(slug)) notFound(); const entry = getGlossaryTerm(slug); if (!entry) notFound();
  const relatedModules = entry.relatedModules.map((key) => getLandingModule(key)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const relatedWorkflow = entry.relatedWorkflow ? getWorkflow(entry.relatedWorkflow) : null;
  const relatedTermEntries = entry.relatedTerms.map((s) => getGlossaryTerm(s)).filter((t): t is NonNullable<typeof t> => Boolean(t));
  const freshness = getFreshness(`/resources/glossary/${entry.slug}`);
  const breadcrumbTrail = [{ name: "Resources", path: "/resources" }, { name: "Glossary", path: "/resources/glossary" }, { name: entry.term, path: `/resources/glossary/${entry.slug}` }];
  const definedTermJsonLd = { "@context": "https://schema.org", "@type": "DefinedTerm", name: entry.term, description: entry.definition, url: absoluteUrl(`/resources/glossary/${entry.slug}`), inDefinedTermSet: absoluteUrl("/resources/glossary") };
  const webPageJsonLd = { "@context": "https://schema.org", "@type": "WebPage", name: `${entry.term} — Vercentlabs ERP Glossary`, description: entry.shortDefinition, url: absoluteUrl(`/resources/glossary/${entry.slug}`), isPartOf: { "@id": SOFTWARE_APPLICATION_ID }, dateModified: freshness.lastModifiedAt };
  const ledger = [{ label: "Definition", value: entry.definition }, { label: "Why it matters", value: entry.whyItMatters }, { label: "How it works", value: entry.howItWorks }, { label: "Example", value: entry.example }];
  return <>
    <TrackView event="glossary_page_view" properties={{ section: entry.slug }}><div><Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}><Container><Breadcrumbs trail={breadcrumbTrail} /></Container></Section><ArticleHeader eyebrow="Glossary" title={entry.term} dek={entry.shortDefinition} author={AUTHOR} freshness={freshness} variant="glossary" /></div></TrackView>
    <Section tone="page"><Container><div className="grid grid-cols-1 gap-12 lg:grid-cols-[220px_minmax(0,820px)] lg:gap-16">
      <aside><span className="vl-folio">LEXICON / DEFINITION SHEET</span><div className="mt-8 border-t border-(--color-border-strong) pt-5"><Text variant="dataLabel">Term family</Text><p className="mt-2 text-7xl font-semibold leading-none tracking-[-0.07em] text-(--color-text-primary)" aria-hidden="true">{entry.term.slice(0,1).toUpperCase()}</p></div></aside>
      <div className="border-t border-(--color-border-strong)">{ledger.map((item, index) => <section key={item.label} className="grid grid-cols-[3rem_1fr] gap-5 border-b border-(--color-border-default) py-8 sm:grid-cols-[4rem_1fr] sm:gap-8"><span className="vl-index">{String(index + 1).padStart(2,"0")}</span><div><Heading level="h2">{item.label}</Heading><Text variant={index === 0 ? "bodyLarge" : "body"} className="mt-4">{item.value}</Text></div></section>)}</div>
    </div></Container></Section>
    <Section tone="subtle"><Container><div className="grid grid-cols-1 gap-8 border-y border-(--color-border-strong) py-8 lg:grid-cols-[220px_1fr]"><div><span className="vl-index">VERCENTLABS / APPLICATION</span><Heading level="h3" className="mt-4">How the term becomes an operating control.</Heading></div><div><Text variant="body">{entry.vercentlabsHandling}</Text><Inline gap={2} className="mt-5 flex-wrap">{relatedModules.map((m) => <Link key={m.key} href={`/modules/${m.key}`} prefetch={false}><ModuleTag name={m.name} accentColor={m.accentColor.hex} /></Link>)}</Inline>{relatedWorkflow ? <Link href={`/workflows/${relatedWorkflow.slug}`} prefetch={false} className="vl-editorial-link mt-5 inline-block text-sm font-semibold text-(--color-text-brand)">Open {relatedWorkflow.name} runbook →</Link> : null}</div></div></Container></Section>
    {relatedTermEntries.length ? <Section tone="page"><Container><SectionHeader eyebrow="Lexicon cross-reference" title="Related terms" /><div className="mt-8 border-t border-(--color-border-strong)">{relatedTermEntries.map((related,index) => <Link key={related.slug} href={`/resources/glossary/${related.slug}`} prefetch={false} className="grid grid-cols-[3rem_1fr_auto] gap-4 border-b border-(--color-border-default) py-5"><span className="vl-index">{String(index+1).padStart(2,"0")}</span><span className="font-semibold text-(--color-text-primary)">{related.term}</span><span className="text-sm text-(--color-text-brand)">Definition →</span></Link>)}</div></Container></Section> : null}
    <ContextualCta prompt={`See how Vercentlabs implements ${entry.term} on your own data.`} href="/book-demo" event="resource_cta_click" ctaLocation={`glossary_${entry.slug}`} />
    <Section tone="subtle"><Container><Stack gap={4}><Text variant="dataLabel">Reference index</Text><RelatedPages pages={[{ label: "See all glossary terms", href: "/resources/glossary" }, { label: "See all resources", href: "/resources" }]} /></Stack></Container></Section>
    <script {...jsonLdScriptProps(definedTermJsonLd)} /><script {...jsonLdScriptProps(webPageJsonLd)} />
  </>;
}
