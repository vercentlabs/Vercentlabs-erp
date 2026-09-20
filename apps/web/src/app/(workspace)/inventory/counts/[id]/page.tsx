import { CountDetailScreen } from "@/features/inventory/screens/CountDetailScreen";

export const metadata = { title: "Stock count" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CountDetailScreen id={id} />;
}
