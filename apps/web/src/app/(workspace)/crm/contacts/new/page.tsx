import { requireWorkspace } from "@/core/session";
import { ContactFormScreen } from "@/features/crm/contacts/screens/ContactFormScreen";

export const metadata = { title: "New contact" };

// ?accountId= preselects the company when opened from an account.
export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ accountId?: string }> }) {
  await requireWorkspace();
  const { accountId } = await searchParams;
  return <ContactFormScreen initialAccountId={typeof accountId === "string" ? accountId : undefined} />;
}
