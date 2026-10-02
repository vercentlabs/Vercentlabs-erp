import { EVALUATION_SECTION } from "@vercentlabs/landing-content";
import { Container, Section, SectionHeader } from "@/components/layout/container";
import { TrackView } from "@/components/analytics/track-view";
import { EvaluationPaths } from "@/components/conversion/evaluation-paths";

export function HomeEvaluation() {
  return (
    <TrackView event="evaluation_section_view">
      <Section tone="page">
        <Container>
          <SectionHeader eyebrow={EVALUATION_SECTION.eyebrow} title={EVALUATION_SECTION.heading} description={EVALUATION_SECTION.supportingText} />
          <div className="mt-12">
            <EvaluationPaths locationPrefix="evaluation" />
          </div>
        </Container>
      </Section>
    </TrackView>
  );
}
