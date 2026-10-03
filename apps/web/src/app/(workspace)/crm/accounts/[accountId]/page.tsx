import { requireWorkspace } from "@/core/session";
import { AccountDetailScreen } from "@/features/crm/accounts/screens/AccountDetailScreen";

export const metadata = { title: "Account" };

export default async function AccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  await requireWorkspace();
  return <AccountDetailScreen accountId={(await params).accountId} />;
}
