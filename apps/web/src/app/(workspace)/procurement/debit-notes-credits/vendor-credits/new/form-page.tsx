import { VendorCreditFormScreen } from "@/features/procurement/vendor-credits/screens/VendorCreditScreens";

export const metadata = { title: "Record vendor credit" };

// ?supplierBillId= a posted bill's lines; ?purchaseReturnId= a posted return's billed goods; ?claimId= an accepted debit note; ?supplierId= preselects the supplier.
export default async function Page({ searchParams }: { searchParams: Promise<{ supplierBillId?: string; purchaseReturnId?: string; claimId?: string; supplierId?: string }> }) {
  const { supplierBillId: bill, purchaseReturnId: returnId, claimId: claim, supplierId: supplier } = await searchParams;
  return <VendorCreditFormScreen billId={bill} returnId={returnId} claimId={claim} supplierId={supplier} />;
}
