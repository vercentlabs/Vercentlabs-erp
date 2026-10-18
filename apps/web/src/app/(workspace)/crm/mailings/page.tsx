import { requireWorkspace } from "@/core/session";
import { MailingsScreen } from "@/features/crm/mailings/MailingsScreen";

export const metadata = { title: "Campaign emails" };

export default async function Page() {
  await requireWorkspace();
  return <MailingsScreen />;
}
