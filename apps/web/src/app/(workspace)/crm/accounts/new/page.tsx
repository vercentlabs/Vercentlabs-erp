import { requireWorkspace } from "@/core/session";
import { AccountFormScreen } from "@/features/crm/accounts/screens/AccountFormScreen";

export const metadata = { title: "New account" };

export default async function NewAccountPage() {
  await requireWorkspace();
  return <AccountFormScreen />;
}
