import { Container, Section, Inline } from "@/components/layout/container";
import { Text } from "@/components/ui/text";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";

/**
 * The mid-page conversion touchpoint docs/landing-redesign/phase-1/
 * conversion-architecture.md requires between the proof section and the
 * final CTA — a Phase 4 Cycle 2 UX review found module pages went straight
 * from product evidence into 6+ more sections with no re-engagement point
 * for a reader who's already seen enough to be interested. See
 * docs/landing-redesign/phase-4/decision-log.md. Deliberately slim — a single
 * line, not a repeat of the hero — so it doesn't read as CTA spam on an
 * already-long page.
 */
export function ContextualCta({ moduleName, moduleSlug }: { moduleName: string; moduleSlug: string }) {
  return (
    <Section tone="elevated" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 8, sm: 10 }}>
      <Container>
        <Inline gap={4} className="flex-wrap items-center justify-between">
          <Text variant="body" className="font-medium">
            Ready to see {moduleName} running on your own data?
          </Text>
          <TrackedCtaLink href={`/book-demo?module=${moduleSlug}`} event="module_mid_cta_click" ctaLocation={`module_mid_${moduleSlug}`} variant="secondary">
            Book a Product Demo
          </TrackedCtaLink>
        </Inline>
      </Container>
    </Section>
  );
}
