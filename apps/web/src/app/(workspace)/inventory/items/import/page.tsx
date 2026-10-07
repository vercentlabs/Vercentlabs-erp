import { ItemImportScreen } from "@/features/items/screens/ItemImportScreen";

export const metadata = { title: "Import Items" };

export default function Page() {
  return <ItemImportScreen lens="inventory" />;
}
