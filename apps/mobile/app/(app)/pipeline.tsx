import { CrmListScreen } from "@/ui/crm-list-screen";

export default function PipelineScreen() {
  return <CrmListScreen resource="opportunities" eyebrow="Revenue" title="Pipeline" titleKeys={["name", "code"]} subtitleKeys={["partyName", "expectedCloseDate", "code"]} icon="trending-up-outline" />;
}
