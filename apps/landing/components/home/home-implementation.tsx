import { CTAS, IMPLEMENTATION_SECTION } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { TrackView } from "@/components/analytics/track-view";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";

export function HomeImplementation() {
  return (
    <TrackView event="implementation_section_view">
      <Section tone="subtle">
        <Container>
          <SectionHeader
            eyebrow={IMPLEMENTATION_SECTION.eyebrow}
            title={IMPLEMENTATION_SECTION.heading}
            description={IMPLEMENTATION_SECTION.supportingText}
          />

          {/* One process line: vertical on small screens, horizontal from lg. */}
          <ol className="relative mt-12 grid grid-cols-1 lg:grid-cols-6">
            <span className="absolute bottom-3 left-[0.4rem] top-3 w-px bg-(--color-border-strong) lg:bottom-auto lg:left-0 lg:right-0 lg:top-[0.4rem] lg:h-px lg:w-auto" aria-hidden="true" />
            {IMPLEMENTATION_SECTION.steps.map((item) => (
              <li key={item.step} className="relative grid grid-cols-[1.75rem_1fr] gap-x-3 pb-7 last:pb-0 lg:block lg:pb-0 lg:pr-6">
                <span className="relative z-10 mt-0.5 h-[0.85rem] w-[0.85rem] border-2 border-(--vl-brand) bg-(--color-bg-subtle) lg:mt-0 lg:block" aria-hidden="true" />
                <div className="lg:mt-5">
                  <span className="vl-index text-(--color-text-brand)">{item.step}</span>
                  <h3 className="mt-1 text-base font-semibold tracking-[-0.025em] text-(--color-text-primary)">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-[1.6] text-(--color-text-secondary)">{item.description}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-10 flex justify-start border-t border-(--color-border-strong) pt-6 lg:justify-end">
            <TrackedCtaLink href={CTAS.talkToSpecialist.href} event="implementation_specialist_cta_click" ctaLocation="implementation" variant="secondary">
              {CTAS.talkToSpecialist.label}
            </TrackedCtaLink>
          </div>
        </Container>
      </Section>
    </TrackView>
  );
}
