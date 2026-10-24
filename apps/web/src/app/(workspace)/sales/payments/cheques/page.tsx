import { ChequesScreen } from "@/features/sales/payments/ChequesScreen";
import { PaymentsTabs } from "@/features/sales/shared/SalesTabs";

export const metadata = { title: "Cheques" };

// Sales › Bill › Payments Received › Cheques: the cheque register (Sales report Phase 2).
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <PaymentsTabs current="cheques" />
      <ChequesScreen />
    </div>
  );
}
