import { listPostings } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

// Automatic postings: every posting of every module, failures first.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of ["status","module","postingEvent","search","from","to","limit"]) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => ({ postings: await listPostings(client, context, filters) }));
}
