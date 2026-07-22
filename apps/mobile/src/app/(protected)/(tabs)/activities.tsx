import { CrmListScreen } from "@/shared/components/crm-list-screen";
import { CreateRecordSheet } from "@/modules/crm/components/create-record-sheet";

export default function ActivitiesScreen() {
  return <CrmListScreen resource="activities" eyebrow="Daily focus" title="Activities" titleKeys={["subject", "title", "activityType"]} subtitleKeys={["dueAt", "description", "activityType"]} icon="checkmark-circle-outline" headerAction={<CreateRecordSheet resource="activities" />} />;
}
