

import { POSITIONING, LANDING_MODULES, getIndustry, getWorkflow, getSolution, ROUTED_WORKFLOW_SLUGS, getLandingModule } from "@vercentlabs/landing-content";
import { Container, Section, Stack } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { FeatureList } from "@/components/ui/card";
import { DemoForm } from "@/components/marketing/demo-form";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Reveal } from "@/components/motion/reveal";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "Book a Demo",
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
    <Section tone="page" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 14, sm: 18 }}>
      <Container>
        <Breadcrumbs trail={[{ name: "Book a Demo", path: "/book-demo" }]} />
        <div className="mt-8 border-t border-(--color-border-strong) pt-5">
          <div className="flex items-center justify-between gap-4">
            <Text variant="eyebrow">Demo request</Text>
            <span className="vl-folio">DEMO INTAKE / WORKING SESSION</span>
          </div>
          <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(280px,.72fr)_minmax(0,1.28fr)] lg:gap-16">
          <div className="py-2 lg:py-4">
            <Stack gap={5} className="reveal-on-load lg:sticky lg:top-24">
              <Heading level="display" as="h1" className="max-w-[9ch]">See how Vercentlabs would run in your business.</Heading>
              <Text variant="lead">
                {`${POSITIONING.heroSubhead} Book a demo and we'll walk through the modules and workflows relevant to your operation — not a generic product tour.`}
              </Text>
              {contextLabel ? (
                <div className="grid grid-cols-[5px_1fr] border-y border-r border-(--color-border-brand) bg-(--color-bg-elevated)">
                  <span className="bg-(--color-bg-brand)" aria-hidden="true" />
                  <div className="px-4 py-3"><Text variant="label">{contextLabel}</Text></div>
                </div>
              ) : null}
              <div className="mt-2 grid grid-cols-3 border-y border-(--color-border-default)">
                {[['01','Context'],['02','Workflow'],['03','Questions']].map(([number,label]) => (
                  <div key={number} className="border-r border-(--color-border-default) py-3 pr-3 last:border-r-0 last:pl-3 first:pr-3">
                    <span className="vl-index">{number}</span><p className="mt-1 text-xs font-semibold text-(--color-text-primary)">{label}</p>
                  </div>
                ))}
              </div>
              <Reveal group>
                <Text variant="dataLabel">Session protocol</Text>
                <FeatureList
                  className="mt-4"
                  items={[
                    "A 30-minute working session focused on your actual operations, not a slide deck.",
                    "Real product screens — the same system you'd actually use, not a mockup.",
                    "A specialist who can answer specific questions about your modules of interest.",
                    "No obligation, and no pressure to decide on the call.",
                  ]}
                />
              </Reveal>
            </Stack>
          </div>
          <div className="border-t border-(--color-border-strong) bg-(--color-bg-elevated) px-5 py-7 sm:px-7 sm:py-9 lg:px-9 lg:py-10">
            <div className="mb-6 flex items-end justify-between border-b border-(--color-border-default) pb-4">
              <div><Text variant="dataLabel">Demo request</Text><p className="mt-1 text-sm text-(--color-text-secondary)">Only four fields plus consent are required.</p></div>
              <span className="vl-index">INTAKE / 01</span>
            </div>
            <DemoForm initialModules={initialModuleNames} />
          </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
