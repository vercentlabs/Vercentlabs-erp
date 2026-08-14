import type { ImplementationPhase } from "@vercentlabs/landing-content";
import { Text, Heading } from "@/components/ui/text";
import { Checklist } from "@/components/ui/card";

export function ImplementationTimeline({ phases }: { phases: readonly ImplementationPhase[] }) {
  return (
    <ol className="relative">
      <span className="absolute bottom-0 left-[23px] top-0 w-px bg-(--color-border-strong) sm:left-[34px] lg:left-[44px]" aria-hidden="true" />
      {phases.map((phase, index) => (
        <li key={phase.id} className="relative grid grid-cols-[48px_1fr] gap-4 py-7 sm:grid-cols-[70px_1fr] sm:gap-6 lg:grid-cols-[90px_280px_1fr] lg:gap-8 lg:py-9">
          <span className="relative z-10 flex h-12 w-12 items-center justify-center border border-(--color-border-strong) bg-(--color-bg-page) tabular-nums text-sm font-bold text-(--color-text-brand) sm:h-[70px] sm:w-[70px] lg:h-[90px] lg:w-[90px]" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
          <div className="border-t border-(--color-border-strong) pt-4">
            <Heading level="h3">{phase.name}</Heading>
            <Text variant="bodySmall" className="mt-3 max-w-[34ch]">{phase.description}</Text>
          </div>
          <div className="col-start-2 grid grid-cols-1 gap-8 border-t border-(--color-border-strong) pt-4 sm:col-start-2 lg:col-start-3 md:grid-cols-2">
            <div><Text variant="dataLabel">Activities</Text><Checklist items={phase.activities} className="mt-3" /></div>
            <div><Text variant="dataLabel">Typical outputs</Text><Checklist items={phase.typicalOutputs} className="mt-3" /></div>
            {phase.migrationChecklist ? (
              <div className="border-t border-(--color-border-default) pt-5 md:col-span-2"><Text variant="dataLabel">What gets migrated</Text><Checklist items={phase.migrationChecklist} className="mt-3" /></div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
