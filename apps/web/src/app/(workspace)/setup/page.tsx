import { redirect } from "next/navigation";

import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { SetupWizardScreen } from "@/features/settings/company/SetupWizardScreen";

export const metadata = { title: "Set up your company" };

export default async function SetupPage() {
  const session = await requireWorkspace();
  if (!hasSessionPermission(session, "organization.manage")) redirect("/");
  return <SetupWizardScreen />;
}
