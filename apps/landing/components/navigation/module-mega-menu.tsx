import Link from "next/link";
import { MODULE_NAV_GROUPS, LANDING_MODULES, CTAS } from "@vercentlabs/landing-content";

export function ModuleMegaMenuContent() {
  return (
    <div className="flex h-full w-[min(82vw,980px)] flex-col">
      <div className="mb-5 grid shrink-0 grid-cols-[1fr_auto] items-end border-b border-(--color-border-strong) pb-4">
        <div>
          <p className="vl-kicker">Operating system map</p>
          <p className="mt-2 max-w-[58ch] text-sm leading-relaxed text-(--color-text-secondary)">Twelve connected business modules, grouped by the work they control.</p>
        </div>
        <span className="tabular-data text-4xl font-semibold tracking-[-0.06em] text-(--color-text-primary)">12</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto border-l border-t border-(--color-border-default) sm:grid-cols-3">
        {MODULE_NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.key} className="border-b border-r border-(--color-border-default) p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-[0.66rem] font-bold uppercase tracking-[0.13em] text-(--color-text-muted)">{group.label}</p>
              <span className="vl-index">{String(groupIndex + 1).padStart(2, "0")}</span>
            </div>
            <ul className="flex flex-col">
              {group.moduleKeys.map((key) => {
                const moduleInfo = LANDING_MODULES.find((candidate) => candidate.key === key);
                if (!moduleInfo) return null;
                return (
                  <li key={moduleInfo.key}>
                    <Link
                      href={`/modules/${moduleInfo.key}`}
                      prefetch={false}
                      className="group grid grid-cols-[4px_1fr_auto] items-start gap-3 border-t border-(--color-border-subtle) py-3 first:border-t-0"
                    >
                      <span className="mt-1 h-8 w-1" style={{ backgroundColor: moduleInfo.accentColor.hex }} aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-semibold text-(--color-text-primary) group-hover:text-(--color-text-brand)">{moduleInfo.name}</span>
                        <span className="mt-0.5 block text-[0.7rem] leading-snug text-(--color-text-muted)">{moduleInfo.description}</span>
                      </span>
                      <span className="text-xs text-(--color-text-muted) transition-transform group-hover:translate-x-1" aria-hidden="true">→</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex shrink-0 flex-col gap-3 border-x border-b border-(--color-border-default) bg-(--color-bg-subtle) px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/modules" prefetch={false} className="vl-editorial-link text-sm font-semibold text-(--color-text-brand)">See all modules</Link>
        <Link href={CTAS.watchTour.href} prefetch={false} className="vl-editorial-link text-sm font-semibold text-(--color-text-secondary)">{CTAS.watchTour.label}</Link>
      </div>
    </div>
  );
}
