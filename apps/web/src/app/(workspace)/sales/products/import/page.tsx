import { ItemImportScreen } from "@/features/items/screens/ItemImportScreen";

export const metadata = { title: "Import Products" };

export default function Page() {
  return <ItemImportScreen lens="sales" />;
}
