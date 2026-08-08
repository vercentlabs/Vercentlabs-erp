import { CAPABILITY_GROUPS, LANDING_MODULES, getResourceGuide, getFreshness, getTotalRequirementCount, CONTENT_AUTHORS } from "@vercentlabs/landing-content";
import { Container, Section, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ArticleHeader } from "@/components/content/article-header";
import { RequirementsChecklist, type ChecklistGroup } from "@/components/resources/requirements-checklist";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
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
  description: "A structured, filterable ERP requirements checklist covering 1,039 real requirements across 12 modules and a shared platform layer — no login required, nothing transmitted.",
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
        <div className="flex min-h-[calc(100vh-4rem)] flex-col">
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
          <Stack gap={4} className="max-w-[780px]">
            {guide.sections.map((section) => (
              <Stack key={section.id} gap={3}>
                <Heading level="h2">{section.heading}</Heading>
                {section.paragraphs.map((paragraph, index) => (
                  <Text key={index} variant="body">
                    {paragraph}
                  </Text>
                ))}
              </Stack>
            ))}
            <Text variant="bodySmall" className="font-medium">
              {totalRequirements} requirements across {groups.length} capability groups.
            </Text>
          </Stack>
        </Container>
      </Section>

      <Section tone="subtle">
        <Container>
          <RequirementsChecklist groups={groups} filters={filters} />
        </Container>
      </Section>

      <ContextualCta prompt={guide.conversion.heading} href="/book-demo" event="resource_cta_click" ctaLocation="resource_erp-requirements-checklist" />

      <Section tone="page">
        <Container>
          <Heading level="h2">Questions buyers ask</Heading>
          <FaqAccordion items={guide.faqs} className="mt-10 max-w-[820px]" />
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
