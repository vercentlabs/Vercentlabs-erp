import { ItemFormScreen } from "@/features/items/screens/ItemFormScreen";

export const metadata = { title: "Edit Product" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItemFormScreen key={id} itemId={id} lens="sales" />;
}
