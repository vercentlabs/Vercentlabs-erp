import { DetailPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "Goods receipt" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DetailPage name="receipts" id={id} />;
}
