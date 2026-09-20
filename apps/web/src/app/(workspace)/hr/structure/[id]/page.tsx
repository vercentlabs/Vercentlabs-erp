import { StructureBuilderScreen, StructureDetailScreen } from "@/features/hr/screens/PayrollScreens";

export const metadata = { title: "Salary structure" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return id === "new" ? <StructureBuilderScreen /> : <StructureDetailScreen id={id} />;
}
