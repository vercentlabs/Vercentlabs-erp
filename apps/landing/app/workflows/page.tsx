import Link from "next/link";
import { ROUTED_WORKFLOW_SLUGS, getWorkflow } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader, Stack, Inline } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { InformationBand } from "@/components/ui/card";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { TrackView } from "@/components/analytics/track-view";
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
        <Section tone="page" className="pb-0 pt-6">
          <Container>
            <Breadcrumbs trail={[{ name: "Workflows", path: "/workflows" }]} />
          </Container>
        </Section>

        <Section tone="page" className="pt-8 sm:pt-10">
          <Container>
            <Stack gap={5} className="max-w-[760px]">
              <Text variant="eyebrow">Cross-module workflows</Text>
              <Heading level="display" as="h1">
                See the real sequence, not a marketing diagram.
              </Heading>
              <Text variant="lead">
                Every workflow below is a real, cited sequence — trigger, steps, approvals, automation, and honest exceptions —
                not an illustrative arrow diagram.
              </Text>
            </Stack>
          </Container>
        </Section>
      </TrackView>

      <Section tone="page">
        <Container>
          <SectionHeader eyebrow="Choose a workflow" title="Six real, cross-module sequences." />
          <div className="mt-10 flex flex-col">
            {workflows.map((workflow) => (
              <InformationBand key={workflow.slug}>
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
        </Container>
      </Section>

      <Section tone="inverse">
        <Container>
          <div className="mx-auto max-w-[640px] text-center">
            <Heading level="h1" as="h2" className="text-(--color-text-inverse)">
              See a real workflow run end to end.
            </Heading>
            <div className="mt-6 flex justify-center">
              <Inline gap={3}>
                <TrackedCtaLink href="/book-demo" event="workflow_cta_click" ctaLocation="workflows_index_final">
                  Book a Product Demo
                </TrackedCtaLink>
              </Inline>
            </div>
          </div>
        </Container>
      </Section>

      <script {...jsonLdScriptProps(collectionJsonLd)} />
    </>
  );
}
