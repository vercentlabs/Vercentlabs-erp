import { Suspense } from "react";

import { CategoryDirectoryScreen } from "@/features/assets/categories/CategoryScreens";

export const metadata = { title: "Asset categories" };
export default function Page() {
  return <Suspense><CategoryDirectoryScreen /></Suspense>;
}
