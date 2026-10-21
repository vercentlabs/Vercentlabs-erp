import { listRateContracts, saveRateContract } from "@vercentlabs/api";

import { rateContractSchema } from "@/features/sales/rate-contracts/rate-contract-schema";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// Rate contracts (Sales audit): ?status=&partyId=; POST makes a draft.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return salesRead(request, "sales.order.view", async (client, context) =>
    listRateContracts(client, context, { status: url.searchParams.get("status") ?? undefined, partyId: url.searchParams.get("partyId") ?? undefined }));
}

export async function POST(request: Request) {
  return salesMutation(request, "sales.price_lists.manage_prices", rateContractSchema, async (client, context, input) => ({ contract: await saveRateContract(client, context, input) }));
}
