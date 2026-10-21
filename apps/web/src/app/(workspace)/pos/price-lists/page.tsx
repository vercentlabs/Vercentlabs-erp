import { PriceListsScreen } from "@/features/sales/price-lists/screens/PriceListsScreen";

export const metadata = { title: "Price Lists" };

// Point of Sale › Price Lists: the same price lists as Sales (shared pricing), for a company that sells at the counter without Sales.
export default function Page() {
  return <PriceListsScreen />;
}
