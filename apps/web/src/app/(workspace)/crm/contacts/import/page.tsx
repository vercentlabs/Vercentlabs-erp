import { requireWorkspace } from "@/core/session";
import { ContactImportScreen } from "@/features/crm/contacts/screens/ContactImportScreen";

export const metadata = { title: "Import contacts" };

export default async function ImportContactsPage() {
  await requireWorkspace();
  return <ContactImportScreen />;
}
