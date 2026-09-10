import { GET as handleGET } from "@/modules/crm/seller-activity-and-follow-up-workspace/route-handlers/public-meeting-availability";

export async function GET(...args: Parameters<typeof handleGET>) {
  return handleGET(...args);
}
