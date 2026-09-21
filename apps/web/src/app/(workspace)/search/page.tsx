import { Suspense } from "react";

import { GlobalSearchScreen } from "@/features/platform/search/GlobalSearchScreen";

export const metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <GlobalSearchScreen />
    </Suspense>
  );
}
