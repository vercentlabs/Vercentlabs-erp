import { Container, Section, SectionHeader, Grid } from "@/components/layout/container";
import { Text } from "@/components/ui/text";
import { ProductScreenshot } from "@/components/product/product-frame";
import { getApprovedScreenshot } from "@/lib/product/screenshots";
import type { ModuleScreenshotRefs } from "@vercentlabs/landing-content";

/**
 * Renders nothing if no screenshot is approved for this module yet — the
 * honest empty state, not a forced placeholder (per Phase 3's "no screenshots
 * ever force-fabricated" rule). Never shows a broken or empty-dashboard
 * capture as proof.
 */
export function ProductEvidenceSection({
  screenshots,
  moduleName,
  accentColor,
  featuredOutcome,
}: {
  screenshots: ModuleScreenshotRefs;
  moduleName: string;
  accentColor: string;
  /** The module's first businessOutcomes entry — real, already-authored copy used to
   * fill the second column when there's no secondary screenshot, instead of stretching
   * a single image to the full container width. Deliberately not primaryWorkflow.outcome:
   * that exact sentence already appears immediately above in the "See it work" section,
   * and repeating it verbatim one scroll later reads as a copy-paste mistake rather than
   * reinforcement. businessOutcomes is shown much further up the page instead. */
  featuredOutcome?: { title: string; description: string };
}) {
  const primary = screenshots.primary ? getApprovedScreenshot(screenshots.primary) : null;
  const secondary = screenshots.secondary ? getApprovedScreenshot(screenshots.secondary) : null;

  if (!primary && !secondary) return null;

  return (
    <Section tone="page">
      <Container>
        <SectionHeader eyebrow="See it in the product" title={`Real ${moduleName} screens, not mockups.`} />
        <Grid columns={2} gap={8} className="mt-10 items-center">
          {primary ? <ProductScreenshot id={primary.id} moduleAccentColor={accentColor} /> : null}
          {secondary ? (
            <ProductScreenshot id={secondary.id} moduleAccentColor={accentColor} />
          ) : featuredOutcome ? (
            <div className="rounded-(--radius-panel) border border-(--color-border-brand) bg-(--color-bg-elevated) p-6">
              <Text variant="label">{featuredOutcome.title}</Text>
              <Text variant="bodyLarge" className="mt-2">
                {featuredOutcome.description}
              </Text>
            </div>
          ) : null}
        </Grid>
      </Container>
    </Section>
  );
}
