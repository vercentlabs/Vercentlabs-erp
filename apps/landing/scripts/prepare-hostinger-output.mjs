import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const nextDirectory = path.join(appDirectory, ".next");
const standaloneDirectory = path.join(nextDirectory, "standalone");
const serverDirectory = path.join(
  standaloneDirectory,
  "apps",
  "landing",
);

await mkdir(serverDirectory, { recursive: true });
const publicDirectory = path.join(appDirectory, "public");
try {
  await access(publicDirectory);
  await cp(publicDirectory, path.join(serverDirectory, "public"), {
    recursive: true,
  });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await mkdir(path.join(serverDirectory, ".next"), { recursive: true });
await cp(
  path.join(nextDirectory, "static"),
  path.join(serverDirectory, ".next", "static"),
  { recursive: true },
);

console.log("Prepared standalone Next.js output for Hostinger.");
