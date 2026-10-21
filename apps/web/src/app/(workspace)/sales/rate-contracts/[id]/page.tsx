import { RateContractDetailScreen } from "@/features/sales/rate-contracts/RateContractDetailScreen";

export const metadata = { title: "Rate Contract" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RateContractDetailScreen contractId={id} />;
}
