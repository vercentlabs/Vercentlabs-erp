import { TransferDetailScreen } from "@/features/transfers/screens/TransferDetailScreen";

export const metadata = { title: "Transfer" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TransferDetailScreen transferId={id} />;
}
