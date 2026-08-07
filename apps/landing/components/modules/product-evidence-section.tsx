import { Container, Section, SectionHeader, Grid } from "@/components/layout/container";
import { ProductScreenshot } from "@/components/product/product-frame";
import { getApprovedScreenshot } from "@/lib/product/screenshots";
import type { ModuleScreenshotRefs } from "@vercentlabs/landing-content";

/**
 * Renders nothing if no screenshot is approved for this module yet — the
 * honest empty state, not a forced placeholder (per Phase 3's "no screenshots
 * ever force-fabricated" rule). Never shows a broken or empty-dashboard
 * capture as proof.
 */
export function ProductEvidenceSection({ screenshots, moduleName, accentColor }: { screenshots: ModuleScreenshotRefs; moduleName: string; accentColor: string }) {
  const primary = screenshots.primary ? getApprovedScreenshot(screenshots.primary) : null;
  const secondary = screenshots.secondary ? getApprovedScreenshot(screenshots.secondary) : null;

  if (!primary && !secondary) return null;

  return (
    <Section tone="page">
      <Container>
        <SectionHeader eyebrow="See it in the product" title={`Real ${moduleName} screens, not mockups.`} />
        <Grid columns={secondary ? 2 : 1} gap={8} className="mt-10">
          {primary ? <ProductScreenshot id={primary.id} moduleAccentColor={accentColor} /> : null}
          {secondary ? <ProductScreenshot id={secondary.id} moduleAccentColor={accentColor} /> : null}
        </Grid>
      </Container>
    </Section>
  );
}
