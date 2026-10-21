import { JournalFormScreen } from "@/features/accounting/journals/screens/JournalFormScreen";

export const metadata = { title: "Edit journal" };

export default async function EditJournalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JournalFormScreen journalId={id} />;
}
