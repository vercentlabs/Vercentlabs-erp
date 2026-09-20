import { OrderDetailScreen } from "@/features/manufacturing/screens/OrderDetailScreen";

export const metadata = { title: "Production order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetailScreen id={id} />;
}
