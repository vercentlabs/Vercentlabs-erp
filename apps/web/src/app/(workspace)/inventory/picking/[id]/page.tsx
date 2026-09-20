import { PickDetailScreen } from "@/features/inventory/screens/PickDetailScreen";

export const metadata = { title: "Pick list" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PickDetailScreen id={id} />;
}
