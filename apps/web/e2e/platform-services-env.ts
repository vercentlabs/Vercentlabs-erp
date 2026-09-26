import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The spec calls platform services in-process (worker functions, report
// runs), so it needs the same environment as the web server: load the repo
// .env when present without overriding anything already set (CI sets its own).
// Playwright runs from apps/web.
const repoEnv = path.resolve(process.cwd(), "../../.env");
if (fs.existsSync(repoEnv)) process.loadEnvFile(repoEnv);

// Shared between the Playwright web server and the spec process, so files the
// spec writes (report output) are readable by the server and vice versa.
export const FILE_STORAGE_LOCAL_ROOT = path.join(os.tmpdir(), "vercentlabs-platform-e2e-storage");
export const OAUTH_STANDIN_PORT = 3197;
export const OAUTH_CLIENTS = {
  GOOGLE_OAUTH_CLIENT_ID: "e2e-google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "e2e-google-secret",
  MICROSOFT_OAUTH_CLIENT_ID: "e2e-microsoft-client",
  MICROSOFT_OAUTH_CLIENT_SECRET: "e2e-microsoft-secret",
};
