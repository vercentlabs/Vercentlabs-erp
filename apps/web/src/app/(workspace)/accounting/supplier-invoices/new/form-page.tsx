import { DirectDocumentFormScreen } from "@/features/accounting/shared/screens/DirectDocumentFormScreen";

export const metadata = { title: "New bill" };

export default function NewBillPage() {
  return <DirectDocumentFormScreen kind="bill" />;
}
