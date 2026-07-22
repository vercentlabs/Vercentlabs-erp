import { CrmListScreen } from "@/shared/components/crm-list-screen";
import { CreateRecordSheet } from "@/modules/crm/components/create-record-sheet";

export default function PipelineScreen() {
  return <CrmListScreen resource="opportunities" eyebrow="Revenue" title="Pipeline" titleKeys={["name", "code"]} subtitleKeys={["partyName", "expectedCloseDate", "code"]} icon="trending-up-outline" headerAction={<CreateRecordSheet resource="opportunities" />} />;
}
