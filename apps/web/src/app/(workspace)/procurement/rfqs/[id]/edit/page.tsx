import { FormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "Edit RFQ" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FormPage name="rfqs" id={id} />;
}
