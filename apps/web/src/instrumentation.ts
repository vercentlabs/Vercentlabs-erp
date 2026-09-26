// Next.js calls register() once when the server process starts, before any
// request is served. Production refuses to start with an invalid or partly
// configured environment (every problem is listed in the error); mounted
// secret files (NAME_FILE) are loaded first. Database reachability is a
// readiness concern (/api/readiness), not a startup crash: the Cloud SQL
// proxy sidecar may still be starting.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadSecretFiles, validateRuntimeEnvironment } = await import("@vercentlabs/config");
  loadSecretFiles(process.env);
  validateRuntimeEnvironment("web", process.env);
}
