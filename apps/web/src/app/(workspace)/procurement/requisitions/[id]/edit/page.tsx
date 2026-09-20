import { FormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "Edit requisition" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FormPage name="requisitions" id={id} />;
}
