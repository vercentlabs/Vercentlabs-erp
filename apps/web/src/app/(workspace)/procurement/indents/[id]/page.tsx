import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { IndentDetailScreen } from "@/features/procurement/indents/IndentScreens";

export const metadata = { title: "Purchase request" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <IndentDetailScreen indentId={id} />
      <RecordThreadPanel type="procurement.indent" id={id} />
    </div>
  );
}
