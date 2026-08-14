import Link from "next/link";
import { LANDING_MODULES } from "@vercentlabs/landing-content";
import { ButtonLink } from "@/components/ui/button";
import { ModuleTag } from "@/components/ui/tag";

interface WorkflowStep { step: string; department: string; moduleKey: string; systemAction: string; }

export function FlagshipWorkflow({ steps, workflowSlug }: { steps: WorkflowStep[]; workflowSlug: string }) {
  const moduleKeys = [...new Set(steps.map((step) => step.moduleKey))];

  return (
    <div className="border-y border-(--color-border-strong)">
      <div className="grid gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="vl-kicker">Connected workflow</p>
          <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-(--color-text-secondary)">
            One record moves through every stage, with ownership and controls visible at each handoff.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Modules in this workflow">
          {moduleKeys.map((moduleKey) => {
            const moduleInfo = LANDING_MODULES.find((module) => module.key === moduleKey);
            if (!moduleInfo) return null;
            return (
              <Link key={moduleKey} href={`/modules/${moduleKey}`} prefetch={false}>
                <ModuleTag name={moduleInfo.name} accentColor={moduleInfo.accentColor.hex} />
              </Link>
            );
          })}
        </div>
      </div>

      <ol className="relative py-4 lg:py-10" aria-label="Lead-to-cash workflow stages">
        <span className="absolute bottom-4 left-[19px] top-4 w-px bg-(--color-border-strong) lg:bottom-10 lg:left-1/2 lg:top-10" aria-hidden="true" />
        {steps.map((step, index) => {
          const moduleInfo = LANDING_MODULES.find((module) => module.key === step.moduleKey);
          const accentColor = moduleInfo?.accentColor.hex ?? "var(--color-brand)";
          const isRight = index % 2 === 1;
          return (
            <li key={step.step} className="relative grid grid-cols-[40px_1fr] gap-4 py-5 lg:grid-cols-[1fr_72px_1fr] lg:gap-0 lg:py-2">
              <span
                className="relative z-10 flex h-10 w-10 items-center justify-center border border-(--color-border-strong) bg-(--color-bg-page) text-[0.62rem] font-bold tracking-[0.13em] lg:col-start-2 lg:mx-auto"
                style={{ color: accentColor }}
                aria-hidden="true"
              >
                {String(index + 1).padStart(2, "0")}
              </span>

              <div className={`col-start-2 border-t border-(--color-border-default) pt-4 lg:row-start-1 lg:max-w-[470px] lg:pt-5 ${isRight ? "lg:col-start-3 lg:ml-7" : "lg:col-start-1 lg:mr-7 lg:justify-self-end"}`}>
                <div className={`flex flex-wrap items-center gap-3 ${isRight ? "" : "lg:justify-end"}`}>
                  <h3 className="text-base font-semibold leading-snug tracking-[-0.025em] text-(--color-text-primary)">{step.step}</h3>
                  {moduleInfo ? <ModuleTag name={moduleInfo.name} accentColor={accentColor} /> : null}
                </div>
                <p className={`mt-2 text-[0.63rem] font-bold uppercase tracking-[0.12em] text-(--color-text-muted) ${isRight ? "" : "lg:text-right"}`}>{step.department}</p>
                <p className={`mt-3 text-sm leading-relaxed text-(--color-text-secondary) ${isRight ? "" : "lg:text-right"}`}>{step.systemAction}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-5 border-t border-(--color-border-default) py-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <p className="max-w-[680px] text-sm leading-relaxed text-(--color-text-secondary)">
          Follow the complete process, including approvals, exception handling, automation, and the reports each team sees.
        </p>
        <ButtonLink href={`/workflows/${workflowSlug}`} variant="secondary" className="w-full lg:w-auto" prefetch={false}>
          See the full workflow
        </ButtonLink>
      </div>
    </div>
  );
}
