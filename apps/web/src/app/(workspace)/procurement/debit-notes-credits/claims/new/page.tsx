import { ClaimFormScreen } from "@/features/procurement/vendor-credits/screens/ClaimScreens";

export const metadata = { title: "Issue debit note to supplier" };

// ?supplierBillId= starts from a posted bill's lines; ?supplierId= preselects the supplier.
export default async function Page({ searchParams }: { searchParams: Promise<{ supplierBillId?: string; supplierId?: string }> }) {
  const { supplierBillId: bill, supplierId: supplier } = await searchParams;
  return <ClaimFormScreen billId={bill} supplierId={supplier} />;
}
