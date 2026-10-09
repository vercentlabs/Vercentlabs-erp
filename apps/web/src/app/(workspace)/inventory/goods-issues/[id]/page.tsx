import { GoodsIssueDetailScreen } from "@/features/goods-issues/screens/GoodsIssueDetailScreen";

export const metadata = { title: "Goods Issue" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GoodsIssueDetailScreen issueId={id} />;
}
