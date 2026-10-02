import type { CSSProperties } from "react";
import { MODULE_DETAIL_PAGE, type LandingModule } from "@vercentlabs/landing-content";

/**
 * The truthful fallback for a module's product-evidence slot when no approved
 * screenshot exists: the module's own process (primaryWorkflow) as a labelled
 * diagram, never an imitation of the product UI.
 */
export function ModuleProcess({ landingModule }: { landingModule: LandingModule }) {
  const { primaryWorkflow: process } = landingModule;
  return (
    <figure className="border border-(--color-border-strong) bg-(--vl-paper-strong)">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--color-border-strong) px-5 py-3">
        <span className="flex items-center gap-3">
          <span className="h-2.5 w-2.5" style={{ backgroundColor: landingModule.accentColor.hex }} aria-hidden="true" />
          <span className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-(--color-text-muted)">{MODULE_DETAIL_PAGE.evidenceFallbackLabel}</span>
        </span>
        <span className="text-sm font-semibold text-(--color-text-primary)">{process.name}</span>
      </div>
      <ol
        className="grid grid-cols-1 gap-px bg-(--color-border-default) sm:grid-cols-2 lg:grid-cols-[repeat(var(--steps),minmax(0,1fr))]"
        style={{ "--steps": process.steps.length } as CSSProperties}
      >
        {process.steps.map((step, index) => (
          <li key={step.step} className="bg-(--vl-paper-strong) p-4 sm:p-5">
            <span className="vl-index" style={{ color: landingModule.accentColor.hex }}>
              {String(index + 1).padStart(2, "0")}
            </span>
            <p className="mt-2 text-sm font-semibold text-(--color-text-primary)">{step.step}</p>
            <p className="mt-1.5 text-[0.82rem] leading-[1.55] text-(--color-text-secondary)">{step.detail}</p>
          </li>
        ))}
      </ol>
      <figcaption className="flex gap-3 border-t border-(--color-border-strong) px-5 py-3 text-sm text-(--color-text-primary)">
        <span className="w-1 shrink-0" style={{ backgroundColor: landingModule.accentColor.hex }} aria-hidden="true" />
        <span>{process.outcome}</span>
      </figcaption>
    </figure>
  );
}
