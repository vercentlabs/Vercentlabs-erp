import { POSITIONING, LANDING_MODULES } from "@vercentlabs/landing-content";
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
 * `?module={slug}` preselects the matching module checkbox — read via the
 * page's native `searchParams` prop (a Server Component convention), not
 * `useSearchParams()`/`Suspense`. That avoids the exact hydration-race defect
 * class the thank-you page hit in Phase 3 (see docs/landing-redesign/phase-3/
 * implementation-summary.md, defect #1). The value is validated against the
 * real module catalog server-side before use — an unrecognized slug is
 * silently ignored, never trusted as-is.
 */
export default async function BookDemoPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const { module: moduleSlug } = await searchParams;
  const initialModule = LANDING_MODULES.find((module) => module.key === moduleSlug)?.name;

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
            <DemoForm initialModule={initialModule} />
          </div>
        </Grid>
      </Container>
    </Section>
  );
}
