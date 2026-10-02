import { LAUNCH_CAPABILITY_COUNTS, MODULE_NAV_GROUPS, PLATFORM_FOUNDATION_SECTION, SHARED_PLATFORM_KEY, getLandingModule } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { TrackView } from "@/components/analytics/track-view";

export function HomePlatform() {
  return (
    <TrackView event="platform_section_view">
      <Section tone="subtle">
        <Container>
          <SectionHeader
            eyebrow={PLATFORM_FOUNDATION_SECTION.eyebrow}
            title={PLATFORM_FOUNDATION_SECTION.heading}
            description={PLATFORM_FOUNDATION_SECTION.supportingText}
          />

          <div className="mt-12 border border-(--color-border-strong) bg-(--vl-paper-strong)">
            {/* Top layer: the business modules, each inheriting the layer below. */}
            <div className="border-b border-(--color-border-strong) px-4 py-4 sm:px-6">
              <p className="vl-index">Business modules</p>
              <ul className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" aria-label="Business modules on the Shared Platform">
                {MODULE_NAV_GROUPS.flatMap((group) => group.moduleKeys).map((key) => getLandingModule(key)).filter((landingModule) => landingModule !== null).map((landingModule) => (
                  <li
                    key={landingModule.key}
                    className="truncate border-t-[3px] bg-(--color-bg-page) px-2 py-1.5 text-[0.75rem] font-semibold text-(--color-text-primary)"
                    style={{ borderTopColor: landingModule.accentColor.hex }}
                  >
                    {landingModule.displayName}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center gap-3 bg-(--vl-brand) px-4 py-2.5 text-white sm:px-6">
              <span className="text-sm font-semibold">Shared Platform</span>
              <span className="vl-index vl-index-inverse">{LAUNCH_CAPABILITY_COUNTS[SHARED_PLATFORM_KEY]} capabilities · inherited by every module</span>
            </div>

            {/* gap-px over a rule-coloured background draws the cell borders at every column count. */}
            <ul className="grid grid-cols-1 gap-px bg-(--color-border-default) md:grid-cols-2 xl:grid-cols-3">
              {PLATFORM_FOUNDATION_SECTION.families.map((family, index) => (
                <li key={family.key} className="bg-(--vl-paper-strong) p-5 sm:p-6">
                  <div className="flex items-baseline gap-3">
                    <span className="vl-index text-(--color-text-brand)" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <h3 className="text-base font-semibold tracking-[-0.025em] text-(--color-text-primary)">{family.title}</h3>
                  </div>
                  <p className="mt-2 text-sm leading-[1.6] text-(--color-text-secondary)">{family.description}</p>
                  <ul className="mt-4 flex flex-wrap gap-1.5" aria-label={`${family.title} capabilities`}>
                    {family.capabilities.map((name) => (
                      <li key={name} className="border border-(--color-border-default) bg-(--color-bg-page) px-2 py-1 text-[0.78rem] font-medium text-(--color-text-primary)">
                        {name}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </Container>
      </Section>
    </TrackView>
  );
}
