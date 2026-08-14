import type { ReactNode } from "react";
import type { LandingModule, LandingWorkflow } from "@vercentlabs/landing-content";
import { Text, Heading } from "@/components/ui/text";
import { ModuleTag } from "@/components/ui/tag";

function LedgerList({ title, items, marker }: { title: string; items: readonly string[]; marker: string }) {
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

export function WorkflowSequence({
  workflow,
  resolveModule,
  sequenceMedia,
}: {
  workflow: LandingWorkflow;
  resolveModule: (key: string) => LandingModule | undefined;
  sequenceMedia?: ReactNode;
}) {
  const approvals = workflow.approvals && workflow.approvals.length > 0
    ? workflow.approvals
    : ["No explicit approval gate in this workflow — governed by the release/status checks in its sequence above."];

  return (
    <div>
      <div className="grid border-y border-(--color-border-strong) py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-10">
        <div className="border-b border-(--color-border-default) pb-5 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-10">
          <Text variant="dataLabel">Trigger</Text>
          <Text variant="body" className="mt-3 font-semibold">{workflow.trigger}</Text>
        </div>
        {workflow.participants && workflow.participants.length > 0 ? (
          <div className="pt-5 sm:pt-0">
            <Text variant="dataLabel">Participants</Text>
            <Text variant="bodySmall" className="mt-3">{workflow.participants.join(" · ")}</Text>
          </div>
        ) : <div className="hidden sm:block" />}
      </div>

      <div className="mt-12">
        {sequenceMedia ?? (
          <ol className="relative">
            <span className="absolute bottom-0 left-[19px] top-0 w-px bg-(--color-border-strong) sm:left-[27px]" aria-hidden="true" />
            {(workflow.sequence ?? []).map((step, index) => {
              const stepModule = resolveModule(step.moduleKey);
              const accent = stepModule?.accentColor.hex ?? "var(--color-brand)";
              return (
                <li key={step.step} className="relative grid grid-cols-[40px_1fr] gap-4 py-3 sm:grid-cols-[56px_220px_1fr] sm:gap-6 sm:py-4">
                  <span className="relative z-10 flex h-10 w-10 items-center justify-center border border-(--color-border-strong) bg-(--color-bg-page) text-[0.62rem] font-bold tracking-[0.12em] sm:h-14 sm:w-14" style={{ color: accent }} aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="border-t border-(--color-border-default) pt-3 sm:pt-4">
                    <Text variant="label">{step.step}</Text>
                    {stepModule ? <div className="mt-2"><ModuleTag name={stepModule.name} accentColor={stepModule.accentColor.hex} /></div> : null}
                  </div>
                  <Text variant="bodySmall" className="col-start-2 border-t border-(--color-border-default) pt-3 sm:col-start-3 sm:pt-4">{step.detail}</Text>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="mt-12 grid gap-x-12 lg:grid-cols-2">
        <LedgerList title="Approvals" items={approvals} marker="A" />
        <LedgerList title="Automated actions" items={workflow.automatedActions ?? []} marker="B" />
      </div>

      {workflow.exceptions && workflow.exceptions.length > 0 ? (
        <div className="mt-8 border-y border-(--color-border-strong) py-6">
          <div className="grid grid-cols-[6px_1fr] gap-5">
            <span className="bg-(--color-state-warning)" aria-hidden="true" />
            <div>
              <Text variant="dataLabel">Exceptions & honest limits</Text>
              <ol className="mt-4 border-t border-(--color-border-default)">
                {workflow.exceptions.map((item, index) => (
                  <li key={item} className="grid grid-cols-[2rem_1fr] gap-3 border-b border-(--color-border-default) py-3 text-sm leading-relaxed text-(--color-text-secondary)">
                    <span className="vl-index">{String(index + 1).padStart(2, "0")}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-8 grid gap-x-12 lg:grid-cols-2">
        <LedgerList title="Visibility" items={workflow.visibility ?? []} marker="C" />
        <LedgerList title="Business value" items={workflow.businessValue ?? []} marker="D" />
      </div>
    </div>
  );
}
