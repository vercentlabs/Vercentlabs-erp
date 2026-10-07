import { ItemFormScreen } from "@/features/items/screens/ItemFormScreen";

export const metadata = { title: "New Product or Service" };

export default function Page() {
  return <ItemFormScreen lens="sales" />;
}
