import { POST as handlePOST } from "@/modules/crm/crm-data-operations-and-customization/route-handlers/lead-import";

export async function POST(...args: Parameters<typeof handlePOST>) {
  return handlePOST(...args);
}
