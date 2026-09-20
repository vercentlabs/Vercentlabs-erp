import { PayrollRunScreen } from "@/features/hr/screens/PayrollScreens";

export const metadata = { title: "Payroll" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PayrollRunScreen id={id} />;
}
