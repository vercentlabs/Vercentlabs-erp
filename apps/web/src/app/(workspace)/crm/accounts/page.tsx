import { requireWorkspace } from "@/core/session";
import { AccountListScreen } from "@/features/crm/accounts/screens/AccountListScreen";

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  await requireWorkspace();
  return <AccountListScreen />;
}
