import { Suspense } from "react";

import { DiscussionsScreen } from "@/features/projects/collaboration/DiscussionScreens";

export const metadata = { title: "Discussions" };

export default function Page() {
  return <Suspense><DiscussionsScreen /></Suspense>;
}
