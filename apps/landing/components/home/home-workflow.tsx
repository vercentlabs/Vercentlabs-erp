import Link from "next/link";
import { CONNECTED_WORKFLOWS_SECTION, getLandingModule, getWorkflow, type LandingWorkflow } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { ModuleChip } from "@/components/ui/tag";
import { TrackView } from "@/components/analytics/track-view";
import { WorkflowSwimlane } from "@/components/workflows/workflow-swimlane";
import { WorkflowTabs } from "@/components/workflows/workflow-tabs";

export function HomeWorkflow() {
  const workflows = CONNECTED_WORKFLOWS_SECTION.workflowSlugs
    .map((slug) => getWorkflow(slug))
    .filter((workflow): workflow is LandingWorkflow => workflow !== null && Array.isArray(workflow.sequence));

  const tabs = workflows.map((workflow) => {
    const moduleCount = new Set(workflow.sequence?.map((step) => step.moduleKey)).size;
    return { slug: workflow.slug, label: workflow.name, meta: `${workflow.sequence?.length ?? 0} steps · ${moduleCount} ${moduleCount === 1 ? "module" : "modules"}` };
  });

  const panels = workflows.map((workflow) => (
    <article key={workflow.slug} aria-labelledby={`workflow-heading-${workflow.slug}`}>
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-10">
        <div>
          <h3 id={`workflow-heading-${workflow.slug}`} className="text-xl font-semibold tracking-[-0.035em] text-(--color-text-primary)">
            {workflow.name}
          </h3>
          <p className="mt-2 max-w-[78ch] text-sm leading-[1.65] text-(--color-text-secondary)">{workflow.summary}</p>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label={`Modules in ${workflow.name}`}>
          {[...new Set(workflow.sequence?.map((step) => step.moduleKey))].map((key) => {
            const landingModule = getLandingModule(key);
            return landingModule ? (
              <li key={key}>
                <ModuleChip name={landingModule.displayName} accentColor={landingModule.accentColor.hex} />
              </li>
            ) : null;
          })}
        </ul>
      </div>
      <WorkflowSwimlane steps={workflow.sequence ?? []} />
      <div className="mt-6 flex justify-end border-t border-(--color-border-default) pt-4">
        <Link href={`/workflows/${workflow.slug}`} prefetch={false} className="group inline-flex items-center gap-2 text-sm font-semibold text-(--color-text-brand)">
          <span className="vl-editorial-link">See the full {workflow.name} workflow</span>
          <span className="vl-hover-arrow" aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  ));

  return (
    <TrackView event="workflow_view" properties={{ section: CONNECTED_WORKFLOWS_SECTION.id }}>
      <Section tone="page">
        <Container>
          <SectionHeader
            eyebrow={CONNECTED_WORKFLOWS_SECTION.eyebrow}
            title={CONNECTED_WORKFLOWS_SECTION.heading}
            description={CONNECTED_WORKFLOWS_SECTION.supportingText}
          />
          <div className="mt-10 lg:mt-12">
            <WorkflowTabs
              label="Connected workflows"
              tabs={tabs}
              panels={panels}
              interactionEvent={CONNECTED_WORKFLOWS_SECTION.interactionAnalyticsId}
            />
          </div>
        </Container>
      </Section>
    </TrackView>
  );
}
