import { MODULE_ARCHITECTURE_SECTION } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { ButtonLink } from "@/components/ui/button";
import { TrackView } from "@/components/analytics/track-view";
import { ModuleGroupColumns } from "@/components/modules/module-group-columns";
import { SharedPlatformBand } from "@/components/platform/shared-platform-band";

export function HomeModules() {
  return (
    <TrackView event="module_group_view">
      <Section tone="page">
        <Container>
          <SectionHeader
            eyebrow={MODULE_ARCHITECTURE_SECTION.eyebrow}
            title={MODULE_ARCHITECTURE_SECTION.heading}
            description={MODULE_ARCHITECTURE_SECTION.supportingText}
          />

          <ModuleGroupColumns className="mt-12" />

          <SharedPlatformBand className="mt-4" />

          <div className="mt-6 flex justify-end">
            <ButtonLink href="/modules" variant="tertiary" prefetch={false}>
              See all modules
            </ButtonLink>
          </div>
        </Container>
      </Section>
    </TrackView>
  );
}
