import { requireWorkspace } from "@/core/session";
import { ExchangeRatesScreen } from "@/features/settings/finance-commercial/exchange-rates/screens/ExchangeRatesScreen";

export const metadata = { title: "Exchange rates" };

export default async function Page() {
  await requireWorkspace();
  return <ExchangeRatesScreen />;
}
