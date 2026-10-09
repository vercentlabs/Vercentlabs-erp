import { Suspense } from "react";

import { ReservationsScreen } from "@/features/reservations/screens/ReservationsScreen";

export const metadata = { title: "Stock Reservations" };

export default function Page() {
  return (
    <Suspense>
      <ReservationsScreen />
    </Suspense>
  );
}
