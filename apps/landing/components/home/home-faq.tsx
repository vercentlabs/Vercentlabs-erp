import { BUYER_QUESTIONS_SECTION } from "@vercentlabs/landing-content";
import { Container, Section } from "@/components/layout/container";
import { Heading } from "@/components/ui/text";
import { FaqAccordion } from "@/components/marketing/faq-accordion";
import { TrackView } from "@/components/analytics/track-view";

export function HomeFaq() {
  return (
    <TrackView event="buyer_questions_view">
      <Section tone="page">
        <Container>
          <div className="grid grid-cols-1 gap-10 border-t border-(--color-border-strong) pt-5 lg:grid-cols-[minmax(280px,.65fr)_minmax(0,1.35fr)] lg:gap-16">
            <div>
              <p className="vl-kicker">{BUYER_QUESTIONS_SECTION.eyebrow}</p>
              <Heading level="h2" className="mt-6 max-w-[12ch]">{BUYER_QUESTIONS_SECTION.heading}</Heading>
            </div>
            <FaqAccordion items={BUYER_QUESTIONS_SECTION.questions} reveal={false} />
          </div>
        </Container>
      </Section>
    </TrackView>
  );
}
