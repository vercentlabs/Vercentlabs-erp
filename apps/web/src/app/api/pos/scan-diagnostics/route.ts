import { listScanDiagnostics } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

// ?result= — failed and slow scans, newest first (POS administrators and report viewers).
export async function GET(request: Request) {
  const result = new URL(request.url).searchParams.get("result");
  return posRead(request, async (client, context) => ({ events: await listScanDiagnostics(client, context, { result: result || null }) }), "pos.view");
}
