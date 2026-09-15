import { requireWorkspace } from "@/core/session";
import { ContactDetailScreen } from "@/features/crm/contacts/screens/ContactDetailScreen";

export const metadata = { title: "Contact" };

export default async function ContactDetailPage({ params }: { params: Promise<{ contactId: string }> }) {
  await requireWorkspace();
  const { contactId } = await params;
  return <ContactDetailScreen contactId={contactId} />;
}
