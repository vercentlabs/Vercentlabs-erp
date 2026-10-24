import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { RfqDetailScreen } from "@/features/procurement/rfqs/RfqScreens";

export const metadata = { title: "Price request" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <RfqDetailScreen rfqId={id} />
      <RecordThreadPanel type="procurement.rfq" id={id} />
    </div>
  );
}
