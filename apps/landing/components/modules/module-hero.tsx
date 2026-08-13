import type { LandingModule } from "@vercentlabs/landing-content";
import { cx } from "@/lib/utils";
import { Container, Section, Stack, Inline, SplitLayout } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { Metric } from "@/components/ui/card";
import { ModuleTag } from "@/components/ui/tag";
import { ProductScreenshot } from "@/components/product/product-frame";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { getApprovedScreenshot } from "@/lib/product/screenshots";

/**
 * Every module hero fills a full viewport-height section — this used to be
 * conditional on having a real screenshot (a bare copy-only hero reads fine full
 * height; a short numbered-step list stretched the same way left 150-200px of dead
 * space). The 10 modules without a screenshot yet no longer render that step list in
 * the hero at all (it was redundant with the fuller "See it work" section further
 * down the page anyway) — just the copy, centered, with the right side reserved for
 * the real product screenshot/video each of these modules will get. Once
 * screenshots.primary is set and approved for a module, it renders there automatically.
 */
export function ModuleHero({ landingModule, className }: { landingModule: LandingModule; className?: string }) {
  const primaryScreenshot = landingModule.screenshots.primary ? getApprovedScreenshot(landingModule.screenshots.primary) : null;

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
    <Stack gap={5} className="reveal-on-load h-full max-w-[720px]">
      <Text variant="eyebrow">{navGroupLabel} module</Text>
      <Heading level="display" as="h1">
        {landingModule.name}
      </Heading>
      <Text variant="lead">{landingModule.bestAngle}</Text>
      <Inline gap={3}>
        <TrackedCtaLink href={`/book-demo?module=${landingModule.key}`} event="module_hero_cta_click" ctaLocation={`module_hero_${landingModule.key}`}>
          Book a Demo
        </TrackedCtaLink>
        <TrackedCtaLink href="/product/platform" event="platform_cta_click" ctaLocation={`module_hero_${landingModule.key}`} variant="secondary">
          Explore the Platform
        </TrackedCtaLink>
      </Inline>
      <Inline gap={6} className="mt-1 flex-wrap sm:mt-auto">
        <Metric label="Capability groups" value={String(landingModule.capabilityGroups.length)} />
        <Metric label="Connected modules" value={String(landingModule.connectedModules.length)} />
        {/* ModuleTag is a color legend, not a provenance claim about where the
            accent color came from — shown for all 12 modules for hero-row
            rhythm consistency (a Phase 4 Cycle 2 brand review found the
            product-sourced-only gate here was an unintended side effect of
            the "don't claim landing-original colors are product colors" copy
            rule leaking into a layout decision it doesn't actually apply to).
            Hidden from `sm` up: the module name is already the H1 right above
            it, so on anything wider than mobile this tag is pure repetition —
            on mobile it still earns its place as a compact colour anchor next
            to the metrics once the heading has scrolled out of view. */}
        <ModuleTag name={landingModule.name} accentColor={landingModule.accentColor.hex} className="sm:hidden" />
      </Inline>
    </Stack>
  );

  return (
    <Section
      tone="page"
      paddingTop={{ base: 10, sm: 14 }}
      paddingBottom={{ base: 12, sm: 16 }}
      className={cx(className)}
    >
      <Container>
        <SplitLayout
          ratio="primary-wide"
          primary={copy}
          secondary={
            primaryScreenshot ? (
              <div className="reveal-on-load reveal-on-load-delay-1">
                <ProductScreenshot id={primaryScreenshot.id} moduleAccentColor={landingModule.accentColor.hex} />
              </div>
            ) : (
              <div className="reveal-on-load reveal-on-load-delay-1 border-t border-(--color-border-strong)">
                <div className="flex items-end justify-between border-b border-(--color-border-default) py-4">
                  <Text variant="caption">Capability map</Text>
                  <span className="tabular-data text-4xl font-semibold tracking-[-0.04em] text-(--color-text-primary)">
                    {String(landingModule.capabilityGroups.length).padStart(2, "0")}
                  </span>
                </div>
                <ol>
                  {landingModule.capabilityGroups.slice(0, 5).map((group, index) => (
                    <li key={group.name} className="grid grid-cols-[2rem_1fr] items-center gap-3 border-b border-(--color-border-default) py-3.5">
                      <span className="tabular-data text-xs font-medium" style={{ color: landingModule.accentColor.hex }}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="text-sm font-medium text-(--color-text-primary)">{group.name}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )
          }
        />
      </Container>
    </Section>
  );
}
