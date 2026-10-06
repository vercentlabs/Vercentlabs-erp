import { FormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "New purchase order" };

// ?supplierId= (Supplier -> Create Purchase Order) starts the order for that supplier: its currency, payment terms, contact and
// ordering address are resolved by the server when the order is saved.
export default async function Page({ searchParams }: { searchParams: Promise<{ supplierId?: string | string[] }> }) {
  const { supplierId } = await searchParams;
  return <FormPage name="orders" initial={typeof supplierId === "string" ? { supplierId } : undefined} />;
}
