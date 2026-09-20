import { FormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "Amend purchase order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FormPage name="orders" id={id} amend />;
}
