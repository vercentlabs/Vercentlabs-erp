import { ModuleFoundationPage } from "@/shell/module-foundation/ModuleFoundationPage";

export const metadata = { title: "Point of Sale" };

export default function PosPage() {
  return (
    <ModuleFoundationPage
      moduleKey="point-of-sale"
      moduleLabel="Point of Sale"
    />
  );
}
