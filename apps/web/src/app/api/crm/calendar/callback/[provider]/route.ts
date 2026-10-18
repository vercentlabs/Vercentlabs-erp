import { completeCalendarConnection, readCalendarState } from "@vercentlabs/api/crm";

import { tenantTransaction } from "@/core/db";
import { requireApiWorkspace } from "@/core/session";

// The provider sends the browser back here after the person allowed access. The encrypted state says who started it; it must be the
// person signed in now. Then back to My calendar, with the outcome in the address.
export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const url = new URL(request.url);
  const back = (outcome: string) => Response.redirect(new URL(`/crm/settings/calendar?calendar=${encodeURIComponent(outcome)}`, url.origin), 303);
  try {
    if (url.searchParams.get("error")) return back("refused");
    const session = await requireApiWorkspace();
    const payload = await readCalendarState(url.searchParams.get("state") ?? "");
    if (payload.provider !== provider || payload.userId !== session.userId || payload.organizationId !== session.organizationId) return back("mismatch");
    await tenantTransaction(payload.organizationId, (client) => completeCalendarConnection(client, payload, url.searchParams.get("code") ?? ""));
    return back("connected");
  } catch {
    return back("failed");
  }
}
