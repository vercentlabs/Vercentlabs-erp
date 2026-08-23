
import { CAPABILITY_GROUPS, LANDING_MODULES, getResourceGuide, getFreshness, getTotalRequirementCount, CONTENT_AUTHORS } from "@vercentlabs/landing-content";
import { Container, Section, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ArticleHeader } from "@/components/content/article-header";
import { RequirementsChecklist, type ChecklistGroup } from "@/components/resources/requirements-checklist";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
import { Reveal } from "@/components/motion/reveal";
import { TrackView } from "@/components/analytics/track-view";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

const AUTHOR = CONTENT_AUTHORS[0];

const PLATFORM_AREA_LABELS: Record<string, string> = {
  platform: "Platform Architecture",
  security: "Security & Governance",
  automation: "Workflow Automation",
  analytics: "Reporting & Analytics",
  mobile: "Mobile ERP",
};

export const metadata = buildPageMetadata({
  title: "The ERP Requirements Checklist",
  description: "A structured, filterable ERP requirements checklist covering 991 documented requirements across 12 modules and a shared platform layer — no login required, nothing transmitted.",
  path: "/resources/erp-requirements-checklist",
});

export default function RequirementsChecklistPage() {
  const guide = getResourceGuide("erp-requirements-checklist");
  if (!guide) return null;
  const freshness = getFreshness("/resources/erp-requirements-checklist");
  const totalRequirements = getTotalRequirementCount();

  const moduleNameByKey = new Map(LANDING_MODULES.map((m) => [m.key, m.name]));

  const groups: ChecklistGroup[] = CAPABILITY_GROUPS.map((group) => {
    const filterKey = group.moduleId ?? group.platformArea ?? "platform";
    const filterLabel = group.moduleId
      ? (moduleNameByKey.get(group.moduleId) ?? group.moduleId)
      : (PLATFORM_AREA_LABELS[group.platformArea ?? "platform"] ?? "Platform");
    return {
      id: group.id,
      name: group.name,
      description: group.description,
      requirementCount: group.requirementCount,
      publicPage: group.publicPage,
      filterKey,
      filterLabel,
    };
  });

  const filters = [
    ...LANDING_MODULES.map((m) => ({ key: m.key, label: m.name })),
    ...Object.entries(PLATFORM_AREA_LABELS).map(([key, label]) => ({ key, label })),
  ].filter((filter) => groups.some((g) => g.filterKey === filter.key));

  const breadcrumbTrail = [
    { name: "Resources", path: "/resources" },
    { name: guide.title, path: "/resources/erp-requirements-checklist" },
  ];

  const techArticleJsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: guide.title,
    description: guide.metaDescription,
    url: absoluteUrl("/resources/erp-requirements-checklist"),
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

          <ArticleHeader eyebrow={guide.category} title={guide.title} dek={guide.dek} author={AUTHOR} freshness={freshness} variant="resource" />
        </div>
      </TrackView>

      <Section tone="page">
        <Container>
          <div className="grid grid-cols-1 gap-10 border-y border-(--color-border-strong) py-8 lg:grid-cols-[220px_minmax(0,820px)] lg:gap-16">
            <div>
              <span className="vl-folio">BUYER WORKSHEET / 01</span>
              <p className="mt-6 tabular-data text-6xl font-semibold tracking-[-0.06em] text-(--color-text-primary)">{groups.length}</p>
              <Text variant="caption">capability groups / {totalRequirements} source requirements</Text>
            </div>
            <div className="border-t border-(--color-border-default)">
              {guide.sections.map((section, sectionIndex) => (
                <section key={section.id} className="grid grid-cols-[3rem_1fr] gap-5 border-b border-(--color-border-default) py-6">
                  <span className="vl-index">{String(sectionIndex + 1).padStart(2, "0")}</span>
                  <div><Heading level="h3" as="h2">{section.heading}</Heading><div className="mt-3 space-y-3">{section.paragraphs.map((paragraph, index) => <Text key={index} variant="bodySmall">{paragraph}</Text>)}</div></div>
                </section>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      {/* RequirementsChecklist is deliberately left without Reveal treatment:
          it's the interactive, printable checklist (see its own print:hidden
          rules), and globals.css has no @media print override for
          [data-reveal]/[data-reveal-item] opacity. Wrapping it risks the
          checklist printing invisible if a user prints before it has scrolled
          into view and been marked revealed. */}
      <Section tone="subtle">
        <Container>
          <div className="mb-8 flex flex-col justify-between gap-4 border-b border-(--color-border-strong) pb-5 sm:flex-row sm:items-end">
            <div><span className="vl-folio">PROCUREMENT WORKSHEET</span><Heading level="h2" className="mt-3">Mark what your ERP must support.</Heading></div>
            <Text variant="caption" className="max-w-[34ch]">Progress stays in this browser. Nothing you check is transmitted.</Text>
          </div>
          <RequirementsChecklist groups={groups} filters={filters} />
        </Container>
      </Section>

      <ContextualCta prompt={guide.conversion.heading} href="/book-demo" event="resource_cta_click" ctaLocation="resource_erp-requirements-checklist" />

      <Section tone="page">
        <Container>
          <Heading level="h2">Questions buyers ask</Heading>
          <Reveal group>
            <FaqAccordion items={guide.faqs} className="mt-10 max-w-[820px]" />
          </Reveal>
        </Container>
      </Section>

      <Section tone="subtle">
        <Container>
          <Stack gap={4}>
            <Text variant="label">Related resources</Text>
            <RelatedPages
              pages={[
                { label: "The ERP Buying Guide", href: "/resources/erp-buying-guide" },
                { label: "The ERP Implementation Checklist", href: "/resources/erp-implementation-checklist" },
                { label: "See all resources", href: "/resources" },
              ]}
            />
          </Stack>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(techArticleJsonLd)} />
      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
