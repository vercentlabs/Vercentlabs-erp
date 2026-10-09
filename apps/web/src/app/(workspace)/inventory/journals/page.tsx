import { AdjustmentsScreen } from "@/features/adjustments/screens/AdjustmentsScreen";
import { OpeningStockListScreen } from "@/features/opening-stock/screens/OpeningStockListScreen";
import { RouteTabs } from "@/shared/ui/RouteTabs";

export const metadata = { title: "Inventory Journals" };

const TABS = [{ id: "adjustments", label: "Adjustments" }, { id: "opening", label: "Opening Stock" }] as const;

// Inventory › Operations › Inventory Journals: stock adjustments and opening stock, one tab each (?tab=adjustments | opening). Each tab is
// the existing list, unchanged; documents keep their own addresses (/inventory/adjustments/<id>, /inventory/opening-stock/<id>).
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; itemId?: string }> }) {
  const { tab, itemId } = await searchParams;
  const current = tab === "opening" ? "opening" : "adjustments";
  return (
    <div className="flex flex-col gap-4">
      <RouteTabs label="Inventory journals" base="/inventory/journals" tabs={TABS} current={current} />
      {current === "opening" ? <OpeningStockListScreen /> : <AdjustmentsScreen initialItemId={typeof itemId === "string" ? itemId : undefined} />}
    </div>
  );
}
