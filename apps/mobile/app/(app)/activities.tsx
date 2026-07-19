import { CrmListScreen } from "@/ui/crm-list-screen";

export default function ActivitiesScreen() {
  return <CrmListScreen resource="activities" eyebrow="Daily focus" title="Activities" titleKeys={["subject", "title", "activityType"]} subtitleKeys={["dueAt", "description", "activityType"]} icon="checkmark-circle-outline" />;
}
