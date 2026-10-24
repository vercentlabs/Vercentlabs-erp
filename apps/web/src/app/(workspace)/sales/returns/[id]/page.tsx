import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { ReturnDetailScreen } from "@/features/sales/returns/screens/ReturnDetailScreen";

export const metadata = { title: "Sales return" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <ReturnDetailScreen returnId={id} />
      <RecordThreadPanel type="sales.return" id={id} />
    </div>
  );
}
