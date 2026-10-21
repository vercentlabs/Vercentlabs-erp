import { ClaimFormScreen } from "@/features/procurement/vendor-credits/screens/ClaimScreens";

export const metadata = { title: "Edit debit note" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClaimFormScreen claimId={id} />;
}
