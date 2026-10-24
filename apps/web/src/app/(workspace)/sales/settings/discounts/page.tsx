import { DiscountControlsScreen } from "@/features/sales/settings/screens/SalesSettingsPages";
import { PricesTabs } from "@/features/sales/shared/SalesTabs";

export const metadata = { title: "Discount limits" };

// Sales › Setup › Prices & Offers › Discount limits.
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <PricesTabs current="discounts" />
      <DiscountControlsScreen />
    </div>
  );
}
