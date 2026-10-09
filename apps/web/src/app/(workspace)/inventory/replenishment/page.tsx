import { Suspense } from "react";

import { ReplenishmentScreen } from "@/features/replenishment/screens/ReplenishmentScreen";

export const metadata = { title: "Replenishment" };

export default function Page() {
  return (
    <Suspense>
      <ReplenishmentScreen />
    </Suspense>
  );
}
