import { HERO } from "@vercentlabs/landing-content";
import { Container, Section } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";
import { ProductEvidence } from "@/components/product/product-evidence";
import { ConnectedErpMap } from "@/components/product/connected-erp-map";
import { TrackView } from "@/components/analytics/track-view";
import { CtaPair } from "@/components/conversion/cta-pair";

export function HomeHero() {
  return (
    <TrackView event="hero_view">
      <Section tone="page" paddingTop={{ base: 8, sm: 10, lg: 12 }} paddingBottom={{ base: 10, sm: 12, lg: 14 }} className="overflow-hidden">
        <Container>
          <div className="grid grid-cols-1 gap-x-12 gap-y-9 [grid-template-areas:'copy'_'visual'_'proof'] lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center lg:[grid-template-areas:'copy_visual'_'proof_visual'] xl:gap-x-16">
            <div className="reveal-on-load [grid-area:copy]">
              <Text variant="eyebrow">{HERO.eyebrow}</Text>
              <Heading level="h1" className="mt-6">
                {/* One line per sentence, so the headline breaks after "One ERP." at every width. */}
                {HERO.heading.split(/(?<=\.)\s+/).map((sentence, index, sentences) => (
                  <span key={sentence} className="block">
                    {sentence}
                    {index < sentences.length - 1 ? " " : null}
                  </span>
                ))}
              </Heading>
              <Text variant="lead" className="mt-6">
                {HERO.supportingText}
              </Text>
              <CtaPair
                className="mt-8"
                ctaLocation="hero"
                primary={{ href: HERO.primaryCta.href, event: HERO.primaryCta.analyticsId, label: HERO.primaryCta.label }}
                secondary={{ href: HERO.secondaryCta.href, event: HERO.secondaryCta.analyticsId, label: HERO.secondaryCta.label, variant: "secondary" }}
              />
            </div>

            <div className="reveal-on-load reveal-on-load-delay-1 [grid-area:visual] lg:self-center">
              <ProductEvidence screenshotId={HERO.screenshotId} priority fallback={<ConnectedErpMap />} />
            </div>

            <dl className="grid grid-cols-3 border-t border-(--color-border-strong) [grid-area:proof] lg:self-start">
              {HERO.evidence.map((item) => (
                <div key={item.label} className="grid content-start border-r border-(--color-border-default) py-3 pr-3 last:border-r-0 sm:py-4 [&:not(:first-child)]:pl-3 sm:[&:not(:first-child)]:pl-5">
                  <dt className="mt-1 text-[0.78rem] leading-snug text-(--color-text-secondary) sm:text-sm">{item.label}</dt>
                  <dd className="tabular-data -order-1 text-2xl font-semibold leading-none tracking-[-0.05em] text-(--color-text-primary) sm:text-[1.75rem]">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </Container>
      </Section>
    </TrackView>
  );
}
