import { ReturnDetailScreen } from "@/features/sales/returns/screens/ReturnDetailScreen";

export const metadata = { title: "Sales return" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReturnDetailScreen returnId={id} />;
}
