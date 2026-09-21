import { getCrmContactForCaller } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { requireWorkspace } from "@/core/session";
import { crmContext, loadRecordForEdit } from "@/features/crm/shared/crm-context";
import { ContactFormScreen } from "@/features/crm/contacts/screens/ContactFormScreen";
import type { Contact } from "@/features/crm/contacts/types";

export const metadata = { title: "Edit contact" };

export default async function EditContactPage({ params }: { params: Promise<{ contactId: string }> }) {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.accountsManage);
  const { contactId } = await params;
  const loaded = canManage ? await loadRecordForEdit(session, (client) => getCrmContactForCaller(client, crmContext(session), contactId)) : { record: null, notFound: false };
  const contact = loaded.record as Contact | null;
  const notFound = loaded.notFound;
  return <ContactFormScreen mode="edit" contact={contact ?? undefined} canManage={canManage} notFound={notFound} />;
}
