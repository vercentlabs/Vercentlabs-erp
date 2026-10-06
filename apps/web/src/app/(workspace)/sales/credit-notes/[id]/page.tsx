import { CreditNoteDetailScreen } from "@/features/sales/credit-notes/screens/CreditNoteDetailScreen";

export const metadata = { title: "Credit note" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CreditNoteDetailScreen creditNoteId={id} />;
}
