import { FormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "Edit agreement" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FormPage name="agreements" id={id} />;
}
