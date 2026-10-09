import { GoodsIssueFormScreen } from "@/features/goods-issues/screens/GoodsIssueFormScreen";

export const metadata = { title: "Edit Goods Issue" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GoodsIssueFormScreen issueId={id} />;
}
