import { SupplierRateFormScreen } from "@/features/procurement/supplier-rates/SupplierRateScreens";

export const metadata = { title: "Edit supplier rate" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierRateFormScreen rateId={id} />;
}
