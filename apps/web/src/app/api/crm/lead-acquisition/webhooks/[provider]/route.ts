import { POST as handlePOST } from "@/modules/crm/prospect-and-relationship-master-data/route-handlers/lead-acquisition-webhook";

export async function POST(...args: Parameters<typeof handlePOST>) {
  return handlePOST(...args);
}
