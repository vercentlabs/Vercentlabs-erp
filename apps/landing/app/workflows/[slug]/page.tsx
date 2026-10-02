import { notFound } from "next/navigation";
import Link from "next/link";
import {
  CTAS,
  ROUTED_WORKFLOW_SLUGS,
  WORKFLOW_DETAIL_PAGE,
  getIndustriesForWorkflow,
  getLandingModule,
  getRoutedWorkflows,
  getWorkflow,
  type LandingModule,
} from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ButtonLink } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackView } from "@/components/analytics/track-view";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { RelatedPages } from "@/components/modules/related-pages";
import { ProductEvidence } from "@/components/product/product-evidence";
import { WorkflowCapabilities } from "@/components/workflows/workflow-capabilities";
import { WorkflowModulePath } from "@/components/workflows/workflow-module-path";
import { WorkflowSwimlane } from "@/components/workflows/workflow-swimlane";
import { getApprovedScreenshotsForWorkflow } from "@/lib/product/screenshots";
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
  return buildPageMetadata({ title: `${workflow.name} Workflow`, description: workflow.summary, path: `/workflows/${workflow.slug}` });
}

export default async function WorkflowPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!ROUTED_WORKFLOW_SLUGS.includes(slug)) notFound();
  const workflow = getWorkflow(slug);
  if (!workflow || !workflow.sequence) notFound();

  const page = WORKFLOW_DETAIL_PAGE;
  const sequence = workflow.sequence;
  const moduleOrder = [...new Set(sequence.map((step) => step.moduleKey))];
  const participatingModules = moduleOrder.map((key) => getLandingModule(key)).filter((landingModule): landingModule is LandingModule => landingModule !== null);
  // Evidence follows the workflow: screens are matched by registry metadata and shown in step order.
  const evidence = getApprovedScreenshotsForWorkflow(workflow.slug)
    .sort((a, b) => moduleOrder.indexOf(a.module) - moduleOrder.indexOf(b.module))
    .slice(0, 2);
  const relatedWorkflows = getRoutedWorkflows().filter(
    (candidate) => candidate.slug !== workflow.slug && candidate.sequence?.some((step) => moduleOrder.includes(step.moduleKey)),
  );
  const industries = getIndustriesForWorkflow(workflow.slug);

  const breadcrumbTrail = [{ name: "Workflows", path: "/workflows" }, { name: workflow.name, path: `/workflows/${workflow.slug}` }];
  const webPageJsonLd = { "@context": "https://schema.org", "@type": "WebPage", name: `${workflow.name} — Vercentlabs ERP`, description: workflow.summary, url: absoluteUrl(`/workflows/${workflow.slug}`), isPartOf: { "@id": SOFTWARE_APPLICATION_ID } };
  const faqPageJsonLd = workflow.faqs && workflow.faqs.length > 0 ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: workflow.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) } : null;

  return (
    <>
      <TrackView event="workflow_page_view" properties={{ workflow: workflow.slug }}>
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container>
            <Breadcrumbs trail={breadcrumbTrail} />
          </Container>
        </Section>
        {/* 1–2. What the process is, and which modules run it. */}
        <Section tone="page" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 10, sm: 12 }}>
          <Container>
            <div className="reveal-on-load grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.7fr)] lg:items-end lg:gap-16">
              <div>
                <Text variant="eyebrow">{page.eyebrow}</Text>
                <Heading level="h1" className="mt-5 max-w-[16ch]">
                  {workflow.name}
                </Heading>
                <Text variant="lead" className="mt-6">
                  {workflow.directDefinition ?? workflow.summary}
                </Text>
              </div>
              <dl className="grid gap-4 border-t border-(--color-border-strong) pt-4">
                <div>
                  <dt className="vl-index">{page.triggerLabel}</dt>
                  <dd className="mt-1 text-sm leading-[1.55] text-(--color-text-primary)">{workflow.trigger}</dd>
                </div>
                <div>
                  <dt className="vl-index">{page.scopeLabel(workflow.sequence.length, participatingModules.length)}</dt>
                  <dd className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                    {participatingModules.map((landingModule) => (
                      <Link key={landingModule.key} href={`/modules/${landingModule.key}`} prefetch={false} className="inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-(--color-text-primary) hover:text-(--color-text-brand)">
                        <span className="h-2 w-2" style={{ backgroundColor: landingModule.accentColor.hex }} aria-hidden="true" />
                        {landingModule.displayName}
                      </Link>
                    ))}
                  </dd>
                </div>
              </dl>
            </div>
          </Container>
        </Section>
      </TrackView>

      {/* 3–4. The full sequence: module lanes on desktop, a vertical step list with handoffs on small screens. */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow={page.sequenceEyebrow} title={page.sequenceHeading} />
          <div className="mt-10">
            <WorkflowSwimlane steps={workflow.sequence} stepHeading="h3" />
          </div>
        </Container>
      </Section>

      {/* 5. Capabilities used, resolved from the launch register. */}
      {workflow.capabilityIds?.length ? (
        <Section tone="page">
          <Container>
            <SectionHeader eyebrow={page.capabilitiesEyebrow} title={page.capabilitiesHeading} description={page.capabilitiesSupportingText} />
            <div className="mt-10">
              <WorkflowCapabilities slug={workflow.slug} />
            </div>
          </Container>
        </Section>
      ) : null}

      {/* 6. Product evidence from the modules this workflow runs through. */}
      {evidence.length ? (
        <Section tone="page" paddingTop={{ base: 0 }}>
          <Container>
            <SectionHeader eyebrow={page.evidenceEyebrow} title={page.evidenceHeading} />
            <div className={evidence.length > 1 ? "mt-10 grid grid-cols-1 gap-8 xl:grid-cols-2 xl:items-start" : "mt-10 max-w-[1100px]"}>
              {evidence.map((screenshot) => (
                <ProductEvidence
                  key={screenshot.id}
                  screenshotId={screenshot.id}
                  moduleAccentColor={getLandingModule(screenshot.module)?.accentColor.hex}
                  sizes={evidence.length > 1 ? "(min-width: 1440px) 680px, 100vw" : "(min-width: 1180px) 1100px, 100vw"}
                  fallback={null}
                />
              ))}
            </div>
          </Container>
        </Section>
      ) : null}

      {/* 7. Modules involved. */}
      <Section tone="subtle">
        <Container>
          <SectionHeader eyebrow={page.modulesEyebrow} title={page.modulesHeading} />
          <ul className="mt-10 grid grid-cols-1 gap-px bg-(--color-border-default) sm:grid-cols-2 xl:grid-cols-4">
            {participatingModules.map((landingModule) => (
              <li key={landingModule.key} className="bg-(--vl-paper-strong)">
                <Link href={`/modules/${landingModule.key}`} prefetch={false} className="group flex h-full flex-col border-t-[3px] p-5" style={{ borderTopColor: landingModule.accentColor.hex }}>
                  <span className="text-lg font-semibold tracking-[-0.03em] text-(--color-text-primary) group-hover:text-(--color-text-brand)">{landingModule.displayName}</span>
                  <span className="mt-2 text-sm leading-[1.55] text-(--color-text-secondary)">{landingModule.purpose}</span>
                  <span className="mt-4 text-[0.8rem] font-semibold text-(--color-text-primary)">
                    {sequence.filter((step) => step.moduleKey === landingModule.key).map((step) => step.step).join(", ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* 8. Related workflows. */}
      {relatedWorkflows.length ? (
        <Section tone="page">
          <Container>
            <p className="vl-index">{page.relatedEyebrow}</p>
            <ul className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {relatedWorkflows.map((related) => (
                <li key={related.slug} className="border border-(--color-border-strong) bg-(--vl-paper-strong) p-5">
                  <Link href={`/workflows/${related.slug}`} prefetch={false} className="group inline-flex items-center gap-2 text-base font-semibold text-(--color-text-primary) hover:text-(--color-text-brand)">
                    {related.name}
                    <span className="vl-hover-arrow text-(--color-text-muted)" aria-hidden="true">
                      →
                    </span>
                  </Link>
                  <WorkflowModulePath slug={related.slug} showSteps={false} className="mt-3" />
                </li>
              ))}
            </ul>
            {industries.length ? (
              <div className="mt-8">
                <RelatedPages pages={industries.slice(0, 3).map((industry) => ({ label: `${workflow.name} in ${industry.name.toLowerCase()}`, href: `/industries/${industry.slug}` }))} />
              </div>
            ) : null}
          </Container>
        </Section>
      ) : null}

      {/* 9. Buyer questions. */}
      {workflow.faqs && workflow.faqs.length > 0 ? (
        <Section tone="page" paddingTop={relatedWorkflows.length ? { base: 0 } : undefined}>
          <Container>
            <SectionHeader eyebrow={page.faqEyebrow} title={page.faqHeading} />
            <FaqAccordion items={workflow.faqs} className="mt-10 max-w-[900px]" />
          </Container>
        </Section>
      ) : null}

      {/* 10. Next step. */}
      <Section tone="inverse" className="vl-noise-free">
        <Container>
          <div className="grid grid-cols-1 items-end gap-8 border-t border-white/20 pt-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
            <Heading level="h2" className="max-w-[22ch] text-white">
              {page.finalHeading(workflow.name)}
            </Heading>
            <div className="flex flex-wrap gap-3">
              <TrackedCtaLink href={`/book-demo?workflow=${workflow.slug}`} event="workflow_cta_click" ctaLocation={`workflow_final_${workflow.slug}`} variant="inverse">
                {CTAS.talkToSpecialist.label}
              </TrackedCtaLink>
              <ButtonLink href="/workflows" variant="inverse-secondary" prefetch={false}>
                {page.allWorkflowsLabel}
              </ButtonLink>
            </div>
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
