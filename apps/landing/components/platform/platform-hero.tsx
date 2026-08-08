import Link from "next/link";
import { getLandingModule } from "@vercentlabs/landing-content";
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
}: {
  eyebrow: string;
  heading: string;
  supportingText: string;
  heroScreenshotId?: string;
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
    <Stack gap={5} className={screenshot ? undefined : "max-w-[720px]"}>
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
    <Section tone="page" paddingTop={{ base: 12, sm: 16 }}>
      <Container>
        {screenshot ? (
          <SplitLayout ratio="primary-wide" primary={copy} secondary={<ProductScreenshot id={screenshot.id} priority />} />
        ) : (
          <Stack gap={8}>
            {copy}
            {relatedModules.length > 0 ? (
              <div className="border-t border-(--color-border-default) pt-6">
                <Text variant="caption">Built into</Text>
                <Inline gap={2} className="mt-3 flex-wrap">
                  {relatedModules.map((moduleInfo) => (
                    <Link key={moduleInfo.key} href={`/modules/${moduleInfo.key}`} prefetch={false}>
                      <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
                    </Link>
                  ))}
                </Inline>
              </div>
            ) : null}
          </Stack>
        )}
      </Container>
    </Section>
  );
}
