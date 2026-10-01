import { requireWorkspace } from "@/core/session";
import { CrmSetupScreen } from "@/features/crm/setup/hub/screens/CrmSetupScreen";

export const metadata = { title: "CRM Setup" };

export default async function CrmSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  await requireWorkspace();
  const { section } = await searchParams;
  return (
    <CrmSetupScreen section={typeof section === "string" ? section : null} />
  );
}
