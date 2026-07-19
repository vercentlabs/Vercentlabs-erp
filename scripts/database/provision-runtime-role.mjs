import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "corepack.cmd" : "corepack";
const result = spawnSync(
  command,
  [
    "pnpm",
    "--filter",
    "@vercent/web",
    "exec",
    "node",
    "scripts/provision-runtime-role.mjs",
  ],
  { stdio: "inherit", env: process.env },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
