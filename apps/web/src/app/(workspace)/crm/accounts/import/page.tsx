import { requireWorkspace } from "@/core/session";
import { AccountImportScreen } from "@/features/crm/accounts/screens/AccountImportScreen";

export const metadata = { title: "Import accounts" };

export default async function ImportAccountsPage() {
  await requireWorkspace();
  return <AccountImportScreen />;
}
