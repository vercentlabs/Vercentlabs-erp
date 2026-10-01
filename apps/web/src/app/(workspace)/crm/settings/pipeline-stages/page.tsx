import { requireWorkspace } from "@/core/session";
import { PipelineStagesSettingsScreen } from "@/features/crm/setup/pipeline-stages/screens/PipelineStagesSettingsScreen";

export const metadata = { title: "Pipeline Stages" };

export default async function PipelineStagesSettingsPage() {
  await requireWorkspace();
  return <PipelineStagesSettingsScreen />;
}
