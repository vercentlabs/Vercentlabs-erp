import { ItemListScreen } from "@/features/items/screens/ItemListScreen";

export const metadata = { title: "Items" };

export default function Page() {
  return <ItemListScreen lens="inventory" />;
}
