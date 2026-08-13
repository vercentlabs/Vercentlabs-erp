import Link from "next/link";
import { getLandingModule } from "@vercentlabs/landing-content";
import { cx } from "@/lib/utils";
import { Container, Section, Stack, Inline, SplitLayout } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ProductScreenshot } from "@/components/product/product-frame";
import { ModuleTag } from "@/components/ui/tag";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import { getApprovedScreenshot } from "@/lib/product/screenshots";
import type { AnalyticsEventName } from "@/lib/analytics";

export function PlatformHero({
  eyebrow,
  heading,
  supportingText,
  heroScreenshotId,
  connectedModuleKeys,
  ctaHref,
  ctaLabel,
  ctaEvent,
  ctaLocation,
  className,
}: {
  eyebrow: string;
  heading: string;
  supportingText: string;
  heroScreenshotId?: string;
  className?: string;
  /**
   * Real modules built on this capability, rendered as a color-tag cluster
   * when no screenshot exists — a Phase 4 Cycle 2 brand/design review found
   * all 6 platform-page heroes with no `heroScreenshotId` rendered as bare
   * copy over empty space (the explicitly prohibited "huge empty hero"
   * pattern). This uses real, already-modeled data (not a fabricated
   * diagram) as the visual anchor. See docs/landing-redesign/phase-4/decision-log.md.
   */
  connectedModuleKeys?: string[];
  ctaHref: string;
  ctaLabel: string;
  ctaEvent: AnalyticsEventName;
  ctaLocation: string;
}) {
  const screenshot = heroScreenshotId ? getApprovedScreenshot(heroScreenshotId) : null;
  const relatedModules = !screenshot && connectedModuleKeys ? connectedModuleKeys.map((key) => getLandingModule(key)).filter((m): m is NonNullable<typeof m> => Boolean(m)) : [];

  const copy = (
    <Stack gap={5} className={screenshot ? "reveal-on-load" : "reveal-on-load max-w-[720px]"}>
      <Text variant="eyebrow">{eyebrow}</Text>
      <Heading level="display" as="h1">
        {heading}
      </Heading>
      <Text variant="lead">{supportingText}</Text>
      <Inline gap={3}>
        <TrackedCtaLink href={ctaHref} event={ctaEvent} ctaLocation={ctaLocation}>
          {ctaLabel}
        </TrackedCtaLink>
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
        {screenshot ? (
          <SplitLayout
            ratio="primary-wide"
            primary={copy}
            secondary={
              <div className="reveal-on-load reveal-on-load-delay-1">
                <ProductScreenshot id={screenshot.id} priority />
              </div>
            }
          />
        ) : relatedModules.length > 0 ? (
          <SplitLayout
            ratio="primary-wide"
            primary={copy}
            secondary={
              <div className="reveal-on-load reveal-on-load-delay-1 border-t border-(--color-border-strong)">
                <div className="flex items-end justify-between border-b border-(--color-border-default) py-4">
                  <Text variant="caption">Connected modules</Text>
                  <span className="tabular-data text-4xl font-semibold tracking-[-0.04em] text-(--color-text-primary)">
                    {String(relatedModules.length).padStart(2, "0")}
                  </span>
                </div>
                <div className="flex flex-col">
                  {relatedModules.slice(0, 6).map((moduleInfo, index) => (
                    <Link
                      key={moduleInfo.key}
                      href={`/modules/${moduleInfo.key}`}
                      prefetch={false}
                      className="grid grid-cols-[2rem_1fr] items-center gap-3 border-b border-(--color-border-default) py-3.5"
                    >
                      <span className="tabular-data text-xs font-medium" style={{ color: moduleInfo.accentColor.hex }}>
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
                    </Link>
                  ))}
                </div>
              </div>
            }
          />
        ) : (
          copy
        )}
      </Container>
    </Section>
  );
}
