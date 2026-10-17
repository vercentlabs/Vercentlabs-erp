import { notFound } from "next/navigation";
import Link from "next/link";
import { ROUTED_WORKFLOW_SLUGS, getWorkflow, getLandingModule, getIndustriesForWorkflow } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { PlatformHero } from "@/components/platform/platform-hero";
import { DirectDefinition } from "@/components/modules/direct-definition";
import { WorkflowSequence } from "@/components/workflows/workflow-sequence";
import { ContextualCta } from "@/components/shared/contextual-cta";
import { RelatedPages } from "@/components/modules/related-pages";
import { Reveal } from "@/components/motion/reveal";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps, SOFTWARE_APPLICATION_ID } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export function generateStaticParams() { return ROUTED_WORKFLOW_SLUGS.map((slug) => ({ slug })); }

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

  const participatingModules = workflow.modules.map((key) => getLandingModule(key)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const matchingIndustries = getIndustriesForWorkflow(workflow.slug);
  const breadcrumbTrail = [{ name: "Workflows", path: "/workflows" }, { name: workflow.name, path: `/workflows/${workflow.slug}` }];
  const webPageJsonLd = { "@context": "https://schema.org", "@type": "WebPage", name: `${workflow.name} — Vercentlabs ERP`, description: workflow.summary, url: absoluteUrl(`/workflows/${workflow.slug}`), isPartOf: { "@id": SOFTWARE_APPLICATION_ID } };
  const faqPageJsonLd = workflow.faqs && workflow.faqs.length > 0 ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: workflow.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) } : null;

  return (
    <>
      <TrackView event="workflow_page_view" properties={{ workflow: workflow.slug }}>
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}><Container><Breadcrumbs trail={breadcrumbTrail} /></Container></Section>
        <PlatformHero
          eyebrow="Cross-module workflow"
          heading={workflow.name}
          supportingText={workflow.summary}
          connectedModuleKeys={workflow.modules}
          ctaHref={`/book-demo?workflow=${workflow.slug}`}
          ctaLabel="Book a Demo"
          ctaEvent="workflow_cta_click"
          ctaLocation={`workflow_hero_${workflow.slug}`}
          variant="workflow"
        />
      </TrackView>

      <Reveal><DirectDefinition definition={workflow.directDefinition ?? workflow.summary} /></Reveal>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <div className="grid gap-8 lg:grid-cols-[180px_1fr] lg:gap-12">
            <div className="border-t border-(--color-border-strong) pt-4">
              <span className="vl-index">RUNBOOK / {workflow.slug.toUpperCase()}</span>
              <p className="mt-3 text-sm font-semibold text-(--color-text-primary)">Execution sequence</p>
              <dl className="mt-8 border-y border-(--color-border-default)">
                <div className="flex items-center justify-between py-3"><dt className="vl-index">Steps</dt><dd className="font-mono text-lg font-semibold">{String(workflow.sequence.length).padStart(2, "0")}</dd></div>
                <div className="flex items-center justify-between border-t border-(--color-border-default) py-3"><dt className="vl-index">Modules</dt><dd className="font-mono text-lg font-semibold">{String(workflow.modules.length).padStart(2, "0")}</dd></div>
                <div className="flex items-center justify-between border-t border-(--color-border-default) py-3"><dt className="vl-index">Approvals</dt><dd className="font-mono text-lg font-semibold">{String(workflow.approvals?.length ?? 0).padStart(2, "0")}</dd></div>
              </dl>
            </div>
            <div>
              <SectionHeader title="The real sequence, step by step" description="The runbook shows trigger, participants, each module handoff, approvals, automated actions, exceptions, visibility and business value in one continuous operating document." className="border-t-0 pt-0 lg:grid-cols-1" />
              <Reveal><div className="mt-8"><WorkflowSequence workflow={workflow} resolveModule={(key) => getLandingModule(key) ?? undefined} /></div></Reveal>
            </div>
          </div>
        </Container>
      </Section>

      <ContextualCta prompt={`Ready to see the ${workflow.name} workflow running on your own data?`} href={`/book-demo?workflow=${workflow.slug}`} event="workflow_cta_click" ctaLocation={`workflow_mid_${workflow.slug}`} />

      <Section tone="subtle" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Handoff map" title="Every module involved, in operating order." description="The workflow is deliberately shown as a chain of responsibility rather than a bag of features." />
          <Reveal group>
            <ol className="mt-10 border-y border-(--color-border-strong)">
              {participatingModules.map((moduleInfo, index) => (
                <li key={moduleInfo.key} data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 50}ms` }}>
                  <Link href={`/modules/${moduleInfo.key}`} prefetch={false} className="group grid gap-4 border-t border-(--color-border-default) py-5 first:border-t-0 sm:grid-cols-[56px_minmax(180px,.45fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                    <span className="flex h-10 w-10 items-center justify-center border border-(--color-border-strong) bg-(--color-bg-elevated) font-mono text-[0.65rem] font-bold" style={{ color: moduleInfo.accentColor.hex }}>{String(index + 1).padStart(2, "0")}</span>
                    <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
                    <span className="text-sm text-(--color-text-secondary)">Part of the {workflow.name} operating path</span>
                    <span className="vl-hover-arrow text-(--color-text-brand)" aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ol>
          </Reveal>
        </Container>
      </Section>

      {workflow.faqs && workflow.faqs.length > 0 ? (
        <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
          <Container><SectionHeader eyebrow="Buyer questions" title="Questions buyers ask about this runbook" description="Direct answers about how the sequence behaves, where controls sit and what a real deployment should expect." /><Reveal group><FaqAccordion items={workflow.faqs} className="mt-10 max-w-[900px]" /></Reveal></Container>
        </Section>
      ) : null}

      <Section tone="subtle" paddingTop={{ base: 10, sm: 12 }} paddingBottom={{ base: 10, sm: 12 }}>
        <Container><div className="grid gap-7 border-y border-(--color-border-strong) py-7 lg:grid-cols-[180px_1fr] lg:gap-12"><Text variant="dataLabel">Related runbooks</Text><Stack gap={4}><RelatedPages pages={[...matchingIndustries.map((industry) => ({ label: `${industry.name} industry`, href: `/industries/${industry.slug}` })), { label: "See the implementation journey", href: "/implementation" }, { label: "See all workflows", href: "/workflows" }]} /></Stack></div></Container>
      </Section>

      <Section tone="inverse" paddingTop={{ base: 14, sm: 18 }} paddingBottom={{ base: 14, sm: 18 }}>
        <Container><Reveal className="grid items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12"><div className="max-w-[820px]"><span className="vl-index text-white/50">RUNBOOK → LIVE TRANSACTION</span><Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">See the {workflow.name} workflow in a live demo.</Heading></div><TrackedCtaLink href={`/book-demo?workflow=${workflow.slug}`} event="workflow_cta_click" ctaLocation={`workflow_final_${workflow.slug}`}>Book a Demo</TrackedCtaLink></Reveal></Container>
      </Section>

      <script {...jsonLdScriptProps(webPageJsonLd)} />
      {faqPageJsonLd ? <script {...jsonLdScriptProps(faqPageJsonLd)} /> : null}
    </>
  );
}
