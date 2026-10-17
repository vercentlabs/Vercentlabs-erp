import { Suspense } from "react";

import { PortfolioProgressScreen } from "@/features/projects/progress/ProgressViews";

export const metadata = { title: "Portfolio Progress" };

export default function Page() {
  return <Suspense><PortfolioProgressScreen /></Suspense>;
}
