"use client";

// The "+ Create" menu of Procurement and Inventory (CRM and Sales have their own, with source pickers): the documents and master records a
// person starts in that module, each shown only with the permission to create it. Every entry opens the record's own new page, where the
// usual checks run; documents that follow a source (a bill from an order, a return from a receipt) can also be started from that source.
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Menu, MenuItem, MenuSeparator, MenuTrigger } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Entry = { label: string; href: string; permissions: string[] };

const MENUS: Record<string, Entry[][]> = {
  procurement: [
    [
      { label: "Supplier", href: "/procurement/suppliers/new", permissions: ["procurement.suppliers.create"] },
      { label: "Purchase Order", href: "/procurement/purchase-orders/new", permissions: ["procurement.po.create"] },
    ],
    [
      { label: "Goods Receipt", href: "/procurement/goods-receipts/new", permissions: ["procurement.receipts.manage"] },
      { label: "Supplier Bill", href: "/procurement/supplier-bills/new", permissions: ["procurement.bills.create"] },
      { label: "Purchase Return", href: "/procurement/purchase-returns/new", permissions: ["procurement.returns.manage"] },
      { label: "Debit Note", href: "/procurement/debit-notes-credits/claims/new", permissions: ["procurement.claims.manage"] },
      { label: "Vendor Credit", href: "/procurement/debit-notes-credits/vendor-credits/new", permissions: ["procurement.credits.manage"] },
    ],
  ],
  stock: [
    [
      { label: "Item", href: "/inventory/items/new", permissions: ["products.create"] },
    ],
    [
      { label: "Goods Issue", href: "/inventory/goods-issues/new", permissions: ["stock.goods_issue.create"] },
      { label: "Internal Transfer", href: "/inventory/transfers/new", permissions: ["stock.transfers.create"] },
      { label: "Stock Adjustment", href: "/inventory/adjustments/new", permissions: ["stock.adjustments.create"] },
      { label: "Stock Count", href: "/inventory/stock-counts/new", permissions: ["stock.counts.create"] },
      { label: "Quality Hold", href: "/inventory/quality-holds/new", permissions: ["stock.holds.create"] },
      { label: "Opening Stock", href: "/inventory/opening-stock/new", permissions: ["stock.opening"] },
    ],
  ],
};

export function ModuleCreateMenu({ moduleKey, size = "standard" }: { moduleKey: "procurement" | "stock"; size?: "compact" | "standard" }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const owner = workspace.roleSlugs.includes("organization_owner") || workspace.roleSlugs.includes("system_administrator");
  const groups = (MENUS[moduleKey] ?? [])
    .map((group) => group.filter((entry) => owner || entry.permissions.some((permission) => workspace.permissions.includes(permission))))
    .filter((group) => group.length > 0);
  if (!groups.length) return null;
  return (
    <MenuTrigger>
      <Button variant="primary" size={size}>
        <Plus className="size-4" aria-hidden="true" />
        Create
      </Button>
      <Menu onAction={(key) => router.push(String(key))}>
        {groups.flatMap((group, index) => [
          ...(index > 0 ? [<MenuSeparator key={`separator-${index}`} />] : []),
          ...group.map((entry) => <MenuItem key={entry.href} id={entry.href}>{entry.label}</MenuItem>),
        ])}
      </Menu>
    </MenuTrigger>
  );
}
