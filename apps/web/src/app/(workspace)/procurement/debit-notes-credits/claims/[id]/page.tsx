import { ClaimDetailScreen } from "@/features/procurement/vendor-credits/screens/ClaimScreens";

export const metadata = { title: "Debit note to supplier" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClaimDetailScreen claimId={id} />;
}
