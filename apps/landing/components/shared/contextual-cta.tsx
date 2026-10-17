import { Container, Section } from "@/components/layout/container";
import { Text } from "@/components/ui/text";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";
import type { AnalyticsEventName } from "@/lib/analytics";

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
    <Section tone="elevated" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 8, sm: 10 }}>
      <Container>
        <div className="grid grid-cols-[44px_1fr] items-center gap-4 border-y border-(--color-border-strong) py-5 sm:grid-cols-[70px_1fr_auto] sm:gap-6">
          <span className="vl-index text-(--color-text-brand)">CTA</span>
          <Text variant="body" className="font-semibold tracking-[-0.02em]">{prompt}</Text>
          <TrackedCtaLink href={href} event={event} ctaLocation={ctaLocation} variant="secondary" className="col-start-2 sm:col-start-3">
            Book a Demo
          </TrackedCtaLink>
        </div>
      </Container>
    </Section>
  );
}
