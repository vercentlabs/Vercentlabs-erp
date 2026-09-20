import { FormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "Edit goods receipt" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FormPage name="receipts" id={id} />;
}
