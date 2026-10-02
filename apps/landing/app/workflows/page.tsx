import Link from "next/link";
import { CTAS, WORKFLOWS_INDEX_PAGE, getLandingModule, getRoutedWorkflows, type LandingWorkflow } from "@vercentlabs/landing-content";
import { Container, Section } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { TrackView } from "@/components/analytics/track-view";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { WorkflowModulePath } from "@/components/workflows/workflow-module-path";
import { buildPageMetadata } from "@/lib/metadata";
import { jsonLdScriptProps } from "@/lib/seo/json-ld";
import { absoluteUrl } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: WORKFLOWS_INDEX_PAGE.title,
  description: WORKFLOWS_INDEX_PAGE.metaDescription,
  path: WORKFLOWS_INDEX_PAGE.slug,
});

const moduleKeysOf = (workflow: LandingWorkflow) => [...new Set(workflow.sequence?.map((step) => step.moduleKey))];

function WorkflowCard({ workflow }: { workflow: LandingWorkflow }) {
  return (
    <li className="border border-(--color-border-strong) bg-(--vl-paper-strong)">
      <Link href={`/workflows/${workflow.slug}`} prefetch={false} className="group grid grid-cols-1 gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] lg:gap-10">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-semibold tracking-[-0.035em] text-(--color-text-primary) group-hover:text-(--color-text-brand)">
            {workflow.name}
            <span className="vl-hover-arrow text-base text-(--color-text-muted)" aria-hidden="true">
              →
            </span>
          </h3>
          <p className="mt-2 text-sm leading-[1.6] text-(--color-text-secondary)">{workflow.summary}</p>
          <p className="vl-index mt-4">
            {workflow.sequence?.length ?? 0} steps · {moduleKeysOf(workflow).map((key) => getLandingModule(key)?.displayName ?? key).join(", ")}
          </p>
        </div>
        <WorkflowModulePath slug={workflow.slug} className="self-center" />
      </Link>
    </li>
  );
}

export default function WorkflowsIndexPage() {
  const page = WORKFLOWS_INDEX_PAGE;
  const workflows = getRoutedWorkflows();
  const crossModule = workflows.filter((workflow) => moduleKeysOf(workflow).length > 1);
  const singleModule = workflows.filter((workflow) => moduleKeysOf(workflow).length <= 1);

  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: page.title,
    description: page.metaDescription,
    url: absoluteUrl(page.slug),
    hasPart: workflows.map((workflow) => ({ "@type": "WebPage", name: workflow.name, url: absoluteUrl(`/workflows/${workflow.slug}`) })),
  };

  return (
    <>
      <TrackView event="workflows_index_view">
        <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
          <Container>
            <Breadcrumbs trail={[{ name: "Workflows", path: "/workflows" }]} />
          </Container>
        </Section>
        <Section tone="page" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 10, sm: 12 }}>
          <Container>
            <div className="reveal-on-load grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end lg:gap-16">
              <div>
                <Text variant="eyebrow">{page.eyebrow}</Text>
                <Heading level="h1" className="mt-5 max-w-[14ch]">
                  {page.heading}
                </Heading>
              </div>
              <Text variant="lead">{page.supportingText}</Text>
            </div>
          </Container>
        </Section>
      </TrackView>

      <Section tone="page" paddingTop={{ base: 0 }}>
        <Container>
          <h2 className="vl-kicker">{page.listHeading}</h2>
          <ul className="mt-6 grid gap-4">
            {crossModule.map((workflow) => (
              <WorkflowCard key={workflow.slug} workflow={workflow} />
            ))}
          </ul>
          {singleModule.length ? (
            <div className="mt-12">
              <h2 className="vl-kicker">{page.singleModuleHeading}</h2>
              <p className="mt-3 max-w-[64ch] text-sm leading-[1.6] text-(--color-text-secondary)">{page.singleModuleSupportingText}</p>
              <ul className="mt-6 grid gap-4">
                {singleModule.map((workflow) => (
                  <WorkflowCard key={workflow.slug} workflow={workflow} />
                ))}
              </ul>
            </div>
          ) : null}
        </Container>
      </Section>

      <Section tone="inverse" className="vl-noise-free">
        <Container>
          <div className="grid grid-cols-1 items-end gap-8 border-t border-white/20 pt-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
            <div>
              <Heading level="h2" className="max-w-[22ch] text-white">
                {page.finalCta.heading}
              </Heading>
              <p className="mt-4 max-w-[60ch] text-sm leading-[1.65] text-white/75">{page.finalCta.supportingText}</p>
            </div>
            <TrackedCtaLink href={CTAS.talkToSpecialist.href} event="workflow_cta_click" ctaLocation="workflows_index_final" variant="inverse">
              {CTAS.talkToSpecialist.label}
            </TrackedCtaLink>
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
