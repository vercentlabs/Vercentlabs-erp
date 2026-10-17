import { Suspense } from "react";

import { CategoryReportsScreen } from "@/features/assets/categories/CategoryScreens";

export const metadata = { title: "Category reports" };
export default function Page() {
  return <Suspense><CategoryReportsScreen /></Suspense>;
}
