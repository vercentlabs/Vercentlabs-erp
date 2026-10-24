import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { ClaimDetailScreen } from "@/features/procurement/vendor-credits/screens/ClaimScreens";

export const metadata = { title: "Debit note to supplier" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <ClaimDetailScreen claimId={id} />
      <RecordThreadPanel type="procurement.debit_note" id={id} />
    </div>
  );
}
