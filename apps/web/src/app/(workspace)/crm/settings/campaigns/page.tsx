import { requireWorkspace } from "@/core/session";
import { CampaignsScreen } from "@/features/crm/campaigns/screens/CampaignsScreen";

export const metadata = { title: "Campaigns" };

export default async function Page() {
  await requireWorkspace();
  return <CampaignsScreen />;
}
