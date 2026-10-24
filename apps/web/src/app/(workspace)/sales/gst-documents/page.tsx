import { GstDocumentsScreen } from "@/features/accounting/gst/GstScreens";
import { EDocumentsTabs } from "@/features/sales/shared/SalesTabs";

export const metadata = { title: "E-invoices and E-way Bills" };

// Sales › Deliver › E-invoices & E-way Bills › To do: what still needs an IRN or an e-way bill, and what expires.
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <EDocumentsTabs current="todo" />
      <GstDocumentsScreen />
    </div>
  );
}
