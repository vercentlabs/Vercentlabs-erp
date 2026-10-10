import { ProfileFormScreen } from "@/features/pos/permission-profiles/screens/ProfileFormScreen";

export const metadata = { title: "Edit permission profile" };

export default async function Page({ params }: { params: Promise<{ profileId: string }> }) {
  const { profileId } = await params;
  return <ProfileFormScreen profileId={profileId} />;
}
