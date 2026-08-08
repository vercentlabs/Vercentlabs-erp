import { POSITIONING, LANDING_MODULES, getIndustry, getWorkflow, getSolution, ROUTED_WORKFLOW_SLUGS, getLandingModule } from "@vercentlabs/landing-content";
import { Container, Section, Stack, Grid } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { FeatureList } from "@/components/ui/card";
import { DemoForm } from "@/components/marketing/demo-form";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "Book a Product Demo",
  description: "See Vercentlabs ERP adapted to your business — the modules and workflows you'd actually use, walked through by a specialist.",
  path: "/book-demo",
});

/**
 * `?module=`, `?industry=`, `?workflow=`, `?solution=`, or `?intent=specialist`
 * preselect the relevant module checkboxes and change the page's lead copy —
 * read via the page's native `searchParams` prop (a Server Component
 * convention), not `useSearchParams()`/`Suspense`. That avoids the exact
 * hydration-race defect class the thank-you page hit in Phase 3 (see
 * docs/landing-redesign/phase-3/implementation-summary.md, defect #1). Every
 * value is validated against a real, typed registry server-side before use —
 * an unrecognized slug is silently ignored, never trusted as-is, and no PII
 * ever flows through these params. Checked in this priority order when more
 * than one is present (a real referring page only ever sends one, but
 * resolution stays deterministic either way): module, industry, workflow,
 * solution, intent. `intent=specialist` (sent by the homepage's "Talk to an
 * ERP Specialist" CTA — see CTAS.talkToSpecialist in navigation.js) previously
 * had no effect at all despite the CTA's distinct label implying a different
 * experience — a real gap found in Phase 7's Cycle 2 CRO review.
 */
export default async function BookDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string; industry?: string; workflow?: string; solution?: string; intent?: string }>;
}) {
  const {
    module: moduleSlug,
    industry: industrySlug,
    workflow: workflowSlug,
    solution: solutionSlug,
    intent,
  } = await searchParams;

  let initialModuleKeys: string[] = [];
  let contextLabel: string | null = null;

  const matchedModule = moduleSlug ? LANDING_MODULES.find((m) => m.key === moduleSlug) : undefined;
  const matchedIndustry = !matchedModule && industrySlug ? getIndustry(industrySlug) : null;
  const matchedWorkflow =
    !matchedModule && !matchedIndustry && workflowSlug && ROUTED_WORKFLOW_SLUGS.includes(workflowSlug) ? getWorkflow(workflowSlug) : null;
  const matchedSolution = !matchedModule && !matchedIndustry && !matchedWorkflow && solutionSlug ? getSolution(solutionSlug) : null;
  const isSpecialistIntent = !matchedModule && !matchedIndustry && !matchedWorkflow && !matchedSolution && intent === "specialist";

  if (matchedModule) {
    initialModuleKeys = [matchedModule.key];
    contextLabel = `We'll focus this session on ${matchedModule.name}.`;
  } else if (matchedIndustry) {
    initialModuleKeys = matchedIndustry.moduleStack.map((entry) => entry.moduleKey);
    contextLabel = `Built for ${matchedIndustry.name.toLowerCase()} operations like yours.`;
  } else if (matchedWorkflow) {
    initialModuleKeys = matchedWorkflow.modules;
    contextLabel = `See the ${matchedWorkflow.name} workflow running in your business.`;
  } else if (matchedSolution) {
    initialModuleKeys = matchedSolution.relatedModuleKeys;
    contextLabel = `We'll focus this session on: ${matchedSolution.name.toLowerCase()}.`;
  } else if (isSpecialistIntent) {
    contextLabel = "We'll pair you with a specialist who can answer detailed implementation and rollout questions.";
  }

  const initialModuleNames = initialModuleKeys
    .map((key) => getLandingModule(key)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <Section tone="page" className="pt-10 sm:pt-14">
      <Container>
        <Breadcrumbs trail={[{ name: "Book a Demo", path: "/book-demo" }]} />
        <Grid columns={2} gap={10} className="mt-6 items-start">
          <Stack gap={5} className="lg:sticky lg:top-24">
            <Heading level="h1">See how Vercentlabs would run in your business.</Heading>
            <Text variant="lead">
              {`${POSITIONING.heroSubhead} Book a demo and we'll walk through the modules and workflows relevant to your operation — not a generic product tour.`}
            </Text>
            {contextLabel ? (
              <div className="rounded-(--radius-control) border border-(--color-border-brand) bg-(--color-bg-elevated) px-4 py-3">
                <Text variant="label">{contextLabel}</Text>
              </div>
            ) : null}
            <div>
              <Text variant="label">What to expect</Text>
              <FeatureList
                className="mt-3"
                items={[
                  "A 30-minute working session focused on your actual operations, not a slide deck.",
                  "Real product screens — the same system you'd actually use, not a mockup.",
                  "A specialist who can answer specific questions about your modules of interest.",
                  "No obligation, and no pressure to decide on the call.",
                ]}
              />
            </div>
          </Stack>
          <div className="rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-bg-elevated) p-6 shadow-(--shadow-panel) sm:p-8">
            <DemoForm initialModules={initialModuleNames} />
          </div>
        </Grid>
      </Container>
    </Section>
  );
}
