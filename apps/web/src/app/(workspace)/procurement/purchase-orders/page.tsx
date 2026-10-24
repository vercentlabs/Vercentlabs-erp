import { PurchaseOrdersScreen } from "@/features/procurement/purchase-orders/screens/PurchaseOrdersScreen";
import { OrderTabs } from "@/features/procurement/shared/OrderTabs";

export const metadata = { title: "Purchase orders" };

export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <OrderTabs current="orders" />
      <PurchaseOrdersScreen />
    </div>
  );
}
