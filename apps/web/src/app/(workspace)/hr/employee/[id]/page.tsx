import { EmployeeDetailScreen } from "@/features/hr/screens/WorkforceScreens";

export const metadata = { title: "Employee" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmployeeDetailScreen id={id} />;
}
