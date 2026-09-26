// Node.js-only startup validation, loaded by instrumentation.ts under
// NEXT_RUNTIME === "nodejs" (kept out of the file Next also analyses for the
// Edge runtime). Mounted secret files (NAME_FILE) are loaded first; every
// configuration problem is listed at once.
//
// Next.js reports an exception thrown from register() as an unhandled
// rejection and keeps serving, so production exits explicitly: a
// misconfigured pod must crash (visible as a crash loop), never run
// half-configured.
import { loadSecretFiles, validateRuntimeEnvironment } from "@vercentlabs/config";

export function validateStartupConfiguration() {
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
