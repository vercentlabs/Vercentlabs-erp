import { requireWorkspace } from "@/core/session";
import { ProfileScreen } from "@/features/settings/company/ProfileScreen";

export const metadata = { title: "Your profile" };

export default async function ProfilePage() {
  await requireWorkspace();
  return <ProfileScreen />;
}
