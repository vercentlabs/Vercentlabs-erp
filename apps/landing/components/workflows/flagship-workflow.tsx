import Link from "next/link";
import { LANDING_MODULES } from "@vercentlabs/landing-content";
import { ButtonLink } from "@/components/ui/button";
import { ModuleTag } from "@/components/ui/tag";

interface WorkflowStep {
  step: string;
  department: string;
  moduleKey: string;
  systemAction: string;
}

export function FlagshipWorkflow({ steps, workflowSlug }: { steps: WorkflowStep[]; workflowSlug: string }) {
  const moduleKeys = [...new Set(steps.map((step) => step.moduleKey))];

  return (
    <div className="mt-10 overflow-hidden rounded-(--radius-panel) border border-(--color-border-default) bg-(--color-border-default) shadow-(--shadow-subtle)">
      <div className="flex flex-col gap-4 bg-(--color-bg-subtle) px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-(--color-text-brand)">Connected workflow</p>
          <p className="mt-1 text-sm text-(--color-text-secondary)">
            One record moves through every stage, with ownership and controls visible at each handoff.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Modules in this workflow">
          {moduleKeys.map((moduleKey) => {
            const moduleInfo = LANDING_MODULES.find((module) => module.key === moduleKey);
            if (!moduleInfo) return null;
            return (
              <Link key={moduleKey} href={`/modules/${moduleKey}`} prefetch={false}>
                <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} className="bg-(--color-bg-elevated)" />
              </Link>
            );
          })}
        </div>
      </div>

      <ol
        className="grid grid-cols-1 gap-px bg-(--color-border-default) md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
        aria-label="Lead-to-cash workflow stages"
      >
        {steps.map((step, index) => {
          const moduleInfo = LANDING_MODULES.find((module) => module.key === step.moduleKey);
          const accentColor = moduleInfo?.accentColor.hex ?? "var(--color-brand)";

          return (
            <li
              key={step.step}
              style={{ borderTopColor: accentColor }}
              className="relative flex flex-col border-t-[3px] bg-(--color-bg-elevated) p-5 sm:p-6 xl:min-h-64"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="tabular-data text-xs font-semibold tracking-[0.08em] text-(--color-text-muted)">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {moduleInfo ? <ModuleTag name={moduleInfo.name} accentColor={accentColor} /> : null}
              </div>

              <div className="mt-8">
                <h3 className="text-base font-semibold leading-snug text-(--color-text-primary)">{step.step}</h3>
                <p className="mt-1 text-xs font-medium uppercase tracking-[0.08em] text-(--color-text-muted)">{step.department}</p>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-(--color-text-secondary)">{step.systemAction}</p>

              {index < steps.length - 1 ? (
                <svg viewBox="0 0 20 20" fill="none" className="mt-6 h-5 w-5 self-end text-(--color-text-brand) xl:mt-auto" aria-hidden="true">
                  <path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span
                  className="mt-6 inline-flex h-5 w-5 self-end items-center justify-center rounded-full bg-(--color-state-success-soft) text-(--color-state-success) xl:mt-auto"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
                    <path d="m5 10 3 3 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-4 bg-(--color-bg-elevated) px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="max-w-[680px] text-sm leading-relaxed text-(--color-text-secondary)">
          Follow the complete process, including approvals, exception handling, automation, and the reports each team sees.
        </p>
        <ButtonLink href={`/workflows/${workflowSlug}`} variant="secondary" className="w-full flex-none sm:w-auto" prefetch={false}>
          See the full workflow
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
            <path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </ButtonLink>
      </div>
    </div>
  );
}
