import { CashDifferencesPanel } from "@/features/pos/cash-differences/components/CashDifferencesPanel";
import { PosCashMovementsScreen } from "@/features/pos/cash-movements/screens/PosCashMovementsScreen";
import { CashTransfersPanel } from "@/features/pos/shift-closing/components/CashTransfersPanel";
import { CurrentShiftWorkspace } from "@/features/pos/shifts/components/CurrentShiftWorkspace";
import { PosShiftsScreen } from "@/features/pos/shifts/screens/PosShiftsScreen";
import { tabOf } from "@/features/pos/shared/pos-tabs";
import { PosTabs } from "@/features/pos/shared/PosTabs";

export const metadata = { title: "Shifts & Cash" };

const TABS = [{ id: "current", label: "Current shift" }, { id: "history", label: "Shift history" }, { id: "cash-movements", label: "Cash movements" },
  { id: "exceptions", label: "Exceptions", anyPermission: ["pos.shift.close", "pos.cash.adjust", "pos.store.manage", "pos.reconciliation.view"] }];

// POS › Shifts & Cash: the cashier's own shift — open it, see it, close it (?tab=current); every authorized shift and its closing report
// (?tab=history); cash in and out (?tab=cash-movements); and cash differences and pending handovers (?tab=exceptions).
export default async function PosShiftsPage({ searchParams }: { searchParams: Promise<{ tab?: string; close?: string }> }) {
  const query = await searchParams;
  const tab = tabOf(TABS, query.tab);
  return (
    <div className="flex flex-col gap-4">
      <PosTabs label="Shifts and cash" base="/pos/shifts" tabs={TABS} current={tab} />
      {tab === "history" ? <PosShiftsScreen /> : tab === "cash-movements" ? <PosCashMovementsScreen />
        : tab === "exceptions" ? <div className="flex flex-col gap-4"><CashDifferencesPanel /><CashTransfersPanel /></div>
        : <CurrentShiftWorkspace startClosing={query.close === "1"} />}
    </div>
  );
}
