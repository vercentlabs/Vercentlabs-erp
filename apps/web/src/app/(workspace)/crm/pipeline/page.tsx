import { requireWorkspace } from "@/core/session";
import { PipelineBoardScreen } from "@/features/crm/pipeline/screens/PipelineBoardScreen";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  await requireWorkspace();
  return <PipelineBoardScreen />;
}
