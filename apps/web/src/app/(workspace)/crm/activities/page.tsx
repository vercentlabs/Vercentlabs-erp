import { requireWorkspace } from "@/core/session";
import { ActivitiesScreen } from "@/features/crm/activities/ActivitiesScreen";
import { activityTabOf } from "@/features/crm/activities/activity-tabs";

export const metadata = { title: "To-dos" };

// CRM To-dos. ?tab=tasks | follow-ups | notes | files (the former notes-files opens Notes); each tab keeps its own filters in the query.
export default async function ActivitiesPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  await requireWorkspace();
  const { tab } = await searchParams;
  const selected = activityTabOf(tab);
  // Keyed by tab so a switch mounts that tab fresh (its own filters read from the URL once, as each list screen does).
  return <ActivitiesScreen key={selected} tab={selected} />;
}
