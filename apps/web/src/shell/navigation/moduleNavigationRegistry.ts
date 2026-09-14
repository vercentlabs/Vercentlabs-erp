// The single navigation authority for the application shell — primary
// sidebar, command menu, mobile nav and breadcrumbs must all read from
// this registry rather than each defining their own nav arrays (Phase 7).
//
// IMPORTANT — Prompt 2 scope honesty: for the 12 business modules, this
// registry currently registers exactly ONE real destination per module
// (an honest entitlement/permission-gated "Overview" foundation route),
// NOT the full per-module secondary information architecture the Prompt 2
// brief sketched. That deeper IA (CRM -> F001-F030, Sales -> F031-F062,
// etc.) requires cross-checking every entry against
// docs/02-register/FEATURE_REGISTER.csv and each module's own dossier
// before it can be added — the brief's own explicit instruction is "do
// not add navigation merely because this prompt names it if repository
// requirements contradict it." That validation pass did not happen this
// prompt; registering a large speculative nav tree here would have
// violated that instruction, and simulating "implemented" status for
// unvalidated destinations would violate the no-dead-links rule below.
// CRM's real secondary IA is scoped to Prompt 3 (F001-F030); the other 11
// modules' secondary IA is left for their own future prompts. See
// docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv and
// docs/ux/UI_REWRITE_TRACKER.md for the tracked gap.
import type { ComponentType, SVGProps } from "react";
import {
  Home,
  ListChecks,
  Search,
  Users,
  ShoppingCart,
  Truck,
  Boxes,
  Factory,
  FolderKanban,
  Wrench,
  Store,
  BadgeCheck,
  LifeBuoy,
  Landmark,
  CheckSquare,
  Bell,
  ListTodo,
  HelpCircle,
  Settings,
} from "lucide-react";

export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

export type NavAvailability = "implemented" | "foundation" | "planned";

export type ModuleNavEntry = {
  moduleKey: string;
  label: string;
  href: string;
  icon: NavIcon;
  /** The module's base view permission, per services/api/src/core/module-entitlements.js. */
  requiredPermission: string;
  availability: NavAvailability;
  /** Search/command-menu aliases. */
  keywords: string[];
};

// Exact order mandated by Prompt 2 Phase 6: CRM, Sales, Procurement,
// Inventory, Manufacturing, Projects, Assets, POS, Quality, Support,
// HR & Payroll, Accounting. "Inventory" in that IA maps to the "stock"
// module key used throughout services/api/packages/shared-types.
export const MODULE_NAV_ENTRIES: readonly ModuleNavEntry[] = [
  {
    moduleKey: "crm",
    label: "CRM",
    href: "/crm",
    icon: Users,
    requiredPermission: "crm.view",
    availability: "foundation",
    keywords: ["leads", "opportunities", "accounts", "contacts", "crm"],
  },
  {
    moduleKey: "sales",
    label: "Sales",
    href: "/sales",
    icon: ShoppingCart,
    requiredPermission: "sales.view",
    availability: "foundation",
    keywords: ["quotations", "orders", "sales"],
  },
  {
    moduleKey: "procurement",
    label: "Procurement",
    href: "/procurement",
    icon: Truck,
    requiredPermission: "procurement.view",
    availability: "foundation",
    keywords: ["suppliers", "purchase orders", "procurement"],
  },
  {
    moduleKey: "stock",
    label: "Inventory",
    href: "/inventory",
    icon: Boxes,
    requiredPermission: "stock.view",
    availability: "foundation",
    keywords: ["warehouse", "stock", "inventory"],
  },
  {
    moduleKey: "manufacturing",
    label: "Manufacturing",
    href: "/manufacturing",
    icon: Factory,
    requiredPermission: "manufacturing.view",
    availability: "foundation",
    keywords: ["bom", "work orders", "production", "manufacturing"],
  },
  {
    moduleKey: "projects",
    label: "Projects",
    href: "/projects",
    icon: FolderKanban,
    requiredPermission: "projects.view",
    availability: "foundation",
    keywords: ["tasks", "milestones", "projects"],
  },
  {
    moduleKey: "assets",
    label: "Assets",
    href: "/assets",
    icon: Wrench,
    requiredPermission: "assets.view",
    availability: "foundation",
    keywords: ["asset register", "maintenance", "assets"],
  },
  {
    moduleKey: "point-of-sale",
    label: "POS",
    href: "/pos",
    icon: Store,
    requiredPermission: "pos.view",
    availability: "foundation",
    keywords: ["checkout", "terminal", "pos", "point of sale"],
  },
  {
    moduleKey: "quality",
    label: "Quality",
    href: "/quality",
    icon: BadgeCheck,
    requiredPermission: "quality.view",
    availability: "foundation",
    keywords: ["inspections", "capa", "quality"],
  },
  {
    moduleKey: "support",
    label: "Support",
    href: "/support",
    icon: LifeBuoy,
    requiredPermission: "support.view",
    availability: "foundation",
    keywords: ["tickets", "sla", "support"],
  },
  {
    moduleKey: "hr-payroll",
    label: "HR & Payroll",
    href: "/hr",
    icon: Landmark,
    requiredPermission: "hr_payroll.view",
    availability: "foundation",
    keywords: ["employees", "payroll", "leave", "hr"],
  },
  {
    moduleKey: "accounting",
    label: "Accounting",
    href: "/accounting",
    icon: Landmark,
    requiredPermission: "accounting.view",
    availability: "foundation",
    keywords: ["ledger", "journals", "accounting"],
  },
];

export type GlobalNavEntry = {
  key: string;
  label: string;
  href: string;
  icon: NavIcon;
  /** null = no permission required beyond an authenticated workspace session. */
  requiredPermission: string | null;
  availability: NavAvailability;
  keywords: string[];
};

export const GLOBAL_NAV_TOP: readonly GlobalNavEntry[] = [
  {
    key: "home",
    label: "Home",
    href: "/",
    icon: Home,
    requiredPermission: null,
    availability: "implemented",
    keywords: ["home", "dashboard"],
  },
  {
    key: "work",
    label: "Work",
    href: "/work",
    icon: ListChecks,
    requiredPermission: null,
    availability: "foundation",
    keywords: ["my work", "tasks", "assigned"],
  },
  {
    key: "search",
    label: "Search",
    href: "/search",
    icon: Search,
    requiredPermission: null,
    availability: "foundation",
    keywords: ["search", "find"],
  },
];

export const GLOBAL_NAV_BOTTOM: readonly GlobalNavEntry[] = [
  {
    key: "approvals",
    label: "Approvals",
    href: "/approvals",
    icon: CheckSquare,
    requiredPermission: "approvals.manage",
    availability: "foundation",
    keywords: ["approvals", "inbox"],
  },
  {
    key: "notifications",
    label: "Notifications",
    href: "/notifications",
    icon: Bell,
    requiredPermission: null,
    availability: "foundation",
    keywords: ["notifications", "alerts"],
  },
  {
    key: "jobs",
    label: "Background Jobs",
    href: "/jobs",
    icon: ListTodo,
    requiredPermission: null,
    availability: "foundation",
    keywords: ["jobs", "background jobs", "imports"],
  },
];

export const UTILITY_NAV: readonly GlobalNavEntry[] = [
  {
    key: "help",
    label: "Help",
    href: "/help",
    icon: HelpCircle,
    requiredPermission: null,
    availability: "planned",
    keywords: ["help", "support"],
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: Settings,
    requiredPermission: null,
    availability: "foundation",
    keywords: ["settings", "administration"],
  },
];
