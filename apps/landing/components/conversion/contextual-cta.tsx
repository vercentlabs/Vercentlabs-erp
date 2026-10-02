import type { ReactNode } from "react";
import { CTAS } from "@vercentlabs/landing-content";
import { Container, Section, Inline } from "@/components/layout/container";
import { Text } from "@/components/ui/text";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import type { AnalyticsEventName } from "@/lib/analytics";

/**
 * The slim mid-page conversion touchpoint between a page's evidence and its
 * final CTA — one line, not a repeat of the hero, so it doesn't read as CTA
 * spam on a long page. The action is always CTAS.talkToSpecialist; callers
 * own the destination (e.g. a module-prefilled /book-demo) and analytics.
 *
 * layout "ruled" (default) is the indexed row used across content pages;
 * "inline" is the compact row used on module pages.
 */
export function ContextualCta({
  prompt,
  href,
  event,
  ctaLocation,
  layout = "ruled",
}: {
  prompt: ReactNode;
  href: string;
  event: AnalyticsEventName;
  ctaLocation: string;
  layout?: "ruled" | "inline";
}) {
  return (
    <Section tone="elevated" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 8, sm: 10 }}>
      <Container>
        {layout === "inline" ? (
          <Inline gap={4} className="flex-wrap items-center justify-between">
            <Text variant="body" className="font-medium">
              {prompt}
            </Text>
            <TrackedCtaLink href={href} event={event} ctaLocation={ctaLocation} variant="secondary">
              {CTAS.talkToSpecialist.label}
            </TrackedCtaLink>
          </Inline>
        ) : (
          <div className="grid grid-cols-[44px_1fr] items-center gap-4 border-y border-(--color-border-strong) py-5 sm:grid-cols-[70px_1fr_auto] sm:gap-6">
            <span className="vl-index text-(--color-text-brand)">CTA</span>
            <Text variant="body" className="font-semibold tracking-[-0.02em]">{prompt}</Text>
            <TrackedCtaLink href={href} event={event} ctaLocation={ctaLocation} variant="secondary" className="col-start-2 sm:col-start-3">
              {CTAS.talkToSpecialist.label}
            </TrackedCtaLink>
          </div>
        )}
      </Container>
    </Section>
  );
}
