import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";
export function GET() {
  return ok({
    service: "vercent-erp-web",
    status: "operational",
    timestamp: new Date().toISOString(),
  });
}
