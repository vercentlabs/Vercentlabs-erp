// Next.js calls register() once when the server process starts, before any
// request is served. Production refuses to start with an invalid or partly
// configured environment (every problem is listed in the error); mounted
// secret files (NAME_FILE) are loaded first. Database reachability is a
// readiness concern (/api/readiness), not a startup crash: the Cloud SQL
// proxy sidecar may still be starting.
//
// Next.js reports an exception thrown here as an unhandled rejection and
// keeps serving, so production exits explicitly: a misconfigured pod must
// crash (and be visible as a crash loop), never run half-configured.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadSecretFiles, validateRuntimeEnvironment } = await import("@vercentlabs/config");
  try {
    loadSecretFiles(process.env);
    validateRuntimeEnvironment("web", process.env);
  } catch (error) {
    const issues = (error as { issues?: string[] }).issues ?? [String((error as Error)?.message ?? error)];
    console.error(JSON.stringify({ severity: "CRITICAL", service: "web", event: "startup.configuration_invalid", message: "Invalid runtime configuration", issues }));
    if (process.env.NODE_ENV === "production") process.exit(1);
    throw error;
  }
}
