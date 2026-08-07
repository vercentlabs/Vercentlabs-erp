import { notFound } from "next/navigation";
import Link from "next/link";
import { LANDING_SOLUTIONS, getSolution, getLandingModule, getWorkflow, PLATFORM_PAGES, PRODUCT_OVERVIEW_PAGE } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { LabeledItemGrid } from "@/components/ui/labeled-item-grid";
import { ModuleTag } from "@/components/ui/tag";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { PlatformHero } from "@/components/platform/platform-hero";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { BeforeAfterSystem } from "@/components/solutions/before-after-system";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

interface LinkedPlatformPage {
  slug: string;
  title: string;
  directDefinition: string;
}

const PLATFORM_PAGES_BY_SLUG = new Map<string, LinkedPlatformPage>([
  [PRODUCT_OVERVIEW_PAGE.slug, PRODUCT_OVERVIEW_PAGE],
  ...PLATFORM_PAGES.map((page): [string, LinkedPlatformPage] => [page.slug, page]),
]);

export function generateStaticParams() {
  return LANDING_SOLUTIONS.map((solution) => ({ slug: solution.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const solution = getSolution(slug);
  if (!solution) return {};
  return buildPageMetadata({
    title: solution.name,
    description: solution.metaDescription,
    path: `/solutions/${solution.slug}`,
  });
}

export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const solution = getSolution(slug);
  if (!solution) notFound();

  const relatedModules = solution.relatedModuleKeys.map((key) => getLandingModule(key)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const relatedWorkflows = solution.relatedWorkflowSlugs.map((s) => getWorkflow(s)).filter((w): w is NonNullable<typeof w> => Boolean(w));
  const platformPage = PLATFORM_PAGES_BY_SLUG.get(solution.relatedPlatformPageSlug);

  const breadcrumbTrail = [
    { name: "Solutions", path: "/solutions" },
    { name: solution.name, path: `/solutions/${solution.slug}` },
  ];

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${solution.name} — Vercentlabs ERP`,
    description: solution.metaDescription,
    url: absoluteUrl(`/solutions/${solution.slug}`),
    isPartOf: { "@id": SOFTWARE_APPLICATION_ID },
  };

  const faqPageJsonLd =
    solution.faqs.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: solution.faqs.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: { "@type": "Answer", text: faq.answer },
          })),
        }
      : null;

  return (
    <>
      <TrackView event="solution_page_view" properties={{ section: solution.slug }}>
        <Section tone="page" className="pb-0 pt-6">
          <Container>
            <Breadcrumbs trail={breadcrumbTrail} />
          </Container>
        </Section>

        <PlatformHero
          eyebrow="Solution"
          heading={solution.name}
          supportingText={solution.problemStatement}
          connectedModuleKeys={solution.relatedModuleKeys}
          ctaHref={`/book-demo?solution=${solution.slug}`}
          ctaLabel={solution.conversion.ctaLabel}
          ctaEvent="solution_cta_click"
          ctaLocation={`solution_hero_${solution.slug}`}
        />
      </TrackView>

      <DirectDefinition definition={solution.directDefinition} />

      {/* Before/after */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="What changes" title="Before and after" />
          <div className="mt-10">
            <BeforeAfterSystem before={solution.before} after={solution.after} />
          </div>
        </Container>
      </Section>

      {/* Approach */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow="How it actually works" title="What replaces the problem" />
          <div className="mt-10">
            <LabeledItemGrid items={solution.approach} columns={2} />
          </div>
        </Container>
      </Section>

      {platformPage ? (
        <Section tone="page">
          <Container>
            <div className="rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-bg-elevated) p-6 sm:p-8">
              <Text variant="label">Go deeper on the underlying capability</Text>
              <Heading level="h3" className="mt-2">
                {platformPage.title}
              </Heading>
              <Text variant="bodySmall" className="mt-2 max-w-[60ch]">
                {platformPage.directDefinition}
              </Text>
              <Link href={platformPage.slug} prefetch={false} className="mt-4 inline-block text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4">
                See the {platformPage.title} capability page →
              </Link>
            </div>
          </Container>
        </Section>
      ) : null}

      <ContextualCta
        prompt="Ready to see this running on your own data?"
        href={`/book-demo?solution=${solution.slug}`}
        event="solution_cta_click"
        ctaLocation={`solution_mid_${solution.slug}`}
      />

      {/* Related modules/workflows */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow="Where this lives" title="Modules and workflows involved" />
          <Inline gap={2} className="mt-6 flex-wrap">
            {relatedModules.map((moduleInfo) => (
              <Link key={moduleInfo.key} href={`/modules/${moduleInfo.key}`} prefetch={false}>
                <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
              </Link>
            ))}
          </Inline>
          {relatedWorkflows.length > 0 ? (
            <div className="mt-6 flex flex-wrap gap-4">
              {relatedWorkflows.map((workflow) => (
                <Link
                  key={workflow.slug}
                  href={`/workflows/${workflow.slug}`}
                  prefetch={false}
                  className="text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4"
                >
                  {workflow.name} workflow →
                </Link>
              ))}
            </div>
          ) : null}
        </Container>
      </Section>

      {/* FAQs */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Straight answers" title="Questions buyers ask" />
          <FaqAccordion items={solution.faqs} className="mt-10 max-w-[820px]" />
        </Container>
      </Section>

      {/* Related pages */}
      <Section tone="subtle">
        <Container>
          <Stack gap={4}>
            <Text variant="label">Related pages</Text>
            <RelatedPages
              pages={[
                { label: "See the implementation journey", href: "/implementation" },
                { label: "See all solutions", href: "/solutions" },
              ]}
            />
          </Stack>
        </Container>
      </Section>

      {/* Final CTA */}
      <Section tone="inverse">
        <Container>
          <div className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              {solution.conversion.heading}
            </Heading>
            <div className="mt-6 flex justify-center">
              <TrackedCtaLink href={`/book-demo?solution=${solution.slug}`} event="solution_cta_click" ctaLocation={`solution_final_${solution.slug}`}>
                {solution.conversion.ctaLabel}
              </TrackedCtaLink>
            </div>
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
