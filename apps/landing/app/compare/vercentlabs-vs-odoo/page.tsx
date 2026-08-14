import { VERCENTLABS_VS_ODOO, ODOO_COMPARISON_EVIDENCE, EDITORIAL_SOURCES, getFreshness, CONTENT_AUTHORS } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ArticleHeader } from "@/components/content/article-header";
import { DecisionMatrix } from "@/components/content/decision-matrix";
import { SourceList } from "@/components/content/source-list";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

const AUTHOR = CONTENT_AUTHORS[0];
export const metadata = buildPageMetadata({ title: `Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}`, description: VERCENTLABS_VS_ODOO.metaDescription, path: `/compare/${VERCENTLABS_VS_ODOO.slug}` });

export default function VercentlabsVsOdooPage() {
  const freshness = getFreshness(`/compare/${VERCENTLABS_VS_ODOO.slug}`);
  const usedSourceUrls = new Set(ODOO_COMPARISON_EVIDENCE.map((e) => e.sourceUrl));
  const usedSources = EDITORIAL_SOURCES.filter((source) => usedSourceUrls.has(source.url));
  const breadcrumbTrail = [{ name: "Compare", path: "/compare" }, { name: `Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}`, path: `/compare/${VERCENTLABS_VS_ODOO.slug}` }];
  const techArticleJsonLd = { "@context": "https://schema.org", "@type": "TechArticle", headline: `Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}`, description: VERCENTLABS_VS_ODOO.metaDescription, url: absoluteUrl(`/compare/${VERCENTLABS_VS_ODOO.slug}`), author: { "@type": "Organization", name: AUTHOR.name }, datePublished: freshness.publishedAt, dateModified: freshness.lastModifiedAt, isPartOf: { "@id": SOFTWARE_APPLICATION_ID } };
  const faqPageJsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: VERCENTLABS_VS_ODOO.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) };

  return <>
    <TrackView event="comparison_page_view" properties={{ section: VERCENTLABS_VS_ODOO.slug }}><div><Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}><Container><Breadcrumbs trail={breadcrumbTrail} /></Container></Section><ArticleHeader eyebrow="Compare" title={`Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}`} dek={VERCENTLABS_VS_ODOO.directAnswer} author={AUTHOR} freshness={freshness} variant="comparison" /></div></TrackView>

    <Section tone="page"><Container>
      <div className="grid grid-cols-1 gap-10 border-y border-(--color-border-strong) py-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
        <div><span className="vl-folio">DECISION DOCKET</span><p className="mt-6 tabular-data text-6xl font-semibold tracking-[-0.06em] text-(--color-text-primary)">{VERCENTLABS_VS_ODOO.dimensions.length}</p><Text variant="caption">decision dimensions</Text></div>
        <div><Text variant="dataLabel">Evidence standard</Text><Heading level="h2" className="mt-3">A comparison designed to support a decision, not manufacture a winner.</Heading><Text variant="body" className="mt-4 max-w-[70ch]">Every material claim about {VERCENTLABS_VS_ODOO.competitor} traces to a source and is tied to the review date {freshness.lastReviewedAt}. When the evidence cannot support a claim, the comparison says so.</Text>
          <div className="mt-7 grid grid-cols-1 border-l border-t border-(--color-border-default) sm:grid-cols-3">{[["01","Source it"],["02","Date it"],["03","Admit fit"]].map(([n,t]) => <div key={n} className="border-b border-r border-(--color-border-default) p-4"><span className="vl-index">{n}</span><p className="mt-3 text-sm font-semibold text-(--color-text-primary)">{t}</p></div>)}</div>
        </div>
      </div>
    </Container></Section>

    <Section tone="subtle"><Container><SectionHeader eyebrow="Docket / side by side" title="Where the products actually differ" /><div className="mt-8 border-t border-(--color-border-strong) pt-6"><DecisionMatrix rowHeader="Dimension" columns={[VERCENTLABS_VS_ODOO.competitor, "Vercentlabs"]} rows={VERCENTLABS_VS_ODOO.dimensions.map((dimension) => ({ label: dimension.title, values: [dimension.odoo, dimension.vercentlabs] }))} /></div></Container></Section>

    <Section tone="page"><Container><div className="grid grid-cols-1 gap-px border-l border-t border-(--color-border-strong) bg-(--color-border-default) lg:grid-cols-2">
      {[{ name: VERCENTLABS_VS_ODOO.competitor, items: VERCENTLABS_VS_ODOO.strongerFitForOdoo, code: "A" }, { name: "Vercentlabs", items: VERCENTLABS_VS_ODOO.strongerFitForVercentlabs, code: "B" }].map((side) => <section key={side.name} className="bg-(--color-bg-elevated) p-6 sm:p-8"><div className="flex items-end justify-between gap-4 border-b border-(--color-border-default) pb-5"><div><span className="vl-index">FIT PROFILE / {side.code}</span><Heading level="h2" className="mt-3">Where {side.name} may be the stronger fit</Heading></div></div><ol className="mt-4">{side.items.map((item,index) => <li key={item} className="grid grid-cols-[2.5rem_1fr] gap-4 border-b border-(--color-border-default) py-4"><span className="vl-index">{String(index+1).padStart(2,"0")}</span><Text variant="bodySmall">{item}</Text></li>)}</ol></section>)}
    </div></Container></Section>

    <ContextualCta prompt="See whether Vercentlabs fits your specific requirements." href="/book-demo" event="comparison_cta_click" ctaLocation="comparison_vercentlabs-vs-odoo" />
    <Section tone="subtle"><Container><SectionHeader eyebrow="Buyer questions" title="Questions that matter before selection" /><FaqAccordion items={VERCENTLABS_VS_ODOO.faqs} className="mt-10 max-w-[900px]" /></Container></Section>
    <Section tone="page"><Container><div className="grid grid-cols-1 gap-10 lg:grid-cols-[220px_minmax(0,780px)] lg:gap-16"><div><span className="vl-folio">SOURCE FILE</span><Text variant="bodySmall" className="mt-4">The evidence ledger behind this comparison.</Text></div><SourceList sources={usedSources} /></div></Container></Section>
    <Section tone="subtle"><Container><Stack gap={4}><Text variant="dataLabel">Related decision material</Text><RelatedPages pages={[{ label: "The ERP Buying Guide", href: "/resources/erp-buying-guide" }, { label: "The ERP Requirements Checklist", href: "/resources/erp-requirements-checklist" }, { label: "See all comparisons", href: "/compare" }]} /></Stack></Container></Section>
    <Section tone="inverse"><Container><div className="grid grid-cols-1 items-end gap-8 border-y border-white/20 py-9 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12"><div><span className="vl-folio text-white/55">DECISION → LIVE VALIDATION</span><Heading level="h1" as="h2" className="mt-4 max-w-[18ch] text-(--color-text-inverse)">See how Vercentlabs handles your specific requirements.</Heading></div><TrackedCtaLink href="/book-demo" event="comparison_cta_click" ctaLocation="comparison_final_vercentlabs-vs-odoo">Book a Demo</TrackedCtaLink></div></Container></Section>
    <script {...jsonLdScriptProps(techArticleJsonLd)} /><script {...jsonLdScriptProps(faqPageJsonLd)} />
  </>;
}
