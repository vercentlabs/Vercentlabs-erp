import { requireWorkspace } from "@/core/session";
import { AccountFormScreen } from "@/features/crm/accounts/screens/AccountFormScreen";

export const metadata = { title: "Edit account" };

export default async function EditAccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  await requireWorkspace();
  return <AccountFormScreen accountId={(await params).accountId} />;
}
