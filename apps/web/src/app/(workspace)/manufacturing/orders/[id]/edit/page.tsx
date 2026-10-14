import { MoFormScreen } from "@/features/manufacturing/orders/screens/MoFormScreen";

export const metadata = { title: "Edit manufacturing order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MoFormScreen orderId={id} />;
}
