import { SalesPerformanceScreen } from "@/features/sales/reports/screens/SalesPerformanceScreen";

export const metadata = { title: "Salespeople and targets" };

// Sales › Masters › Salespeople & Targets (Sales plan): each salesperson's monthly target and what they achieved, with teams and commission
// a click away.
export default function Page() {
  return <SalesPerformanceScreen />;
}
