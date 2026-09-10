import { GET as handleGET, POST as handlePOST } from "@/modules/crm/prospect-and-relationship-master-data/route-handlers/lead-saved-views";

export async function GET(...args: Parameters<typeof handleGET>) {
  return handleGET(...args);
}

export async function POST(...args: Parameters<typeof handlePOST>) {
  return handlePOST(...args);
}
