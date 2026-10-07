import { ItemCategoriesScreen } from "@/features/items/categories/ItemCategoriesScreen";

export const metadata = { title: "Item Category" };

export default async function Page({ params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  return <ItemCategoriesScreen categoryId={categoryId} />;
}
