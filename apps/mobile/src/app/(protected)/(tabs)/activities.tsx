import { useAuth } from "@/core/auth/auth-provider";
import { CreateRecordSheet } from "@/modules/crm/components/create-record-sheet";
import { CrmListScreen } from "@/shared/components/crm-list-screen";

export default function ActivitiesScreen() {
  const auth = useAuth();
  const canManage = Boolean(
    auth.session?.access.permissions.includes("crm.activities.manage"),
  );
  return (
    <CrmListScreen
      resource="activities"
      eyebrow="Daily focus"
      title="Activities"
      titleKeys={["subject", "title", "activityType"]}
      subtitleKeys={["dueAt", "description", "activityType"]}
      icon="checkmark-circle-outline"
      canManage={canManage}
      headerAction={
        canManage ? <CreateRecordSheet resource="activities" /> : undefined
      }
    />
  );
}
