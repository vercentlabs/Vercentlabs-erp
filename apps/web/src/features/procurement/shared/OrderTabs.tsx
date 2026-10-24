// Purchase Orders and their progress (Procurement report: Purchase Status is the orders' Progress tab, not a page of its own).
import { LinkTabs } from "@/shared/ui/RouteTabs";

export function OrderTabs({ current }: { current: "orders" | "progress" }) {
  return <LinkTabs label="Purchase orders" current={current} tabs={[
    { id: "orders", label: "Orders", href: "/procurement/purchase-orders" },
    { id: "progress", label: "Progress", href: "/procurement/purchase-status" },
  ]} />;
}
