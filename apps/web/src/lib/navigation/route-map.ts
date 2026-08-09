import type { ModuleId } from "@/lib/navigation/types";

// The 12 module route roots — used by (a) each module's layout.tsx guard to
// know its own moduleId without repeating a string literal, and (b) any
// caller that needs to resolve an arbitrary pathname back to a module
// (e.g. a future breadcrumb/search integration). This is the "module-route
// mapping" Part 10 asks for.
export const MODULE_ROUTE_ROOTS: Readonly<Record<ModuleId, string>> = Object.freeze({
  crm: "/crm",
  sales: "/sales",
  accounting: "/accounting",
  procurement: "/procurement",
  stock: "/stock",
  manufacturing: "/manufacturing",
  projects: "/projects",
  assets: "/assets",
  "point-of-sale": "/point-of-sale",
  quality: "/quality",
  support: "/support",
  "hr-payroll": "/hr-payroll",
});

const ROUTE_ROOT_ENTRIES = Object.entries(MODULE_ROUTE_ROOTS) as Array<[ModuleId, string]>;

// Sorted longest-root-first so a future module whose root is a prefix of
// another's (none today) can't shadow the more specific match.
const SORTED_ROUTE_ROOTS = [...ROUTE_ROOT_ENTRIES].sort((a, b) => b[1].length - a[1].length);

export function moduleIdForPath(pathname: string): ModuleId | null {
  const match = SORTED_ROUTE_ROOTS.find(
    ([, root]) => pathname === root || pathname.startsWith(`${root}/`),
  );
  return match ? match[0] : null;
}
