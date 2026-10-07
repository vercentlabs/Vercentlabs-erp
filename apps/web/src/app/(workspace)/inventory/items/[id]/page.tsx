import { ItemDetailScreen } from "@/features/items/screens/ItemDetailScreen";

export const metadata = { title: "Item" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItemDetailScreen key={id} itemId={id} lens="inventory" />;
}
