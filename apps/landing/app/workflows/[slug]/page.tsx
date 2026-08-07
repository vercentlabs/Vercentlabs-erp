import { notFound } from "next/navigation";
import Link from "next/link";
import { ROUTED_WORKFLOW_SLUGS, getWorkflow, getLandingModule, getIndustriesForWorkflow } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { PlatformHero } from "@/components/platform/platform-hero";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { WorkflowSequence } from "@/components/workflows/workflow-sequence";
import { ProductScreenshot } from "@/components/product/product-frame";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
import { getApprovedScreenshot } from "@/lib/product/screenshots";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export function generateStaticParams() {
  return ROUTED_WORKFLOW_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!ROUTED_WORKFLOW_SLUGS.includes(slug)) return {};
  const workflow = getWorkflow(slug);
  if (!workflow) return {};
  return buildPageMetadata({
    title: `${workflow.name} Workflow`,
    description: workflow.summary,
    path: `/workflows/${workflow.slug}`,
  });
}

export default async function WorkflowPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!ROUTED_WORKFLOW_SLUGS.includes(slug)) notFound();
  const workflow = getWorkflow(slug);
  if (!workflow || !workflow.sequence) notFound();

  const participatingModules = workflow.modules.map((key) => getLandingModule(key)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const matchingIndustries = getIndustriesForWorkflow(workflow.slug);
  const screenshot = workflow.screenshotId ? getApprovedScreenshot(workflow.screenshotId) : null;

  const breadcrumbTrail = [
    { name: "Workflows", path: "/workflows" },
    { name: workflow.name, path: `/workflows/${workflow.slug}` },
  ];

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${workflow.name} — Vercentlabs ERP`,
    description: workflow.summary,
    url: absoluteUrl(`/workflows/${workflow.slug}`),
    isPartOf: { "@id": SOFTWARE_APPLICATION_ID },
  };

  const faqPageJsonLd =
    workflow.faqs && workflow.faqs.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: workflow.faqs.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: { "@type": "Answer", text: faq.answer },
          })),
        }
      : null;

  return (
    <>
      <TrackView event="workflow_page_view" properties={{ workflow: workflow.slug }}>
        <Section tone="page" className="pb-0 pt-6">
          <Container>
            <Breadcrumbs trail={breadcrumbTrail} />
          </Container>
        </Section>

        <PlatformHero
          eyebrow="Cross-module workflow"
          heading={workflow.name}
          supportingText={workflow.summary}
          heroScreenshotId={workflow.screenshotId}
          connectedModuleKeys={workflow.modules}
          ctaHref={`/book-demo?workflow=${workflow.slug}`}
          ctaLabel="Book a Product Demo"
          ctaEvent="workflow_cta_click"
          ctaLocation={`workflow_hero_${workflow.slug}`}
        />
      </TrackView>

      <DirectDefinition definition={workflow.directDefinition ?? workflow.summary} />

      {/* Full sequence */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="How it actually runs" title="The real sequence, step by step" />
          <div className="mt-10 max-w-[860px]">
            <WorkflowSequence workflow={workflow} resolveModule={(key) => getLandingModule(key) ?? undefined} />
          </div>
        </Container>
      </Section>

      {screenshot ? (
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow="See it in the product" title="A real screen from this workflow, not a diagram." />
            <div className="mt-10 max-w-[900px]">
              <ProductScreenshot id={screenshot.id} />
            </div>
          </Container>
        </Section>
      ) : null}

      <ContextualCta
        prompt={`Ready to see the ${workflow.name} workflow running on your own data?`}
        href={`/book-demo?workflow=${workflow.slug}`}
        event="workflow_cta_click"
        ctaLocation={`workflow_mid_${workflow.slug}`}
      />

      {/* Participating modules */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Every module involved" title="Modules this workflow runs across" />
          <Inline gap={2} className="mt-6 flex-wrap">
            {participatingModules.map((moduleInfo) => (
              <Link key={moduleInfo.key} href={`/modules/${moduleInfo.key}`} prefetch={false}>
                <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
              </Link>
            ))}
          </Inline>
        </Container>
      </Section>

      {/* FAQs */}
      {workflow.faqs && workflow.faqs.length > 0 ? (
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow="Straight answers" title="Questions buyers ask" />
            <FaqAccordion items={workflow.faqs} className="mt-10 max-w-[820px]" />
          </Container>
        </Section>
      ) : null}

      {/* Related pages */}
      <Section tone="page">
        <Container>
          <Stack gap={4}>
            <Text variant="label">Related pages</Text>
            <RelatedPages
              pages={[
                ...matchingIndustries.map((industry) => ({ label: `${industry.name} industry`, href: `/industries/${industry.slug}` })),
                { label: "See the implementation journey", href: "/implementation" },
                { label: "See all workflows", href: "/workflows" },
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
              See the {workflow.name} workflow in a live demo.
            </Heading>
            <div className="mt-6 flex justify-center">
              <TrackedCtaLink href={`/book-demo?workflow=${workflow.slug}`} event="workflow_cta_click" ctaLocation={`workflow_final_${workflow.slug}`}>
                Book a Product Demo
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
