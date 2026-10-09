import { Suspense } from "react";

import { QualityHoldsScreen } from "@/features/quality-holds/screens/QualityHoldsScreen";

export const metadata = { title: "Quality Holds" };

export default function Page() {
  return (
    <Suspense>
      <QualityHoldsScreen />
    </Suspense>
  );
}
