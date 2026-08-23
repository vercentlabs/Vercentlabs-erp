import { PERMISSIONS } from "@/core/permissions";
import type { NavigationItem } from "@/core/navigation/types";

// WORKSPACE > Home, Master Data. Master Data's deeper target subtree
// (Organisation/Parties/Products/Inventory/Finance/Shared, ~25 leaves) is
// served today by one dynamic /master-data/[resource] page reading from
// business-data.ts's resource registry, not 25 distinct routes — the
// registry keeps the single real entry rather than fabricating leaf pages
// (see docs/implementation/ERP_NAVIGATION_FOUNDATION_006.md's Route Gap
// Matrix: MERGED INTO EXISTING WORKSPACE).
export const workspaceNavigation: NavigationItem[] = [
  { href: "/dashboard", label: "Home", icon: "dashboard", exact: true },
  {
    href: "/master-data",
    label: "Master data",
    icon: "modules",
    permission: PERMISSIONS.businessDataView,
  },
];
