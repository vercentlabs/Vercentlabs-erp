import { requireWorkspace } from "@/core/session";
import { AccountDetailScreen } from "@/features/crm/accounts/screens/AccountDetailScreen";

export const metadata = { title: "Account" };

export default async function AccountDetailPage({ params }: { params: Promise<{ accountId: string }> }) {
  await requireWorkspace();
  const { accountId } = await params;
  return <AccountDetailScreen accountId={accountId} />;
}
