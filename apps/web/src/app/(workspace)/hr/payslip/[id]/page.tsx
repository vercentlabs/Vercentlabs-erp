import { PayslipScreen } from "@/features/hr/screens/PayrollScreens";

export const metadata = { title: "Payslip" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PayslipScreen id={id} />;
}
