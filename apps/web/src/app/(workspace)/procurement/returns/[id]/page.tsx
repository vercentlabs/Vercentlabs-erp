import { DetailPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "Return" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetailPage name="returns" id={id} />;
}
