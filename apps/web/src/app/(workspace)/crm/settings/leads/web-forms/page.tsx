import { requireWorkspace } from "@/core/session";
import { WebFormsScreen } from "@/features/crm/capture-forms/screens/WebFormsScreen";

export const metadata = { title: "Web forms" };

export default async function Page() {
  await requireWorkspace();
  return <WebFormsScreen />;
}
