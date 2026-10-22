import { RateContractDetailScreen } from "@/features/procurement/rate-contracts/RateContractScreens";

export const metadata = { title: "Rate contract" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RateContractDetailScreen contractId={id} />;
}
