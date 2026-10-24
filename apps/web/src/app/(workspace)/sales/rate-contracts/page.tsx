import { RateContractsScreen } from "@/features/sales/rate-contracts/RateContractsScreen";
import { PricesTabs } from "@/features/sales/shared/SalesTabs";

export const metadata = { title: "Customer rates" };

// Sales › Setup › Prices & Offers › Customer rates (rate contracts).
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <PricesTabs current="contracts" />
      <RateContractsScreen />
    </div>
  );
}
