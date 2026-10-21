import { requireWorkspace } from "@/core/session";
import { GstLookupScreen } from "@/features/crm/settings/screens/GstLookupScreen";

export const metadata = { title: "GST register lookup" };

export default async function Page() {
  await requireWorkspace();
  return <GstLookupScreen />;
}
