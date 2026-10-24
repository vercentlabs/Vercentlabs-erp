import { SalesPaymentsScreen } from "@/features/sales/invoices/screens/SalesPaymentsScreen";
import { PaymentsTabs } from "@/features/sales/shared/SalesTabs";

export const metadata = { title: "Payments received" };

export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <PaymentsTabs current="payments" />
      <SalesPaymentsScreen />
    </div>
  );
}
