import { ROLE_VALUE_SECTION, getLandingModule } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { ModuleChip } from "@/components/ui/tag";
import { TrackView } from "@/components/analytics/track-view";

export function HomeRoleValue() {
  return (
    <TrackView event="role_value_view">
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow={ROLE_VALUE_SECTION.eyebrow} title={ROLE_VALUE_SECTION.heading} />
          <ul className="mt-12 border-b border-(--color-border-default)">
            {ROLE_VALUE_SECTION.roles.map((item) => (
              <li
                key={item.role}
                className="grid grid-cols-1 gap-3 border-t border-(--color-border-default) py-5 md:grid-cols-[minmax(0,0.75fr)_minmax(0,1.5fr)_minmax(0,0.85fr)] md:items-baseline md:gap-8"
              >
                <h3 className="text-base font-semibold tracking-[-0.025em] text-(--color-text-primary)">{item.role}</h3>
                <p className="max-w-[62ch] text-sm leading-[1.65] text-(--color-text-secondary)">{item.gains}</p>
                <ul className="flex flex-wrap gap-x-4 gap-y-2 md:justify-end" aria-label={`Modules ${item.role.toLowerCase()} work in`}>
                  {item.moduleKeys.map((key) => {
                    const landingModule = getLandingModule(key);
                    return landingModule ? (
                      <li key={key}>
                        <ModuleChip name={landingModule.displayName} accentColor={landingModule.accentColor.hex} />
                      </li>
                    ) : null;
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </Container>
      </Section>
    </TrackView>
  );
}
