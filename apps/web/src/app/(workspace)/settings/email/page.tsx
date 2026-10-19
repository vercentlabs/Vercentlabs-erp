import { redirect } from "next/navigation";

import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { EmailSettingsScreen } from "@/features/settings/email/EmailSettingsScreen";

export const metadata = { title: "Email" };

export default async function EmailSettingsPage() {
  const session = await requireWorkspace();
  if (!hasSessionPermission(session, "organization.manage")) redirect("/settings");
  return <EmailSettingsScreen />;
}
