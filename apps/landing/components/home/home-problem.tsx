import { PROBLEM_SECTION, SITE_IDENTITY, getLandingModule } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { ModuleChip } from "@/components/ui/tag";
import { TrackView } from "@/components/analytics/track-view";

// Deliberately uneven offsets: the disconnected stack shouldn't line up.
const FRAGMENT_OFFSETS = ["ml-0", "ml-[24%]", "ml-[8%]", "ml-[32%]", "ml-[14%]", "ml-[3%]"];

export function HomeProblem() {
  const { fragmented, connected } = PROBLEM_SECTION;
  const connectedModules = connected.moduleKeys.map((key) => getLandingModule(key)).filter((landingModule) => landingModule !== null);

  return (
    <TrackView event="problem_section_view">
      <Section tone="elevated">
        <Container>
          <SectionHeader eyebrow={PROBLEM_SECTION.eyebrow} title={PROBLEM_SECTION.heading} description={PROBLEM_SECTION.supportingText} />

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:mt-14 lg:gap-10">
            {/* Fragmented: separate tools joined by manual handoffs. */}
            <div className="border border-dashed border-(--color-border-strong) p-5 sm:p-7">
              <p className="vl-index">{fragmented.label}</p>
              <ol className="mt-5" aria-label={`${fragmented.label}, joined by manual handoffs`}>
                {fragmented.systems.map((system, index) => (
                  <li key={system} className="relative">
                    <span
                      className={`${FRAGMENT_OFFSETS[index % FRAGMENT_OFFSETS.length]} flex w-[62%] min-w-[9.5rem] items-center border border-(--color-border-strong) bg-(--vl-paper-strong) px-3 py-2.5 text-sm font-semibold text-(--color-text-primary)`}
                    >
                      {system}
                    </span>
                    {index < fragmented.systems.length - 1 ? (
                      <span className="flex h-9 items-center gap-3 pl-5 text-[0.75rem] text-(--color-state-error)">
                        <span className="h-full border-l border-dashed border-(--color-state-error)" aria-hidden="true" />
                        <span>
                          <span aria-hidden="true">× </span>
                          {fragmented.handoffs[index % fragmented.handoffs.length]}
                        </span>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>

            {/* Connected: the same work on one ERP, one record rail. */}
            <div className="border border-(--vl-ink) bg-(--vl-paper-strong)">
              <div className="flex items-center justify-between gap-4 bg-(--vl-ink) px-5 py-3 text-white sm:px-7">
                <span className="text-sm font-semibold">{SITE_IDENTITY.productName}</span>
                <span className="vl-index vl-index-inverse">{connected.label}</span>
              </div>
              <div className="p-5 sm:p-7">
                <ol className="relative" aria-label={`${connected.label}: ${connected.summary}`}>
                  <span className="absolute bottom-5 left-[0.3rem] top-5 w-[3px] bg-(--vl-brand)" aria-hidden="true" />
                  {connectedModules.map((landingModule) => (
                    <li key={landingModule.key} className="relative flex h-[3.4rem] items-center gap-4 md:h-[4.7rem]">
                      <span className="relative z-10 h-[0.9rem] w-[0.9rem] flex-none border-2 border-(--vl-brand) bg-(--vl-paper-strong)" aria-hidden="true" />
                      <span className="flex min-w-0 flex-1 items-center border border-(--color-border-default) px-3 py-3">
                        <ModuleChip name={landingModule.displayName} accentColor={landingModule.accentColor.hex} />
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 border-t border-(--color-border-default) pt-4 text-sm font-semibold text-(--color-text-primary)">{connected.summary}</p>
              </div>
            </div>
          </div>

          <ol className="mt-12 grid grid-cols-1 gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
            {PROBLEM_SECTION.items.map((item, index) => (
              <li key={item.title} className="grid grid-cols-[2.25rem_1fr] gap-3 border-t border-(--color-border-default) py-5">
                <span className="vl-index pt-1 text-(--vl-signal)" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-[0.98rem] font-semibold tracking-[-0.02em] text-(--color-text-primary)">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-[1.65] text-(--color-text-secondary)">{item.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </Section>
    </TrackView>
  );
}
