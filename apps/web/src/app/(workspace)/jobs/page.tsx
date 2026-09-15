import { requireWorkspace } from "@/core/session";
import { JobsClient } from "./jobs-client";

export const metadata = { title: "Background Jobs" };

export default async function JobsPage() {
  await requireWorkspace();
  return <JobsClient />;
}
