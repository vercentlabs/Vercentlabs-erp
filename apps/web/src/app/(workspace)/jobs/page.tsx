import { requireWorkspace } from "@/core/session";
import { JobsScreen } from "@/features/platform/jobs/JobsScreen";

export const metadata = { title: "Background tasks" };

export default async function JobsPage() {
  await requireWorkspace();
  return <JobsScreen />;
}
