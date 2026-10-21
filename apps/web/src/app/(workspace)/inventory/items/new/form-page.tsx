import { ItemFormScreen } from "@/features/items/screens/ItemFormScreen";

export const metadata = { title: "New Item" };

export default function Page() {
  return <ItemFormScreen lens="inventory" />;
}
