import { requireWorkspace } from "@/core/session";
import { MyRemindersScreen } from "@/features/crm/settings/screens/MyRemindersScreen";

export const metadata = { title: "Reminders on WhatsApp and SMS" };

export default async function Page() {
  await requireWorkspace();
  return <MyRemindersScreen />;
}
