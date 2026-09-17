import { PATCH as handlePATCH } from "@/modules/crm/seller-activity-and-follow-up-workspace/route-handlers/public-meeting-booking-management";

export async function PATCH(...args: Parameters<typeof handlePATCH>) {
  return handlePATCH(...args);
}
