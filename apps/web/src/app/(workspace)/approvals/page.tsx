import { requireWorkspace } from "@/core/session";
import { ApprovalsScreen } from "@/features/platform/approvals/ApprovalsScreen";

export const metadata = { title: "Approvals" };

// Everyone has an inbox (own requests, requests assigned to them); the server
// decides what each person may see and do.
export default async function ApprovalsPage() {
  await requireWorkspace();
  return <ApprovalsScreen />;
}
