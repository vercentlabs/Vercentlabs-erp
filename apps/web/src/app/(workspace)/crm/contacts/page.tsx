import { requireWorkspace } from "@/core/session";
import { ContactListScreen } from "@/features/crm/contacts/screens/ContactListScreen";

export const metadata = { title: "Contacts" };

export default async function ContactsPage() {
  await requireWorkspace();
  return <ContactListScreen />;
}
