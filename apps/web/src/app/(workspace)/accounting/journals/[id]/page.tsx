import { JournalDetailScreen } from "@/features/accounting/automatic/screens/JournalDetailScreen";

export const metadata = { title: "Journal entry" };

export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <JournalDetailScreen id={id} />;
}
