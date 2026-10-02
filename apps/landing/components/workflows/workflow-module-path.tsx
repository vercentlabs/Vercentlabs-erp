import { getLandingModule, getWorkflowModulePath } from "@vercentlabs/landing-content";
import { cx } from "@/lib/utils";

/**
 * A routed workflow as its module handoff path: each run of consecutive steps
 * owned by one module, then an arrow wherever the record crosses into the
 * next module. Server-rendered text; the arrows are decorative.
 *
 * `highlightModuleKey` emphasises one module (the current module page);
 * `showSteps` adds the step names under each module.
 */
export function WorkflowModulePath({
  slug,
  highlightModuleKey,
  showSteps = true,
  className,
}: {
  slug: string;
  highlightModuleKey?: string;
  showSteps?: boolean;
  className?: string;
}) {
  const path = getWorkflowModulePath(slug);
  return (
    <ol className={cx("flex flex-wrap items-stretch gap-y-2", className)}>
      {path.map((segment, index) => {
        const landingModule = getLandingModule(segment.moduleKey);
        const accent = landingModule?.accentColor.hex ?? "var(--vl-brand)";
        const highlighted = highlightModuleKey === segment.moduleKey;
        return (
          <li key={`${segment.moduleKey}-${index}`} className="flex items-stretch">
            {index > 0 ? (
              <span className="flex items-center px-1.5 text-(--color-text-muted)" aria-hidden="true">
                →
              </span>
            ) : null}
            <span
              className={cx(
                "block border-t-[3px] px-2.5 py-1.5",
                highlighted ? "bg-(--color-bg-elevated) ring-1 ring-(--color-border-strong)" : "bg-(--color-bg-elevated)/60",
              )}
              style={{ borderTopColor: accent }}
            >
              <span className="block text-[0.78rem] font-semibold leading-tight text-(--color-text-primary)">{landingModule?.displayName ?? segment.moduleKey}</span>
              {showSteps ? <span className="mt-0.5 block text-[0.75rem] leading-snug text-(--color-text-secondary)">{segment.steps.join(", ")}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
