import { Suspense } from "react";

import { NewCategoryScreen } from "@/features/assets/categories/CategoryScreens";

export const metadata = { title: "New asset category" };
export default function Page() {
  return <Suspense><NewCategoryScreen /></Suspense>;
}
