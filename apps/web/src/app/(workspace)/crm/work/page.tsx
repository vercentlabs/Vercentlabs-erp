import { requireWorkspace } from "@/core/session";
import { MyWorkScreen } from "@/features/crm/work/screens/MyWorkScreen";
import { isMyWorkView } from "@/features/crm/work/my-work-views";

export const metadata = { title: "My Work" };

export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  await requireWorkspace();
  const { view } = await searchParams;
  // Keyed by view so a switch mounts that view fresh (its own filters read
  // from the URL once, as each list screen does).
  const selected = isMyWorkView(view) ? view : "today";
  return <MyWorkScreen key={selected} view={selected} />;
}
