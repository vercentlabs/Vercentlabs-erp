import type { ModulePrimaryWorkflow, LandingModule } from "@vercentlabs/landing-content";
import { Text, Heading } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";

function WorkflowList({ title, items, marker }: { title: string; items: readonly string[]; marker: string }) {
  return (
    <section className="border-t border-(--color-border-strong) py-6">
      <div className="grid grid-cols-[44px_1fr] gap-4 sm:grid-cols-[70px_1fr]">
        <span className="vl-index text-(--color-text-brand)">{marker}</span>
        <div>
          <Heading level="h3">{title}</Heading>
          <ol className="mt-4 border-t border-(--color-border-default)">
            {items.map((item, index) => (
              <li key={item} className="grid grid-cols-[2rem_1fr] gap-3 border-b border-(--color-border-default) py-3 text-sm leading-relaxed text-(--color-text-secondary)">
                <span className="vl-index">{String(index + 1).padStart(2, "0")}</span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function ModuleWorkflow({ workflow, accentColor, connectedModules }: { workflow: ModulePrimaryWorkflow; accentColor: string; connectedModules: readonly LandingModule[] }) {
  return (
    <div>
      <div className="grid gap-4 border-y border-(--color-border-strong) py-5 sm:grid-cols-[190px_1fr] sm:gap-8">
        <Text variant="dataLabel">Trigger</Text>
        <Text variant="body" className="font-semibold">{workflow.trigger}</Text>
      </div>

      <ol className="relative mt-10">
        <span className="absolute bottom-0 left-[19px] top-0 w-px bg-(--color-border-strong) sm:left-[27px]" aria-hidden="true" />
        {workflow.steps.map((step, index) => (
          <li key={step.step} className="relative grid grid-cols-[40px_1fr] gap-4 py-3 sm:grid-cols-[56px_220px_1fr] sm:gap-6 sm:py-4">
            <span className="relative z-10 flex h-10 w-10 items-center justify-center border border-(--color-border-strong) bg-(--color-bg-page) text-[0.62rem] font-bold tracking-[0.12em] sm:h-14 sm:w-14" style={{ color: accentColor }} aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <Text variant="label" className="border-t border-(--color-border-default) pt-3 sm:pt-4">{step.step}</Text>
            <Text variant="bodySmall" className="col-start-2 border-t border-(--color-border-default) pt-3 sm:col-start-3 sm:pt-4">{step.detail}</Text>
          </li>
        ))}
      </ol>

      <div className="mt-10 grid gap-x-12 lg:grid-cols-2">
        <WorkflowList title="Approvals" items={workflow.approvals} marker="A" />
        <WorkflowList title="Automated actions" items={workflow.automatedActions} marker="B" />
      </div>

      {connectedModules.length > 0 ? (
        <div className="mt-8 border-y border-(--color-border-strong) py-5">
          <Text variant="dataLabel">Connected modules in this workflow</Text>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {connectedModules.map((connected) => <ModuleTag key={connected.key} name={connected.name} accentColor={connected.accentColor.hex} />)}
          </div>
        </div>
      ) : null}

      <div className="mt-8 grid grid-cols-[6px_1fr] gap-5 border-y border-(--color-border-strong) py-6">
        <span style={{ backgroundColor: accentColor }} aria-hidden="true" />
        <div><Text variant="dataLabel">Outcome</Text><Text variant="bodyLarge" className="mt-3 font-semibold">{workflow.outcome}</Text></div>
      </div>
    </div>
  );
}
