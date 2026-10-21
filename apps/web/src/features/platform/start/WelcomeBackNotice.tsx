"use client";

// The "Welcome back" line on the first app screen when signup found the person already has a workspace (/start adds ?welcome=back).
import { useSearchParams } from "next/navigation";

import { Notice } from "@/shared/ui/Panel";

export function WelcomeBackNotice() {
  const params = useSearchParams();
  if (params.get("welcome") !== "back") return null;
  return <div className="mb-4"><Notice tone="info">Welcome back, you already have a workspace.</Notice></div>;
}
