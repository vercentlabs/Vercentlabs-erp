import type { LandingModule } from "@vercentlabs/landing-content";
import { Container, Section, Stack, Inline, Grid, SplitLayout } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Metric } from "@/components/ui/card";
import { ModuleTag } from "@/components/ui/tag";
import { ProductScreenshot, WorkflowConnector } from "@/components/product/product-frame";
import { NumberedSteps } from "@/components/marketing/numbered-steps";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { getApprovedScreenshot } from "@/lib/product/screenshots";

/**
 * Four controlled hero layouts (per docs/landing-redesign/phase-4/
 * page-differentiation-matrix.md), chosen per module by evidence strength —
 * never assumed to have a screenshot. A module assigned "screenshot-led" or
 * "dashboard-led" whose primary screenshot isn't actually approved yet falls
 * back to "operational-sequence" rather than reproducing Phase 3's empty-hero
 * defect (docs/landing-redesign/phase-3/implementation-summary.md, defect #2).
 *
 * Note: the prop is named `landingModule`, not `module` — Next.js's
 * no-assign-module-variable lint rule flags `module` as an identifier
 * (it shadows the CommonJS module object at build time).
 */
export function ModuleHero({ landingModule }: { landingModule: LandingModule }) {
  const primaryScreenshot = landingModule.screenshots.primary ? getApprovedScreenshot(landingModule.screenshots.primary) : null;
  const wantsScreenshot = landingModule.heroVariant === "screenshot-led" || landingModule.heroVariant === "dashboard-led";
  const effectiveVariant = wantsScreenshot && !primaryScreenshot ? "operational-sequence" : landingModule.heroVariant;

  const navGroupLabel =
    landingModule.navGroup === "revenue"
      ? "Revenue"
      : landingModule.navGroup === "operations"
        ? "Operations"
        : landingModule.navGroup === "finance"
          ? "Finance"
          : landingModule.navGroup === "delivery"
            ? "Delivery"
            : "People & Service";

  const copy = (
    <Stack gap={5}>
      <Text variant="eyebrow">{navGroupLabel} module</Text>
      <Heading level="display" as="h1">
        {landingModule.name}
      </Heading>
      <Text variant="lead">{landingModule.bestAngle}</Text>
      <Inline gap={3}>
        <TrackedCtaLink href={`/book-demo?module=${landingModule.key}`} event="module_hero_cta_click" ctaLocation={`module_hero_${landingModule.key}`}>
          Book a Product Demo
        </TrackedCtaLink>
        <TrackedCtaLink href="/product/platform" event="platform_cta_click" ctaLocation={`module_hero_${landingModule.key}`} variant="secondary">
          Explore the Platform
        </TrackedCtaLink>
      </Inline>
      <Inline gap={6} className="mt-1 flex-wrap">
        <Metric label="Capability groups" value={String(landingModule.capabilityGroups.length)} />
        <Metric label="Connected modules" value={String(landingModule.connectedModules.length)} />
        {/* ModuleTag is a color legend, not a provenance claim about where the
            accent color came from — shown for all 12 modules for hero-row
            rhythm consistency (a Phase 4 Cycle 2 brand review found the
            product-sourced-only gate here was an unintended side effect of
            the "don't claim landing-original colors are product colors" copy
            rule leaking into a layout decision it doesn't actually apply to). */}
        <ModuleTag name={landingModule.name} accentColor={landingModule.accentColor.hex} />
      </Inline>
    </Stack>
  );

  return (
    <Section tone="page" className="pt-12 sm:pt-16">
      <Container>
        {effectiveVariant === "screenshot-led" || effectiveVariant === "dashboard-led" ? (
          <SplitLayout ratio="primary-wide" primary={copy} secondary={primaryScreenshot ? <ProductScreenshot id={primaryScreenshot.id} moduleAccentColor={landingModule.accentColor.hex} /> : null} />
        ) : null}

        {effectiveVariant === "workflow-led" ? (
          <Stack gap={10}>
            {copy}
            <div className="overflow-x-auto">
              <WorkflowConnector
                className="min-w-[640px] lg:min-w-0"
                steps={landingModule.primaryWorkflow.steps.map((step) => ({ label: step.step, accentColor: landingModule.accentColor.hex }))}
              />
            </div>
          </Stack>
        ) : null}

        {effectiveVariant === "operational-sequence" ? (
          <Grid columns={2} gap={10} className="items-start">
            {copy}
            <NumberedSteps
              steps={landingModule.primaryWorkflow.steps.map((step, index) => ({ step: String(index + 1).padStart(2, "0"), title: step.step, description: step.detail }))}
            />
          </Grid>
        ) : null}
      </Container>
    </Section>
  );
}
