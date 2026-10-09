import { ReorderRuleScreen } from "@/features/replenishment/screens/ReorderRuleScreen";

export const metadata = { title: "Reorder Rule" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReorderRuleScreen ruleId={id} />;
}
