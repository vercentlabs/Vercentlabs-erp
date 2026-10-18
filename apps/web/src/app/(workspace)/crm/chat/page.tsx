import { Suspense } from "react";
import { requireWorkspace } from "@/core/session";
import { ChatInboxScreen } from "@/features/crm/chat/ChatInboxScreen";

export const metadata = { title: "Website chat" };

export default async function Page() {
  await requireWorkspace();
  return <Suspense fallback={null}><ChatInboxScreen /></Suspense>;
}
