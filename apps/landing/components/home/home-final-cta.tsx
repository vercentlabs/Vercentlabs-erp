import { FINAL_CTA_SECTION, LANDING_MODULES } from "@vercentlabs/landing-content";
import { Container, Section } from "@/components/layout/container";
import { Heading } from "@/components/ui/text";
import { TrackView } from "@/components/analytics/track-view";
import { CtaPair } from "@/components/conversion/cta-pair";

export function HomeFinalCta() {
  return (
    <TrackView event="final_cta_view">
      <Section tone="brand" paddingTop={{ base: 0 }} paddingBottom={{ base: 14, sm: 16, lg: 18 }} className="text-white">
        {/* The twelve module accents as one continuous strip: the signature, closing the page. */}
        <div className="flex h-1.5 w-full" aria-hidden="true">
          {LANDING_MODULES.map((landingModule) => (
            <span key={landingModule.key} className="flex-1" style={{ backgroundColor: landingModule.accentColor.hex }} />
          ))}
        </div>
        <Container>
          <div className="grid grid-cols-1 items-end gap-10 pt-14 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:pt-18">
            <div>
              <p className="vl-kicker vl-kicker-inverse">{FINAL_CTA_SECTION.eyebrow}</p>
              <Heading level="h2" className="mt-6 max-w-[17ch] text-white">
                {FINAL_CTA_SECTION.heading}
              </Heading>
              <p className="mt-5 max-w-[60ch] text-base leading-[1.7] text-white/80">{FINAL_CTA_SECTION.supportingText}</p>
            </div>
            <CtaPair
              ctaLocation="final_cta"
              primary={{ href: FINAL_CTA_SECTION.primaryCta.href, event: FINAL_CTA_SECTION.primaryCta.analyticsId, label: FINAL_CTA_SECTION.primaryCta.label, variant: "inverse" }}
              secondary={{ href: FINAL_CTA_SECTION.secondaryCta.href, event: FINAL_CTA_SECTION.secondaryCta.analyticsId, label: FINAL_CTA_SECTION.secondaryCta.label, variant: "inverse-secondary" }}
            />
          </div>
        </Container>
      </Section>
    </TrackView>
  );
}
