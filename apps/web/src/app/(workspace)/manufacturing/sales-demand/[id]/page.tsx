import { SalesDemandDetailScreen } from "@/features/manufacturing/demand/screens/SalesDemandDetailScreen";

export const metadata = { title: "Customer demand" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesDemandDetailScreen demandId={id} />;
}
