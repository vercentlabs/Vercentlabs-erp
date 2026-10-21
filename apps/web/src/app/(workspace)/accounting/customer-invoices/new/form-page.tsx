import { DirectDocumentFormScreen } from "@/features/accounting/shared/screens/DirectDocumentFormScreen";

export const metadata = { title: "New invoice" };

export default function NewInvoicePage() {
  return <DirectDocumentFormScreen kind="invoice" />;
}
