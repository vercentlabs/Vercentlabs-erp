import { notFound } from "next/navigation";
import { LANDING_MODULES, getLandingModule, getIndustriesForModule, getWorkflowsForModule, getSolutionsForModule, ROUTED_WORKFLOW_SLUGS } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Grid, Stack, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Checklist } from "@/components/ui/card";
import { LabeledItemGrid } from "@/components/ui/labeled-item-grid";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { ModuleHero } from "@/components/modules/module-hero";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { CapabilityGrid } from "@/components/modules/capability-grid";
import { ModuleWorkflow } from "@/components/modules/module-workflow";
import { ProductEvidenceSection } from "@/components/modules/product-evidence-section";
import { ContextualCta } from "@/components/modules/contextual-cta";
import { ConnectedModules } from "@/components/modules/connected-modules";
import { RelatedPages } from "@/components/modules/related-pages";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

// Note: the local variable is named `landingModule`, not `module` — Next.js's
// no-assign-module-variable lint rule flags `module` as an identifier.

export function generateStaticParams() {
  return LANDING_MODULES.map((landingModule) => ({ slug: landingModule.key }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const landingModule = getLandingModule(slug);
  if (!landingModule) return {};
  return buildPageMetadata({
    title: `${landingModule.name} Module`,
    description: landingModule.metaDescription,
    path: `/modules/${landingModule.key}`,
  });
}

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const landingModule = getLandingModule(slug);
  if (!landingModule) notFound();

  const connectedModules = landingModule.connectedModules
    .map((link) => getLandingModule(link.moduleKey))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  const relatedIndustries = getIndustriesForModule(landingModule.key);
  const relatedWorkflows = getWorkflowsForModule(landingModule.key).filter((w) => ROUTED_WORKFLOW_SLUGS.includes(w.slug));
  const relatedSolutions = getSolutionsForModule(landingModule.key);

  const breadcrumbTrail = [
    { name: "Modules", path: "/modules" },
    { name: landingModule.name, path: `/modules/${landingModule.key}` },
  ];

  const webPageJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: `${landingModule.name} — Vercentlabs ERP`,
    description: landingModule.metaDescription,
    url: absoluteUrl(`/modules/${landingModule.key}`),
    isPartOf: { "@id": SOFTWARE_APPLICATION_ID },
  };

  const faqPageJsonLd =
    landingModule.faqs.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: landingModule.faqs.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: { "@type": "Answer", text: faq.answer },
          })),
        }
      : null;

  return (
    <>
      <TrackView event="module_page_view" properties={{ workflow: landingModule.key }}>
        <Section tone="page" className="pb-0 pt-6">
          <Container>
            <Breadcrumbs trail={breadcrumbTrail} />
          </Container>
        </Section>

        <ModuleHero landingModule={landingModule} />
      </TrackView>

      <DirectDefinition definition={landingModule.directDefinition} />

      {/* Business problems */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="The problem" title={`What makes ${landingModule.name} hard without a connected system`} />
          <div className="mt-10">
            <LabeledItemGrid items={landingModule.businessProblems} />
          </div>
        </Container>
      </Section>

      {/* Business outcomes */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow="What changes" title={`What ${landingModule.name} makes possible`} />
          <div className="mt-10">
            <LabeledItemGrid items={landingModule.businessOutcomes} />
          </div>
        </Container>
      </Section>

      {/* Capability architecture */}
      <Section tone="page">
        <Container>
          <SectionHeader
            eyebrow="Capability architecture"
            title="What's actually in the module"
            description={`${landingModule.capabilityGroups.length} capability groups, organised the way the product is actually built — not a flat feature list.`}
          />
          <div className="mt-10">
            <CapabilityGrid groups={landingModule.capabilityGroups} />
          </div>
        </Container>
      </Section>

      {/* Primary workflow */}
      <TrackView event="module_workflow_view" properties={{ workflow: landingModule.primaryWorkflow.name }}>
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow="See it work" title={landingModule.primaryWorkflow.name} description={`The same sequence a real ${landingModule.name} process follows inside Vercentlabs.`} />
            <div className="mt-10 max-w-[820px]">
              <ModuleWorkflow workflow={landingModule.primaryWorkflow} accentColor={landingModule.accentColor.hex} connectedModules={connectedModules} />
            </div>
          </Container>
        </Section>
      </TrackView>

      <ProductEvidenceSection screenshots={landingModule.screenshots} moduleName={landingModule.name} accentColor={landingModule.accentColor.hex} />

      <ContextualCta moduleName={landingModule.name} moduleSlug={landingModule.key} />

      {/* Connected modules */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="How it connects" title={`${landingModule.name} and the rest of the platform`} />
          <div className="mt-10">
            <ConnectedModules links={landingModule.connectedModules} resolveModule={(key) => getLandingModule(key) ?? undefined} />
          </div>
        </Container>
      </Section>

      {/* Reporting */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow="Reporting" title={`What ${landingModule.name} tells you`} />
          <div className="mt-10">
            <LabeledItemGrid items={landingModule.reporting.map((r) => ({ title: r.name, description: `${r.measures} — for ${r.audience}.` }))} />
          </div>
        </Container>
      </Section>

      {/* Automation */}
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Automation" title="What runs on its own" />
          <div className="mt-10">
            <LabeledItemGrid items={landingModule.automation} />
          </div>
        </Container>
      </Section>

      {/* Governance */}
      <Section tone="subtle">
        <Container>
          <SectionHeader
            eyebrow="Governance"
            title={`How ${landingModule.name} is controlled`}
            description="Full platform-wide security architecture is covered on the security page — this is what governance specifically means inside this module."
          />
          <div className="mt-10">
            <LabeledItemGrid items={landingModule.governance} />
          </div>
        </Container>
      </Section>

      {/* Implementation considerations */}
      <Section tone="page">
        <Container>
          <Grid columns={2} gap={10} className="items-start">
            <SectionHeader eyebrow="Getting live" title="What to plan for" className="max-w-none" />
            <Checklist items={landingModule.implementationConsiderations} />
          </Grid>
        </Container>
      </Section>

      {/* FAQs */}
      {landingModule.faqs.length > 0 ? (
        <Section tone="subtle">
          <Container>
            <SectionHeader eyebrow="Straight answers" title={`Questions buyers ask about ${landingModule.name}`} />
            <FaqAccordion items={landingModule.faqs} className="mt-10 max-w-[820px]" />
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
                { label: "Explore the full platform", href: "/product" },
                { label: "See all modules", href: "/modules" },
                ...connectedModules.slice(0, 4).map((m) => ({ label: `${m.name} module`, href: `/modules/${m.key}` })),
                ...relatedIndustries.slice(0, 2).map((industry) => ({ label: `${industry.name} industry`, href: `/industries/${industry.slug}` })),
                ...relatedWorkflows.slice(0, 2).map((workflow) => ({ label: `${workflow.name} workflow`, href: `/workflows/${workflow.slug}` })),
                ...relatedSolutions.slice(0, 2).map((solution) => ({ label: `${solution.name} solution`, href: `/solutions/${solution.slug}` })),
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
              {landingModule.conversion.heading}
            </Heading>
            <div className="mt-6 flex justify-center">
              <Inline gap={3}>
                <TrackedCtaLink href={`/book-demo?module=${landingModule.key}`} event="module_final_cta_click" ctaLocation={`module_final_${landingModule.key}`}>
                  {landingModule.conversion.ctaLabel}
                </TrackedCtaLink>
              </Inline>
            </div>
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
