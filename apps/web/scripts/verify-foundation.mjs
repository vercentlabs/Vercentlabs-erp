import fs from "node:fs";
import path from "node:path";

const required = [
  "src/app/(auth)/verify-email/page.tsx",
  "src/app/api/auth/resend-verification/route.ts",
  "src/app/(app)/settings/users/page.tsx",
  "src/app/(app)/settings/roles/page.tsx",
  "src/app/(app)/audit-logs/page.tsx",
  "src/app/(app)/security/page.tsx",
  "src/app/(app)/notifications/page.tsx",
  "src/app/(app)/modules/page.tsx",
  "src/app/api/profile/route.ts",
  "src/app/api/approvals/[id]/route.ts",
  "src/app/api/modules/[key]/route.ts",
  "scripts/cleanup-auth.mjs",
  "scripts/verify-database.mjs",
  "src/lib/authorization.ts",
  "src/lib/platform.ts",
];

for (const relative of required) {
  if (!fs.existsSync(path.resolve(process.cwd(), relative))) {
    throw new Error(`Missing foundation file: ${relative}`);
  }
}

const sourceFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|mjs|md)$/.test(entry.name)) sourceFiles.push(full);
  }
}
walk(path.resolve(process.cwd(), "src"));

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, "utf8");
  if (/Phase\s*[0-9]/i.test(source)) {
    throw new Error(
      `Temporary milestone naming remains in ${path.relative(process.cwd(), file)}`,
    );
  }
}

console.log(
  `Platform foundation contract verified across ${sourceFiles.length} source files.`,
);
