import { ProfileDetailScreen } from "@/features/pos/permission-profiles/screens/ProfileDetailScreen";

export const metadata = { title: "Permission profile" };

export default async function Page({ params, searchParams }: { params: Promise<{ profileId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { profileId } = await params;
  const { tab } = await searchParams;
  return <ProfileDetailScreen profileId={profileId} initialTab={tab ?? null} />;
}
