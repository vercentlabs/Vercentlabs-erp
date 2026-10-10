import Link from "next/link";

import type { ModuleNavigation } from "@/shell/navigation/navigation-types";

// Home's app launcher: one tile per module the person may open. Each mark is the module's own navigation icon — the same icon the
// sidebar and module rail show — in white on a rounded gradient tile in the module's colour, so a module looks the same everywhere.

const COLOURS: Record<string, { from: string; to: string }> = {
  crm: { from: "#8B6CFF", to: "#5B3FD9" },
  sales: { from: "#22C58B", to: "#047857" },
  procurement: { from: "#FBB13C", to: "#D97706" },
  stock: { from: "#38B6F0", to: "#0369A1" },
  manufacturing: { from: "#FB8A3C", to: "#C2410C" },
  projects: { from: "#7C7FF5", to: "#4338CA" },
  assets: { from: "#2DD4BF", to: "#0F766E" },
  "point-of-sale": { from: "#F06AB0", to: "#BE185D" },
  quality: { from: "#9AD43A", to: "#4D7C0F" },
  support: { from: "#22C3DE", to: "#0E7490" },
  "hr-payroll": { from: "#FB6B84", to: "#BE123C" },
  accounting: { from: "#5B9BFF", to: "#1D4ED8" },
};
const FALLBACK = { from: "#94A3B8", to: "#475569" };

export function ModuleMark({ module, className = "size-16" }: { module: ModuleNavigation; className?: string }) {
  const { from, to } = COLOURS[module.moduleKey] ?? FALLBACK;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-[27%] shadow-[0_6px_14px_rgba(15,23,42,0.16)] ${className}`}
      style={{ backgroundImage: `radial-gradient(circle at 25% 15%, rgba(255,255,255,0.28), transparent 70%), linear-gradient(135deg, ${from}, ${to})` }}
    >
      <module.icon aria-hidden="true" strokeWidth={2} className="size-1/2 text-white" />
    </span>
  );
}

export function ModuleLauncher({ modules }: { modules: ModuleNavigation[] }) {
  return (
    <ul className="grid grid-cols-3 gap-x-1 gap-y-2 sm:grid-cols-4 sm:gap-x-2 sm:gap-y-4 lg:grid-cols-6">
      {modules.map((module) => (
        <li key={module.moduleKey}>
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
