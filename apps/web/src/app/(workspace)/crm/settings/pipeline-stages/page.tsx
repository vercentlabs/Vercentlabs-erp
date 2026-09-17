import { requireWorkspace } from "@/core/session";
import { PipelineStagesSettingsScreen } from "@/features/crm/settings/pipeline-stages/screens/PipelineStagesSettingsScreen";

export const metadata = { title: "Pipeline Stages" };

export default async function PipelineStagesSettingsPage() {
  await requireWorkspace();
  return <PipelineStagesSettingsScreen />;
}
