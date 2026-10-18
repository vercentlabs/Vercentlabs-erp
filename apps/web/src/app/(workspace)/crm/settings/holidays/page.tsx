import { requireWorkspace } from "@/core/session";
import { HolidaysScreen } from "@/features/crm/settings/screens/HolidaysScreen";

export const metadata = { title: "Holidays" };

export default async function Page() {
  await requireWorkspace();
  return <HolidaysScreen />;
}
