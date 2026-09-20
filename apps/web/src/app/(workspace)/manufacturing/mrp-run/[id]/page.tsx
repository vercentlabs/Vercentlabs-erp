import { MrpRunScreen } from "@/features/manufacturing/screens/PlanningScreens";

export const metadata = { title: "MRP run" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MrpRunScreen id={id} />;
}
