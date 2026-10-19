import { RecordThreadPanel } from "@/features/platform/record-thread/RecordThreadPanel";
import { ItemDetailScreen } from "@/features/items/screens/ItemDetailScreen";

export const metadata = { title: "Item" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="flex flex-col gap-4">
      <ItemDetailScreen key={id} itemId={id} lens="inventory" />
      <RecordThreadPanel type="products.item" id={id} />
    </div>
  );
}
