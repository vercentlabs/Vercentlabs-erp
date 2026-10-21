import { TransferFormScreen } from "@/features/transfers/screens/TransferFormScreen";

export const metadata = { title: "Edit Transfer" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TransferFormScreen transferId={id} />;
}
