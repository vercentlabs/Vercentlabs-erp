import { BREADTH_SECTION, SHARED_PLATFORM_KEY, getLandingModule } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { ButtonLink } from "@/components/ui/button";
import { TrackView } from "@/components/analytics/track-view";

function accentFor(key: string) {
  return key === SHARED_PLATFORM_KEY ? "var(--vl-ink)" : (getLandingModule(key)?.accentColor.hex ?? "var(--vl-brand)");
}

export function HomeBreadth() {
  const { distribution } = BREADTH_SECTION;
  const total = distribution.reduce((sum, owner) => sum + owner.count, 0);
  const largest = Math.max(...distribution.map((owner) => owner.count));

  return (
    <TrackView event="breadth_section_view">
      <Section tone="elevated">
        <Container>
          <SectionHeader eyebrow={BREADTH_SECTION.eyebrow} title={BREADTH_SECTION.heading} description={BREADTH_SECTION.supportingText} />

          <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.6fr)_minmax(0,1.4fr)] lg:gap-14">
            <dl className="grid grid-cols-2 gap-6 self-start border-t border-(--color-border-strong) pt-5 lg:grid-cols-1">
              {BREADTH_SECTION.breakdown.map((item) => (
                <div key={item.label} className="grid content-start">
                  <dt className="mt-3 text-sm font-semibold text-(--color-text-primary)">{item.label}</dt>
                  <dd className="tabular-data -order-1 text-[clamp(2.75rem,5vw,4.25rem)] font-semibold leading-[0.85] tracking-[-0.07em] text-(--color-text-primary)">
                    {item.value}
                  </dd>
                  <dd className="mt-1 text-sm leading-[1.5] text-(--color-text-secondary)">{item.description}</dd>
                </div>
              ))}
            </dl>

            <div>
              {/* The whole scope as one proportional bar — each segment is one owner's share. */}
              <div className="flex h-3 w-full gap-px" aria-hidden="true">
                {distribution.map((owner) => (
                  <span key={owner.key} style={{ flexGrow: owner.count, backgroundColor: accentFor(owner.key) }} />
                ))}
              </div>

              <dl className="mt-6 gap-x-10 sm:columns-2">
                {distribution.map((owner) => (
                  <div key={owner.key} className="grid break-inside-avoid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-3 border-t border-(--color-border-default) py-2.5">
                    <dt className="truncate text-sm font-semibold text-(--color-text-primary)">{owner.label}</dt>
                    <dd className="grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-3">
                      <span className="h-2" aria-hidden="true">
                        <span className="block h-full" style={{ width: `${(owner.count / largest) * 100}%`, backgroundColor: accentFor(owner.key) }} />
                      </span>
                      <span className="tabular-data text-right text-sm font-semibold text-(--color-text-primary)">{owner.count}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 border-t border-(--color-border-strong) pt-3 text-right text-sm text-(--color-text-secondary)">
                Total <span className="tabular-data font-semibold text-(--color-text-primary)">{total}</span>
              </p>
            </div>
          </div>

          <div className="mt-8 flex justify-end">
            <ButtonLink href={BREADTH_SECTION.cta.href} variant="tertiary" prefetch={false}>
              {BREADTH_SECTION.cta.label}
            </ButtonLink>
          </div>
        </Container>
      </Section>
    </TrackView>
  );
}
