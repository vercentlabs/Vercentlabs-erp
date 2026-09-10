import { POST as handlePOST } from "@/modules/crm/seller-activity-and-follow-up-workspace/route-handlers/public-meeting-bookings";

export async function POST(...args: Parameters<typeof handlePOST>) {
  return handlePOST(...args);
}
