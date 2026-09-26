import { checkReadiness } from "@vercentlabs/api";
import { createLogger } from "@vercentlabs/observability";

import { runtimeQueryable } from "@/core/db";

// Readiness (Kubernetes readiness/startup probes): bounded checks of the
// configuration, restricted database role, migration level and object
// storage (see core/platform/health). Public and unauthenticated, so the body
// names failed checks only; details go to the structured log.
export const dynamic = "force-dynamic";

const logger = createLogger("web-readiness");

export async function GET() {
  const result = await checkReadiness({ queryable: runtimeQueryable });
  if (!result.ready) logger.event("readiness.failed", { failures: result.failures }, "warn");
  return Response.json({ status: result.ready ? "ok" : "unavailable", checks: result.checks }, { status: result.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
