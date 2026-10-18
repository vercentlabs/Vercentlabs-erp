import { requireWorkspace } from "@/core/session";
import { EmailTemplatesScreen } from "@/features/crm/email/screens/EmailTemplatesScreen";

export const metadata = { title: "Email templates" };

export default async function Page() {
  await requireWorkspace();
  return <EmailTemplatesScreen />;
}
