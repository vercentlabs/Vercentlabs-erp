import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { requireWorkspace } from "@/core/session";
import { ContactFormScreen } from "@/features/crm/contacts/screens/ContactFormScreen";

export const metadata = { title: "New contact" };

export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ accountId?: string }> }) {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.accountsManage);
  const { accountId } = await searchParams;
  return <ContactFormScreen mode="create" canManage={canManage} defaultAccountId={accountId} />;
}
