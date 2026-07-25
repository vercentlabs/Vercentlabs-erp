import { handleLeadRequest } from "@/lib/lead-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = await handleLeadRequest(request, "demo");
  response.headers.set("Deprecation", "true");
  response.headers.set("Sunset", "Wed, 31 Dec 2026 23:59:59 GMT");
  response.headers.set("Link", '</api/demo>; rel="successor-version"');
  return response;
}
