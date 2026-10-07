import { ItemListScreen } from "@/features/items/screens/ItemListScreen";

export const metadata = { title: "Products & Services" };

export default function Page() {
  return <ItemListScreen lens="sales" />;
}
