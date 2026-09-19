import { requireWorkspace } from "@/core/session";
import { PosCustomersScreen } from "@/features/pos/customers/screens/PosCustomersScreen";

export const metadata = { title: "POS Customers" };

export default async function PosCustomersPage() {
  await requireWorkspace();
  return <PosCustomersScreen />;
}
