import { POST as handlePOST } from "@/modules/crm/prospect-and-relationship-master-data/route-handlers/public-lead-capture";

export async function POST(...args: Parameters<typeof handlePOST>) {
  return handlePOST(...args);
}
