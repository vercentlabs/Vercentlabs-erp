import { requireWorkspace } from "@/core/session";
import { AccountReportScreen } from "@/features/crm/accounts/screens/AccountReportScreen";

export const metadata = { title: "Accounts report" };

export default async function AccountReportPage() {
  await requireWorkspace();
  return <AccountReportScreen />;
}
