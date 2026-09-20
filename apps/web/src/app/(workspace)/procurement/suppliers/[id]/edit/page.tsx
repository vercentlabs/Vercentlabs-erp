import { FormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "Edit supplier" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FormPage name="suppliers" id={id} />;
}
