import { notFound } from "next/navigation";
import {
  LANDING_MODULES,
  getLandingModule,
  getIndustriesForModule,
  getWorkflowsForModule,
  getSolutionsForModule,
  getResourceGuidesForModule,
  ROUTED_WORKFLOW_SLUGS,
} from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
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
import { Reveal } from "@/components/motion/reveal";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

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
  const relatedGuides = [...getResourceGuidesForModule(landingModule.key)].sort((a, b) => a.relatedModuleKeys.length - b.relatedModuleKeys.length);

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

  const faqPageJsonLd = landingModule.faqs.length
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
        <div>
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container><Breadcrumbs trail={breadcrumbTrail} /></Container>
          </Section>
          <ModuleHero landingModule={landingModule} />
        </div>
      </TrackView>

      <Reveal><DirectDefinition definition={landingModule.directDefinition} /></Reveal>

      <Section tone="page">
        <Container>
          <div className="flex items-end justify-between gap-6 border-b border-(--color-border-strong) pb-5">
            <SectionHeader eyebrow="Module atlas / operating conditions" title={`Why ${landingModule.name} becomes difficult in fragments`} />
            <span className="vl-folio hidden sm:block">RECORD / {landingModule.key.toUpperCase()}</span>
          </div>
          <div className="mt-8 border-t border-(--color-border-strong)">
            {landingModule.businessProblems.map((item, index) => (
              <div key={item.title} className="grid gap-3 border-b border-(--color-border-default) py-6 md:grid-cols-[4rem_minmax(180px,.55fr)_minmax(0,1fr)] md:gap-8">
                <span className="vl-index" style={{ color: landingModule.accentColor.hex }}>{String(index + 1).padStart(2, "0")}</span>
                <Heading level="h4" as="h3">{item.title}</Heading>
                <Text variant="bodySmall">{item.description}</Text>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow="Operating outcomes" title={`What changes when ${landingModule.name} shares one system of record`} />
          <div className="mt-10 grid grid-cols-1 border-l border-t border-(--color-border-strong) md:grid-cols-2">
            {landingModule.businessOutcomes.map((item, index) => (
              <div key={item.title} className="min-h-[190px] border-b border-r border-(--color-border-strong) bg-(--color-bg-elevated) p-6 sm:p-7">
                <div className="flex items-center justify-between gap-5">
                  <span className="vl-index" style={{ color: landingModule.accentColor.hex }}>OUT / {String(index + 1).padStart(2, "0")}</span>
                  <span className="h-2.5 w-2.5" style={{ backgroundColor: landingModule.accentColor.hex }} aria-hidden="true" />
                </div>
                <Heading level="h3" className="mt-8">{item.title}</Heading>
                <Text variant="bodySmall" className="mt-3 max-w-[58ch]">{item.description}</Text>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section tone="page">
        <Container>
          <SectionHeader
            eyebrow="Capability architecture"
            title="The module, decomposed by operating capability."
            description={`${landingModule.capabilityGroups.length} capability groups organised by the way the product works, not as a flat marketing feature wall.`}
          />
          <Reveal><div className="mt-10"><CapabilityGrid groups={landingModule.capabilityGroups} /></div></Reveal>
        </Container>
      </Section>

      <TrackView event="module_workflow_view" properties={{ workflow: landingModule.primaryWorkflow.name }}>
        <Section tone="subtle">
          <Container>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14">
              <div className="border-t border-(--color-border-strong) pt-5">
                <span className="vl-folio">RUNBOOK / 01</span>
                <Text variant="dataLabel" className="mt-8 block">Primary operating sequence</Text>
                <Text variant="bodySmall" className="mt-3">A transaction-level view of how work progresses through {landingModule.name}.</Text>
              </div>
              <div>
                <SectionHeader eyebrow="See it work" title={landingModule.primaryWorkflow.name} description={`The ordered process a real ${landingModule.name} workflow follows inside Vercentlabs.`} />
                <Reveal><div className="mt-10 max-w-[900px]"><ModuleWorkflow workflow={landingModule.primaryWorkflow} accentColor={landingModule.accentColor.hex} connectedModules={connectedModules} /></div></Reveal>
              </div>
            </div>
          </Container>
        </Section>
      </TrackView>

      <ProductEvidenceSection
        moduleName={landingModule.name}
        accentColor={landingModule.accentColor.hex}
        capabilityGroupCount={landingModule.capabilityGroups.length}
        workflowName={landingModule.primaryWorkflow.name}
        connectedModuleCount={landingModule.connectedModules.length}
        featuredOutcome={landingModule.businessOutcomes[0]}
      />

      <ContextualCta moduleName={landingModule.name} moduleSlug={landingModule.key} />

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="System map" title={`${landingModule.name} does not operate alone.`} description="The handoffs below are part of the operating model, not decorative cross-sells." />
          <Reveal><div className="mt-10"><ConnectedModules links={landingModule.connectedModules} resolveModule={(key) => getLandingModule(key) ?? undefined} /></div></Reveal>
        </Container>
      </Section>

      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow="Output register" title={`What ${landingModule.name} tells operators and managers`} />
          <div className="mt-10 border-y border-(--color-border-strong)">
            {landingModule.reporting.map((report, index) => (
              <div key={report.name} className="grid gap-3 border-b border-(--color-border-default) py-5 last:border-b-0 lg:grid-cols-[3rem_260px_minmax(0,1fr)_220px] lg:gap-8">
                <span className="vl-index">R{String(index + 1).padStart(2, "0")}</span>
                <Text variant="label">{report.name}</Text>
                <Text variant="bodySmall">{report.measures}</Text>
                <Text variant="caption">Audience / {report.audience}</Text>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section tone="page">
        <Container>
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <SectionHeader compact eyebrow="Rule register" title="What the module can run on its own" />
              <div className="mt-8 border-t border-(--color-border-strong)">
                {landingModule.automation.map((item, index) => (
                  <div key={item.title} className="grid grid-cols-[2.5rem_1fr] gap-4 border-b border-(--color-border-default) py-5">
                    <span className="vl-index" style={{ color: landingModule.accentColor.hex }}>A{index + 1}</span>
                    <div><Text variant="label">{item.title}</Text><Text variant="bodySmall" className="mt-2">{item.description}</Text></div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <SectionHeader compact eyebrow="Control register" title={`How ${landingModule.name} stays governed`} description="Module-specific controls shown separately from the platform-wide security architecture." />
              <div className="mt-8 border-t border-(--color-border-strong)">
                {landingModule.governance.map((item, index) => (
                  <div key={item.title} className="grid grid-cols-[2.5rem_1fr] gap-4 border-b border-(--color-border-default) py-5">
                    <span className="vl-index">C{index + 1}</span>
                    <div><Text variant="label">{item.title}</Text><Text variant="bodySmall" className="mt-2">{item.description}</Text></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </Section>

      <Section tone="subtle">
        <Container>
          <div className="grid grid-cols-1 gap-10 border-y border-(--color-border-strong) py-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-16">
            <div><span className="vl-folio">ROLLOUT / MODULE</span><Heading level="h2" className="mt-5">What to plan before going live.</Heading></div>
            <ol className="border-t border-(--color-border-default)">
              {landingModule.implementationConsiderations.map((item, index) => (
                <li key={item} className="grid grid-cols-[3rem_1fr] gap-5 border-b border-(--color-border-default) py-4">
                  <span className="vl-index">{String(index + 1).padStart(2, "0")}</span><Text variant="bodySmall">{item}</Text>
                </li>
              ))}
            </ol>
          </div>
        </Container>
      </Section>

      {landingModule.faqs.length > 0 ? (
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow="Buyer questions" title={`Questions teams ask about ${landingModule.name}`} />
            <Reveal group><FaqAccordion items={landingModule.faqs} className="mt-10 max-w-[900px]" /></Reveal>
          </Container>
        </Section>
      ) : null}

      <Section tone="subtle">
        <Container>
          <Stack gap={4}>
            <Text variant="dataLabel">Continue the operating map</Text>
            <RelatedPages pages={[
              { label: "Explore the full platform", href: "/product" },
              { label: "See all modules", href: "/modules" },
              ...connectedModules.slice(0, 4).map((m) => ({ label: `${m.name} module`, href: `/modules/${m.key}` })),
              ...relatedIndustries.slice(0, 2).map((industry) => ({ label: `${industry.name} industry`, href: `/industries/${industry.slug}` })),
              ...relatedWorkflows.slice(0, 2).map((workflow) => ({ label: `${workflow.name} workflow`, href: `/workflows/${workflow.slug}` })),
              ...relatedSolutions.slice(0, 2).map((solution) => ({ label: `${solution.name} solution`, href: `/solutions/${solution.slug}` })),
              ...relatedGuides.slice(0, 1).map((guide) => ({ label: guide.title, href: `/resources/${guide.slug}` })),
            ]} />
          </Stack>
        </Container>
      </Section>

      <Section tone="inverse">
        <Container>
          <div className="grid grid-cols-1 items-end gap-8 border-y border-white/20 py-9 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <div className="max-w-[760px]">
              <span className="vl-folio text-white/55">MODULE / {landingModule.key.toUpperCase()} / LIVE SESSION</span>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">{landingModule.conversion.heading}</Heading>
            </div>
            <TrackedCtaLink href={`/book-demo?module=${landingModule.key}`} event="module_final_cta_click" ctaLocation={`module_final_${landingModule.key}`}>
              {landingModule.conversion.ctaLabel}
            </TrackedCtaLink>
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
