import { PeriodCloseScreen } from "@/features/accounting/close/screens/PeriodCloseScreen";

export const metadata = { title: "Close the month" };

export default async function PeriodCloseMonthPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PeriodCloseScreen id={id} />;
}
