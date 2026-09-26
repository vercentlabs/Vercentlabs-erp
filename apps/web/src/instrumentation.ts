// Next.js calls register() once when the server process starts, before any
// request is served. Configuration is validated in the Node.js runtime
// (core/startup.ts); database reachability is a readiness concern
// (/api/readiness), not a startup crash: the Cloud SQL proxy sidecar may
// still be starting.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateStartupConfiguration } = await import("./core/startup");
  validateStartupConfiguration();
}
