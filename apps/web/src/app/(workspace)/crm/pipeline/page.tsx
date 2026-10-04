import { requireWorkspace } from "@/core/session";
import { PipelineScreen } from "@/features/crm/opportunity-pipeline/screens/PipelineScreen";

export const metadata = { title: "Pipeline" };

// The opportunity pipeline: the board by sales stage (default) and the same
// deals as a list (?layout=list). ?preset=mine opens My Pipeline.
export default async function Page() {
  await requireWorkspace();
  return <PipelineScreen />;
}
