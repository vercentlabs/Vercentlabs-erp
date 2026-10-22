import { RateContractFormScreen } from "@/features/procurement/rate-contracts/RateContractScreens";

export const metadata = { title: "New rate contract" };

// A new rate contract: a supplier's agreed rates for a period.
export default function Page() {
  return <RateContractFormScreen />;
}
