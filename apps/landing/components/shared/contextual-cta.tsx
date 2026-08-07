import { Container, Section, Inline } from "@/components/layout/container";
import { Text } from "@/components/ui/text";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import type { AnalyticsEventName } from "@/lib/analytics";

/**
 * The mid-page conversion touchpoint (per conversion-architecture.md's
 * 3-touchpoint CTA requirement), generalized from components/modules/
 * contextual-cta.tsx for industry/solution/workflow/implementation pages
 * rather than duplicating it four times.
 */
export function ContextualCta({
  prompt,
  href,
  event,
  ctaLocation,
}: {
  prompt: string;
  href: string;
  event: AnalyticsEventName;
  ctaLocation: string;
}) {
  return (
    <Section tone="elevated" className="py-8 sm:py-10">
      <Container>
        <Inline gap={4} className="flex-wrap items-center justify-between">
          <Text variant="body" className="font-medium">
            {prompt}
          </Text>
          <TrackedCtaLink href={href} event={event} ctaLocation={ctaLocation} variant="secondary">
            Book a Product Demo
          </TrackedCtaLink>
        </Inline>
      </Container>
    </Section>
  );
}
