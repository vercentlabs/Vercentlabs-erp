import Link from "next/link";
import { LAUNCH_CAPABILITY_COUNTS, MODULE_ARCHITECTURE_SECTION, MODULE_NAV_GROUPS, getLandingModule } from "@vercentlabs/landing-content";
import { cx } from "@/lib/utils";

type NavGroup = (typeof MODULE_NAV_GROUPS)[number];

/** Greedy column packing in nav-group order; a group's weight is its module count plus its header. */
function balancedColumns(groups: readonly NavGroup[], count: number): NavGroup[][] {
  const columns: NavGroup[][] = Array.from({ length: count }, () => []);
  const weights = new Array<number>(count).fill(0);
  for (const group of groups) {
    const target = weights.indexOf(Math.min(...weights));
    columns[target].push(group);
    weights[target] += group.moduleKeys.length + 1;
  }
  return columns;
}

/**
 * All 12 modules in their nav groups, as linked cards with purpose and
 * capability count. Groups are reading aids, not separate products. From md
 * they are packed into three columns, each group going to the currently
 * shortest column.
 */
export function ModuleGroupColumns({ className }: { className?: string }) {
  return (
    <div className={cx("grid grid-cols-1 gap-x-8 md:grid-cols-3 xl:gap-x-10", className)}>
      {balancedColumns(MODULE_NAV_GROUPS, 3).map((column, columnIndex) => (
        <div key={columnIndex}>
          {column.map((group) => {
            const summary = MODULE_ARCHITECTURE_SECTION.groupSummaries.find((item) => item.groupKey === group.key);
            return (
              <section key={group.key} className="mb-8 break-inside-avoid border-t border-(--color-border-strong) pt-4" aria-labelledby={`module-group-${group.key}`}>
                <h3 id={`module-group-${group.key}`} className="vl-kicker">
                  {group.label}
                </h3>
                {summary ? <p className="mt-3 max-w-[44ch] text-sm leading-[1.6] text-(--color-text-secondary)">{summary.outcome}</p> : null}
                <ul className="mt-4 grid gap-2">
                  {group.moduleKeys.map((key) => {
                    const landingModule = getLandingModule(key);
                    if (!landingModule) return null;
                    return (
                      <li key={key}>
                        <Link
                          href={`/modules/${landingModule.key}`}
                          prefetch={false}
                          className="group grid grid-cols-[3px_minmax(0,1fr)] gap-x-3.5 border border-(--color-border-default) bg-(--vl-paper-strong) py-3 pr-4 transition-colors duration-(--duration-fast) hover:border-(--color-text-primary)"
                        >
                          <span className="row-span-2" style={{ backgroundColor: landingModule.accentColor.hex }} aria-hidden="true" />
                          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                            <span className="text-[0.98rem] font-semibold tracking-[-0.02em] text-(--color-text-primary)">{landingModule.displayName}</span>
                            <span className="vl-index">{LAUNCH_CAPABILITY_COUNTS[landingModule.key]} capabilities</span>
                          </span>
                          <span className="mt-1 flex items-start justify-between gap-3 text-sm leading-[1.5] text-(--color-text-secondary)">
                            {landingModule.purpose}
                            <span className="vl-hover-arrow text-(--color-text-muted)" aria-hidden="true">→</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ))}
    </div>
  );
}
