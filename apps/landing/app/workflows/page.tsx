import Link from "next/link";
import { ROUTED_WORKFLOW_SLUGS, getWorkflow } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { InformationBand } from "@/components/ui/card";
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
    hasPart: workflows.map((workflow) => ({
      "@type": "WebPage",
      name: workflow.name,
      url: absoluteUrl(`/workflows/${workflow.slug}`),
    })),
  };

  return (
    <>
      <TrackView event="workflows_index_view">
        {/* Header is a sticky h-16 (4rem) bar — this wrapper fills exactly the
            remaining viewport height, so the hero neither leaves dead space
            above the next section nor requires a scroll to see all of it. */}
        <div>
          <Section tone="page" paddingTop={{ base: 6 }} paddingBottom={{ base: 0 }}>
            <Container>
              <Breadcrumbs trail={[{ name: "Workflows", path: "/workflows" }]} />
            </Container>
          </Section>

          <CollectionHero
            eyebrow="Cross-module workflows"
            heading="See the real sequence, not a marketing diagram."
            supportingText="Every workflow is a real sequence — trigger, steps, approvals, automation, and honest exceptions across connected modules."
            listLabel="End-to-end flows"
            items={workflows.map((workflow) => ({ label: workflow.name, meta: `${workflow.modules.length} modules` }))}
          />
        </div>
      </TrackView>

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Choose a workflow" title="Six real, cross-module sequences." />
          <Reveal group>
            <div className="mt-10 flex flex-col">
              {workflows.map((workflow, index) => (
                <InformationBand key={workflow.slug} data-reveal-item style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}>
                  <div className="sm:w-3/5">
                    <Link href={`/workflows/${workflow.slug}`} prefetch={false}>
                      <Heading level="h3">{workflow.name}</Heading>
                    </Link>
                    <Text variant="bodySmall" className="mt-2 max-w-[60ch]">
                      {workflow.summary}
                    </Text>
                  </div>
                  <div className="sm:w-1/5">
                    <Text variant="caption">Modules</Text>
                    <Text variant="bodySmall" className="mt-1">
                      {workflow.modules.join(", ")}
                    </Text>
                  </div>
                  <Link
                    href={`/workflows/${workflow.slug}`}
                    prefetch={false}
                    className="flex-none text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4"
                  >
                    View workflow →
                  </Link>
                </InformationBand>
              ))}
            </div>
          </Reveal>
        </Container>
      </Section>

      <Section tone="inverse">
        <Container>
          <Reveal className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              See a real workflow run end to end.
            </Heading>
            <div className="mt-6 flex justify-center">
              <Inline gap={3}>
                <TrackedCtaLink href="/book-demo" event="workflow_cta_click" ctaLocation="workflows_index_final">
                  Book a Demo
                </TrackedCtaLink>
              </Inline>
            </div>
          </Reveal>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
