import { getCompanyAssetMovements } from "@vercentlabs/api";

import { assetsRead } from "@/features/assets/shared/route-helpers";

// GET the Company movement directory (?search=&eventType=&certainty=&locationId=&custodianId=&departmentId=&from=&to=&exceptions=&movementsOnly=&sort=&page=&pageSize=)
export async function GET(request: Request) {
  const url = new URL(request.url);
  return assetsRead(request, (client, context) => getCompanyAssetMovements(client, context, Object.fromEntries(url.searchParams.entries())));
}
