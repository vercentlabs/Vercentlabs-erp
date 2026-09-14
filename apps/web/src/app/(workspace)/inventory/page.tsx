import { ModuleFoundationPage } from "@/shell/module-foundation/ModuleFoundationPage";

export const metadata = { title: "Inventory" };

export default function InventoryPage() {
  return <ModuleFoundationPage moduleKey="stock" moduleLabel="Inventory" />;
}
