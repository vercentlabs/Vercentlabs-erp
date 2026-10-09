import { PaymentTermsScreen } from "@/features/settings/finance-commercial/payment-terms/screens/PaymentTermsScreen";

export const metadata = { title: "Payment terms" };

// The company's one list of payment terms (Settings › Finance & Commercial › Payment Terms), opened from this module's Configuration.
export default function Page() {
  return <PaymentTermsScreen />;
}
