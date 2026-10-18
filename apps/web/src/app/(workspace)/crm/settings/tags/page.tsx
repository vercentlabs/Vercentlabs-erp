import { requireWorkspace } from "@/core/session";
import { TagsScreen } from "@/features/crm/tags/screens/TagsScreen";

export const metadata = { title: "Tags" };

export default async function Page() {
  await requireWorkspace();
  return <TagsScreen />;
}
