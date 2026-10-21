import { GstDocumentsScreen } from "@/features/accounting/gst/GstScreens";

export const metadata = { title: "E-invoices and E-way Bills" };

// Sales › Bill & collect › E-invoices and E-way Bills: what is due and what expires, from Sales too (Sales audit M8).
export default function Page() {
  return <GstDocumentsScreen />;
}
