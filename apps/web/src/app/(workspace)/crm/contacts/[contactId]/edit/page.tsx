import { requireWorkspace } from "@/core/session";
import { ContactFormScreen } from "@/features/crm/contacts/screens/ContactFormScreen";

export const metadata = { title: "Edit contact" };

export default async function EditContactPage({ params }: { params: Promise<{ contactId: string }> }) {
  await requireWorkspace();
  return <ContactFormScreen contactId={(await params).contactId} />;
}
