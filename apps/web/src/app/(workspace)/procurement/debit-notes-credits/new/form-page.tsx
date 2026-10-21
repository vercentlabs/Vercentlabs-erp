import { NewDebitNoteOrCreditScreen } from "@/features/procurement/vendor-credits/screens/DebitNotesCreditsScreens";

export const metadata = { title: "New debit note or vendor credit" };

// ?supplierBillId= / ?purchaseReturnId= / ?supplierId= carry the source into the chosen form.
export default async function Page({ searchParams }: { searchParams: Promise<{ supplierBillId?: string; purchaseReturnId?: string; supplierId?: string }> }) {
  const { supplierBillId: bill, purchaseReturnId: returnId, supplierId: supplier } = await searchParams;
  return <NewDebitNoteOrCreditScreen billId={bill} returnId={returnId} supplierId={supplier} />;
}
