import Link from "next/link";
import { MODULE_NAV_GROUPS, LANDING_MODULES, CTAS } from "@vercentlabs/landing-content";

/**
 * The approved 5-group structure from docs/landing-redesign/phase-1/
 * information-architecture.md — never a flat 12-item list, never every
 * capability exposed (per the governing brief's explicit nav-scope rule).
 */
export function ModuleMegaMenuContent() {
  return (
    <div className="grid w-[min(90vw,880px)] grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-3">
      {MODULE_NAV_GROUPS.map((group) => (
        <div key={group.key}>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-(--color-text-muted)">{group.label}</p>
          <ul className="mt-3 flex flex-col gap-3">
            {group.moduleKeys.map((key) => {
              const moduleInfo = LANDING_MODULES.find((candidate) => candidate.key === key);
              if (!moduleInfo) return null;
              return (
                <li key={moduleInfo.key}>
                  <Link
                    href={`/modules/${moduleInfo.key}`}
                    prefetch={false}
                    className="group flex items-start gap-2.5 rounded-(--radius-control) p-1.5 -m-1.5 transition-colors hover:bg-(--color-bg-subtle)"
                  >
                    <span
                      className="mt-1 h-2 w-2 flex-none rounded-full"
                      style={{ backgroundColor: moduleInfo.accentColor.hex }}
                      aria-hidden="true"
                    />
                    <span>
                      <span className="block text-sm font-medium text-(--color-text-primary) group-hover:text-(--color-text-brand)">
                        {moduleInfo.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-(--color-text-muted)">{moduleInfo.description}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="col-span-full flex flex-col gap-2 border-t border-(--color-border-default) pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/modules" prefetch={false} className="text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4">
          See all modules
        </Link>
        <Link href={CTAS.watchTour.href} prefetch={false} className="text-sm font-medium text-(--color-text-secondary) hover:text-(--color-text-brand)">
          {CTAS.watchTour.label}
        </Link>
      </div>
    </div>
  );
}
