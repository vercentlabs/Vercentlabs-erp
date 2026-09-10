import { POST as handlePOST } from "@/modules/crm/prospect-and-relationship-master-data/route-handlers/lead-tags";

export async function POST(...args: Parameters<typeof handlePOST>) {
  return handlePOST(...args);
}
