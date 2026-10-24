import { SupplierRateFormScreen } from "@/features/procurement/supplier-rates/SupplierRateScreens";

export const metadata = { title: "New supplier rate" };

// A supplier's price for an item; ?supplierId= when opened from the supplier's page.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { supplierId } = await searchParams;
  return <SupplierRateFormScreen supplierId={typeof supplierId === "string" ? supplierId : undefined} />;
}
