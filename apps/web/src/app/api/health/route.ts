import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return ok({
    service: "vercentlabs-erp-web",
    status: "alive",
    release:
      process.env.VERCENTLABS_RELEASE_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      null,
    runtime: `node-${process.versions.node.split(".")[0]}`,
    timestamp: new Date().toISOString(),
  });
}
