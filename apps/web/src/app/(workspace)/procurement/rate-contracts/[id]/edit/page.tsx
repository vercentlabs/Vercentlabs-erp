import { RateContractFormScreen } from "@/features/procurement/rate-contracts/RateContractScreens";

export const metadata = { title: "Edit rate contract" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RateContractFormScreen contractId={id} />;
}
