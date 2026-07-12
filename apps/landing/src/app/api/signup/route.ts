import { handleLeadRequest } from "@/lib/lead-handler";

export const runtime = "nodejs";

export function POST(request: Request) {
  return handleLeadRequest(request, "signup");
}
