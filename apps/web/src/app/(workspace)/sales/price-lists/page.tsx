import { PriceListsScreen } from "@/features/sales/price-lists/screens/PriceListsScreen";
import { PricesTabs } from "@/features/sales/shared/SalesTabs";

export const metadata = { title: "Price lists" };

// Sales › Setup › Prices & Offers › Price lists.
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <PricesTabs current="lists" />
      <PriceListsScreen />
    </div>
  );
}
