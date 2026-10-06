import { CustomerRefundsScreen } from "@/features/accounting/refunds/screens/CustomerRefundsScreen";

export const metadata = { title: "Refunds" };

// Sales → Refunds: the customer refunds Finance owns, the same records as Finance → Customer Refunds.
export default function Page() {
  return <CustomerRefundsScreen basePath="/sales/refunds" />;
}
