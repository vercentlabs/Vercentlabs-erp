import { ApprovalsScreen } from "@/features/pos/permission-profiles/screens/ApprovalsScreen";
import { PosRefundsScreen } from "@/features/pos/refunds/screens/PosRefundsScreen";
import { PosReturnsScreen } from "@/features/pos/returns/screens/PosReturnsScreen";
import { tabOf } from "@/features/pos/shared/pos-tabs";
import { PosTabs } from "@/features/pos/shared/PosTabs";

export const metadata = { title: "Returns & Refunds" };

const TABS = [{ id: "returns", label: "Returns" }, { id: "refunds", label: "Refunds" },
  { id: "approvals", label: "Approvals", anyPermission: ["pos.return.approve", "pos.discount.approve", "pos.payment.refund", "pos.store.manage"] }];

// POS › Returns & Refunds: returns (?tab=returns), the refunds owed and paid (?tab=refunds) and the supervisor approvals waiting
// (?tab=approvals). A return and a refund keep their own addresses (/pos/returns/<id>, /pos/refunds/<id>).
export default async function PosReturnsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = tabOf(TABS, (await searchParams).tab);
  return (
    <div className="flex flex-col gap-4">
      <PosTabs label="Returns and refunds" base="/pos/returns" tabs={TABS} current={tab} />
      {tab === "refunds" ? <PosRefundsScreen /> : tab === "approvals" ? <ApprovalsScreen /> : <PosReturnsScreen />}
    </div>
  );
}
