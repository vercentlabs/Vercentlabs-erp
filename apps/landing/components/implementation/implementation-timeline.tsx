import type { ImplementationPhase } from "@vercentlabs/landing-content";
import { Stack, Grid } from "@/components/layout/container";
import { Text, Heading } from "@/components/ui/text";
import { Checklist } from "@/components/ui/card";

/** The 8-phase implementation journey, rendered as a real numbered sequence — not a marketing "3 easy steps" simplification. */
export function ImplementationTimeline({ phases }: { phases: readonly ImplementationPhase[] }) {
  return (
    <ol className="flex flex-col gap-0">
      {phases.map((phase, index) => (
        <li key={phase.id} className={`border-(--color-border-default) py-10 ${index > 0 ? "border-t" : ""}`}>
          <Grid columns={12} gap={8}>
            <div className="sm:col-span-4 lg:col-span-3">
              <span
                className="tabular-data flex h-10 w-10 flex-none items-center justify-center rounded-(--radius-control) bg-(--color-bg-brand) text-sm font-semibold text-(--color-text-inverse)"
                aria-hidden="true"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <Heading level="h3" className="mt-3">
                {phase.name}
              </Heading>
            </div>
            <div className="sm:col-span-8 lg:col-span-9">
              <Stack gap={5}>
                <Text variant="body">{phase.description}</Text>
                <Grid columns={2} gap={6}>
                  <div>
                    <Text variant="label">Activities</Text>
                    <Checklist items={phase.activities} className="mt-2" />
                  </div>
                  <div>
                    <Text variant="label">Typical outputs</Text>
                    <Checklist items={phase.typicalOutputs} className="mt-2" />
                  </div>
                </Grid>
                {phase.migrationChecklist ? (
                  <div className="rounded-(--radius-panel) border border-(--color-border-brand) bg-(--color-bg-elevated) p-5">
                    <Text variant="label">What gets migrated</Text>
                    <Checklist items={phase.migrationChecklist} className="mt-2" />
                  </div>
                ) : null}
              </Stack>
            </div>
          </Grid>
        </li>
      ))}
    </ol>
  );
}
