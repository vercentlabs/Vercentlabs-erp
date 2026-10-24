import { PricingRulesScreen } from "@/features/sales/pricing-rules/screens/PricingRulesScreen";
import { PricesTabs } from "@/features/sales/shared/SalesTabs";

export const metadata = { title: "Schemes & offers" };

// Sales › Setup › Prices & Offers › Schemes & offers.
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <PricesTabs current="schemes" />
      <PricingRulesScreen />
    </div>
  );
}
