import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return ok({
    service: "vercent-erp-web",
    status: "alive",
    timestamp: new Date().toISOString(),
  });
}
