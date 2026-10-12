import { CashiersScreen } from "@/features/pos/cashiers/screens/CashiersScreen";
import { OutletsScreen } from "@/features/pos/outlets/screens/OutletsScreen";
import { ProfilesScreen } from "@/features/pos/permission-profiles/screens/ProfilesScreen";
import { ScanDiagnosticsScreen } from "@/features/pos/products/scanner/ScanDiagnosticsScreen";
import { PosSettingsScreen } from "@/features/pos/settings/screens/PosSettingsScreen";
import { tabOf } from "@/features/pos/shared/pos-tabs";
import { PosTabs } from "@/features/pos/shared/PosTabs";
import { TerminalsScreen } from "@/features/pos/terminals/screens/TerminalsScreen";

export const metadata = { title: "POS Settings" };

const TABS = [
  { id: "general", label: "General & policies", anyPermission: ["pos.settings.manage"] },
  { id: "outlets", label: "Outlets", anyPermission: ["pos.outlets.view"] },
  { id: "terminals", label: "Terminals", anyPermission: ["pos.terminals.view"] },
  { id: "cashiers", label: "Cashiers", anyPermission: ["pos.cashiers.view"] },
  { id: "permissions", label: "Cashier permissions", anyPermission: ["pos.permission_profiles.view"] },
  { id: "scanner", label: "Scanner diagnostics", anyPermission: ["pos.terminals.view_transactions"] },
];

// POS › Settings: policies (payments, cash and shifts, discounts, returns, receipts, day-end, reconciliation) and the outlets, terminals,
// cashiers and permission profiles POS runs on. Each record keeps its own address (/pos/outlets/<id>, /pos/terminals/<id> …). Prices, tax,
// warehouses, provider credentials and Finance accounts stay in their own modules.
export default async function PosSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; outletId?: string }> }) {
  const query = await searchParams;
  const tab = tabOf(TABS, query.tab);
  return (
    <div className="flex flex-col gap-4">
      <PosTabs label="POS settings" base="/pos/settings" tabs={TABS} current={tab} />
      {tab === "outlets" ? <OutletsScreen /> : tab === "terminals" ? <TerminalsScreen initialOutletId={query.outletId ?? null} />
        : tab === "cashiers" ? <CashiersScreen /> : tab === "permissions" ? <ProfilesScreen /> : tab === "scanner" ? <ScanDiagnosticsScreen /> : <PosSettingsScreen />}
    </div>
  );
}
