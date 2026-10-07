import { ItemDetailScreen } from "@/features/items/screens/ItemDetailScreen";

export const metadata = { title: "Product" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItemDetailScreen key={id} itemId={id} lens="sales" />;
}
