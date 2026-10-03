import { requireWorkspace } from "@/core/session";
import { ContactDetailScreen } from "@/features/crm/contacts/screens/ContactDetailScreen";

export const metadata = { title: "Contact" };

export default async function ContactPage({ params }: { params: Promise<{ contactId: string }> }) {
  await requireWorkspace();
  return <ContactDetailScreen contactId={(await params).contactId} />;
}
