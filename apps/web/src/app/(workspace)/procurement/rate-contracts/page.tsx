import { RateContractsScreen } from "@/features/procurement/rate-contracts/RateContractScreens";
import { RatesTabs } from "@/features/procurement/supplier-rates/SupplierRateScreens";

export const metadata = { title: "Rate contracts" };

export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <RatesTabs current="contracts" />
      <RateContractsScreen />
    </div>
  );
}
