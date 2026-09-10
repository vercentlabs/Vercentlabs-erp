import { POST as handlePOST } from "@/modules/crm/prospect-and-relationship-master-data/route-handlers/public-lead-chat";

export async function POST(...args: Parameters<typeof handlePOST>) {
  return handlePOST(...args);
}
