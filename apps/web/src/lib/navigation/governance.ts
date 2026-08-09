import { PERMISSIONS } from "@/lib/permissions-catalog";
import type { NavigationItem } from "@/lib/navigation/types";

// GOVERNANCE > Billing, Audit Logs. Target IA also names Compliance —
// no real route exists today (no /compliance page); omitted per Part 8
// rather than linked to a placeholder. See the Route Gap Matrix.
export const governanceNavigation: NavigationItem[] = [
  {
    href: "/billing",
    label: "Billing",
    icon: "billing",
    permission: PERMISSIONS.billingView,
  },
  {
    href: "/audit-logs",
    label: "Audit logs",
    icon: "audit",
    permission: PERMISSIONS.auditView,
  },
];
