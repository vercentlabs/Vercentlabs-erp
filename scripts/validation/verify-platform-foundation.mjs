import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "apps/landing/package.json",
  "apps/web/package.json",
  "apps/mobile/README.md",
  "services/api/README.md",
  "packages/shared-types/README.md",
  "packages/shared-sdk/README.md",
  "packages/shared-ui/README.md",
  "packages/config/README.md",
  "packages/database/README.md",
  "packages/permissions/README.md",
  "packages/workflows/README.md",
  "packages/document-engine/README.md",
  "packages/reporting-engine/README.md",
  "packages/localization/README.md",
  "packages/observability/README.md",
  "packages/test-utils/README.md",
  "database/control-plane/migrations/001_auth_and_onboarding.sql",
  "database/control-plane/migrations/002_platform_foundation.sql",
  "database/tenant/README.md",
  "infrastructure/docker/compose.local.yml",
  "docs/architecture/platform-foundation.md",
  "PROJECT_STRUCTURE.md",
  "apps/web/src/lib/mailer.ts",
  "apps/web/scripts/verify-email-delivery.mjs",
  "apps/web/src/app/(auth)/signup/page.tsx",
  "apps/web/src/app/(auth)/login/page.tsx",
  "apps/web/src/app/(auth)/verify-email/page.tsx",
  "apps/web/src/app/(auth)/forgot-password/page.tsx",
  "apps/web/src/app/(auth)/reset-password/page.tsx",
  "apps/web/src/app/onboarding/page.tsx",
  "apps/web/src/app/(app)/dashboard/page.tsx",
  "apps/web/src/app/(app)/settings/users/page.tsx",
  "apps/web/src/app/(app)/settings/roles/page.tsx",
  "apps/web/src/app/(app)/security/page.tsx",
  "apps/web/src/app/(app)/audit-logs/page.tsx",
  "apps/web/src/app/(app)/notifications/page.tsx",
  "apps/web/src/app/(app)/approvals/page.tsx",
  "apps/web/src/app/(app)/modules/page.tsx",
  "apps/web/src/app/api/auth/signup/route.ts",
  "apps/web/src/app/api/auth/login/route.ts",
  "apps/web/src/app/api/auth/logout/route.ts",
  "apps/web/src/app/api/auth/verify-email/route.ts",
  "apps/web/src/app/api/auth/resend-verification/route.ts",
  "apps/web/src/app/api/auth/forgot-password/route.ts",
  "apps/web/src/app/api/auth/reset-password/route.ts",
  "apps/web/src/app/api/auth/change-password/route.ts",
  "apps/web/src/app/api/onboarding/route.ts",
  "apps/web/src/app/api/sessions/route.ts",
  "apps/web/src/app/api/roles/route.ts",
  "apps/web/src/app/api/invitations/route.ts",
];

const missing = required.filter((entry) => !fs.existsSync(path.join(root, entry)));
if (missing.length) {
  console.error("Missing platform paths:");
  missing.forEach((entry) => console.error(` - ${entry}`));
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const scripts = packageJson.scripts || {};
const requiredScripts = [
  "dev:landing", "dev:web", "build:landing", "build:web",
  "lint:landing", "lint:web", "typecheck:landing", "typecheck:web",
  "test:web", "infra:up", "infra:down", "infra:logs",
  "db:migrate:control", "db:verify:control", "email:verify",
  "verify:platform-foundation",
];

const missingScripts = requiredScripts.filter((name) => !scripts[name]);
if (missingScripts.length) {
  throw new Error(`Missing scripts: ${missingScripts.join(", ")}`);
}

const temporaryScripts = Object.keys(scripts).filter((name) => /phase\d+/i.test(name));
if (temporaryScripts.length) {
  throw new Error(`Temporary milestone scripts remain: ${temporaryScripts.join(", ")}`);
}

const workspace = fs.readFileSync("pnpm-workspace.yaml", "utf8");
for (const pattern of ['"apps/*"', '"services/*"', '"packages/*"']) {
  if (!workspace.includes(pattern)) throw new Error(`Workspace missing ${pattern}`);
}

const mailer = fs.readFileSync("apps/web/src/lib/mailer.ts", "utf8");
for (const marker of ["nodemailer", "SMTP_HOST", "SMTP_PASSWORD", "deliverAuthMessage"]) {
  if (!mailer.includes(marker)) throw new Error(`Mailer missing ${marker}`);
}
if (mailer.includes("RESEND_API_KEY")) throw new Error("Legacy Resend code remains.");

const platform = fs.readFileSync("apps/web/src/lib/platform.ts", "utf8");
for (const moduleKey of [
  "accounting", "procurement", "sales", "crm", "stock", "manufacturing",
  "projects", "assets", "point-of-sale", "quality", "support", "hr-payroll",
]) {
  if (!platform.includes(moduleKey)) throw new Error(`Module registry missing ${moduleKey}`);
}

console.log(
  `Platform foundation verified: ${required.length} paths, ` +
  `${requiredScripts.length} commands and 12 ERP modules.`,
);
