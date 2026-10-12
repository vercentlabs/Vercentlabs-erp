import { PosSettingsScreen } from "@/features/pos/settings/screens/PosSettingsScreen";

export const metadata = { title: "POS Settings" };

// POS › Configuration › POS Setup: payments, cash and shifts, discounts, returns, receipts, day-end and reconciliation policies.
export default function Page() {
  return <PosSettingsScreen />;
}
