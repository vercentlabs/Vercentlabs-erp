import { UnitsScreen } from "@/features/items/screens/UnitsScreen";

export const metadata = { title: "Units of Measure" };

// Inventory › Master Data › Units of Measure: the shared UOM master and its standard conversions (an item's own packaging lives on the item).
export default function Page() {
  return <UnitsScreen />;
}
