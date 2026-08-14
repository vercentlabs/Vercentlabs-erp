import Link from "next/link";
import { ROUTED_WORKFLOW_SLUGS, getWorkflow } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { CollectionHero } from "@/components/shared/collection-hero";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
import { Reveal } from "@/components/motion/reveal";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Cross-Module Workflows",
  description: "See real cross-module workflows in Vercentlabs ERP — lead to cash, procure to pay, order to fulfilment, plan to production, project profitability, and hire to payroll.",
  path: "/workflows",
});

export default function WorkflowsIndexPage() {
  const workflows = ROUTED_WORKFLOW_SLUGS.map((slug) => getWorkflow(slug)).filter((w): w is NonNullable<typeof w> => Boolean(w));

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Cross-Module Workflows",
    description: "Vercentlabs ERP's real, cited cross-module workflows.",
    url: absoluteUrl("/workflows"),
    hasPart: workflows.map((workflow) => ({ "@type": "WebPage", name: workflow.name, url: absoluteUrl(`/workflows/${workflow.slug}`) })),
  };

  return (
    <>
      <TrackView event="workflows_index_view">
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container><Breadcrumbs trail={[{ name: "Workflows", path: "/workflows" }]} /></Container>
        </Section>
        <CollectionHero
          eyebrow="Cross-module workflows"
          heading="See the real sequence, not a marketing diagram."
          supportingText="Every workflow is a real sequence — trigger, steps, approvals, automation, and honest exceptions across connected modules."
          listLabel="End-to-end flows"
          items={workflows.map((workflow) => ({ label: workflow.name, meta: `${workflow.modules.length} modules` }))}
          variant="workflows"
        />
      </TrackView>

      <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
        <Container>
          <SectionHeader eyebrow="Runbook index" title="Six sequences. Every handoff visible." description="Open a runbook to inspect its trigger, participants, module handoffs, approval gates, automated actions, exceptions and business value." />
          <Reveal group>
            <ol className="mt-10 border-y border-(--color-border-strong)">
              {workflows.map((workflow, index) => (
                <li key={workflow.slug} data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}>
                  <Link href={`/workflows/${workflow.slug}`} prefetch={false} className="group grid gap-5 border-t border-(--color-border-default) py-7 first:border-t-0 md:grid-cols-[90px_minmax(260px,.8fr)_minmax(0,1.2fr)_120px] md:items-center md:gap-8 md:py-9">
                    <div className="flex items-center gap-3 md:block">
                      <span className="flex h-12 w-12 items-center justify-center border border-(--color-border-strong) bg-(--color-bg-elevated) font-mono text-xs font-bold text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                      <span className="vl-index md:mt-2 md:block">RUN / {String(workflow.modules.length).padStart(2, "0")}</span>
                    </div>
                    <div>
                      <Heading level="h3" className="group-hover:text-(--color-text-brand)">{workflow.name}</Heading>
                      <Text variant="bodySmall" className="mt-2 max-w-[56ch]">{workflow.summary}</Text>
                    </div>
                    <div>
                      <span className="vl-index">Module path</span>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {workflow.modules.map((moduleKey, moduleIndex) => (
                          <span key={`${moduleKey}-${moduleIndex}`} className="flex items-center gap-2">
                            <span className="text-[0.67rem] font-bold uppercase tracking-[0.08em] text-(--color-text-primary)">{moduleKey}</span>
                            {moduleIndex < workflow.modules.length - 1 ? <span className="text-xs text-(--color-text-muted)" aria-hidden="true">→</span> : null}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="md:text-right">
                      <span className="vl-index">Open runbook</span>
                      <span className="vl-hover-arrow mt-2 block text-xl text-(--color-text-brand)" aria-hidden="true">→</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </Reveal>
        </Container>
      </Section>

      <Section tone="inverse" paddingTop={{ base: 14, sm: 18 }} paddingBottom={{ base: 14, sm: 18 }}>
        <Container>
          <Reveal className="grid items-end gap-8 border-y border-white/20 py-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:py-12">
            <div className="max-w-[820px]">
              <span className="vl-index text-white/50">RUNBOOK / LIVE SESSION</span>
              <Heading level="h1" as="h2" className="mt-4 text-(--color-text-inverse)">See a real workflow run end to end.</Heading>
            </div>
            <TrackedCtaLink href="/book-demo" event="workflow_cta_click" ctaLocation="workflows_index_final">Book a Demo</TrackedCtaLink>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
