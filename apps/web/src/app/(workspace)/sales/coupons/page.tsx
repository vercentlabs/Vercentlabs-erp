import { CouponsScreen } from "@/features/sales/settings/screens/CouponsScreen";
import { PricesTabs } from "@/features/sales/shared/SalesTabs";

export const metadata = { title: "Coupons" };

// Sales › Setup › Prices & Offers › Coupons (Sales report Phase 3).
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <PricesTabs current="coupons" />
      <CouponsScreen />
    </div>
  );
}
