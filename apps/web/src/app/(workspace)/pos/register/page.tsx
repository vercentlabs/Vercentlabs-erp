import { Suspense } from "react";

import { PosCheckoutScreen } from "@/features/pos/checkout/screens/PosCheckoutScreen";

export const metadata = { title: "Register" };

// POS › Register: search or scan, the cart, the customer, checkout (cash, card, UPI, split) and the receipt. ?resume=<cart> opens a held bill.
export default function PosRegisterPage() {
  return <Suspense><PosCheckoutScreen /></Suspense>;
}
