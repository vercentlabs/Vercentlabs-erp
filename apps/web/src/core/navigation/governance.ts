import { PERMISSIONS } from "@/core/permissions";
import type { NavigationItem } from "@/core/navigation/types";

// GOVERNANCE > Billing, Audit Logs (Prompt 9). Compliance now
// has a real route (/compliance) — the gap Prompt 6/8 explicitly left
// open pending this prompt. Each item's `keywords` cover its real
// sub-destinations (in-page tabs/sections, not separate sidebar entries —
// same "one flat destination per workspace" pattern Billing already
// established) so the command palette can find them without a second,
// parallel navigation tree (Part 32).
export const governanceNavigation: NavigationItem[] = [
  {
    href: "/billing",
    label: "Billing",
    icon: "billing",
    permission: PERMISSIONS.billingView,
    keywords: ["subscription", "plan", "usage", "invoice", "payment", "billing profile"],
  },
  {
    href: "/audit-logs",
    label: "Audit logs",
    icon: "audit",
    permission: PERMISSIONS.auditView,
    keywords: ["audit events", "record history", "user activity", "security events", "export"],
  },
];
