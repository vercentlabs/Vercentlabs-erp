import { GoodsReceiptsScreen } from "@/features/procurement/purchase-orders/screens/ReceivingScreens";

export const metadata = { title: "Goods receipts" };

// Inventory › Operations › Goods Receipts: the one Goods Receipt list (Procurement's), opened here so a storekeeper stays in Inventory.
// There is no second receipt: each row opens the receipt itself, /procurement/goods-receipts/<id>.
export default function Page() {
  return <GoodsReceiptsScreen />;
}
