import Link from "next/link";

import type { ModuleNavigation } from "@/shell/navigation/navigation-types";

// Home's app launcher: one tile per module the person may open. Each mark is the module's own navigation icon — the same icon the
// sidebar and module rail show — in white on a rounded tile in the module's colour, so a module looks the same everywhere. The twelve
// colours sit apart on the colour wheel (warm → greens → blues → purples), so no two modules look alike; the shadow takes the tile's colour.

const COLOURS: Record<string, { from: string; to: string }> = {
  "hr-payroll": { from: "#FF6B85", to: "#E11D48" }, // rose
  manufacturing: { from: "#FF9147", to: "#EA580C" }, // orange
  procurement: { from: "#FFB938", to: "#E58A00" }, // amber
  quality: { from: "#94D82D", to: "#4E9A0E" }, // lime
  accounting: { from: "#3DD68C", to: "#0E9F5E" }, // green
  assets: { from: "#2DD4BF", to: "#0D9488" }, // teal
  support: { from: "#38D7F2", to: "#0891B2" }, // cyan
  stock: { from: "#4CB8FF", to: "#0A7BD6" }, // sky
  sales: { from: "#6A93FF", to: "#2F5BEA" }, // blue
  projects: { from: "#8A86FF", to: "#5145E5" }, // indigo
  crm: { from: "#B67CFF", to: "#8A3FFC" }, // purple
  "point-of-sale": { from: "#FF77C3", to: "#DB2777" }, // pink
};
const FALLBACK = { from: "#94A3B8", to: "#475569" };

export function ModuleMark({ module, className = "size-16" }: { module: ModuleNavigation; className?: string }) {
  const { from, to } = COLOURS[module.moduleKey] ?? FALLBACK;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-[27%] ${className}`}
      style={{ backgroundImage: `linear-gradient(150deg, ${from}, ${to})`, boxShadow: `0 8px 18px -8px ${to}, inset 0 1px 0 rgba(255,255,255,0.25)` }}
    >
      <module.icon aria-hidden="true" strokeWidth={2} className="size-1/2 text-white" />
    </span>
  );
}

export function ModuleLauncher({ modules }: { modules: ModuleNavigation[] }) {
  return (
    // Rows of 3 / 4 / 6 like a grid, but centred: one or two apps sit in the middle, not stranded on the left.
    <ul className="flex flex-wrap justify-center gap-y-2 sm:gap-y-4">
      {modules.map((module) => (
        <li key={module.moduleKey} className="w-1/3 px-0.5 sm:w-1/4 sm:px-1 lg:w-1/6">
          <Link
            href={module.sections[0]?.items[0]?.route ?? `/${module.moduleKey}`}
            className="group flex flex-col items-center gap-2 rounded-[var(--radius-card)] px-1 py-3 text-center outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand sm:gap-2.5 sm:px-2 sm:py-4"
          >
            <span className="transition-transform duration-150 ease-out group-hover:-translate-y-0.5">
              <ModuleMark module={module} className="size-14 sm:size-16" />
            </span>
            <span className="text-xs font-medium text-text sm:text-sm">{module.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
