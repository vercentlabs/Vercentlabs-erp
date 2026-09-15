import { getCrmContactForCaller } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { withClient } from "@/core/db";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";
import { ContactFormScreen } from "@/features/crm/contacts/screens/ContactFormScreen";
import type { Contact } from "@/features/crm/contacts/types";

export const metadata = { title: "Edit contact" };

export default async function EditContactPage({ params }: { params: Promise<{ contactId: string }> }) {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.accountsManage);
  const { contactId } = await params;
  let contact: Contact | null = null;
  let notFound = false;
  if (canManage) {
    try {
      contact = await withClient((client) => getCrmContactForCaller(client, crmContext(session), contactId));
    } catch {
      notFound = true;
    }
  }
  return <ContactFormScreen mode="edit" contact={contact ?? undefined} canManage={canManage} notFound={notFound} />;
}
