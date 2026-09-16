import fs from "node:fs";
import path from "node:path";

function loadEnvE2E(): Record<string, string> {
  const filePath = path.resolve(process.cwd(), ".env.e2e.local");
  const raw = fs.readFileSync(filePath, "utf8");
  const entries = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx), line.slice(idx + 1)] as const;
    });
  return Object.fromEntries(entries);
}

const env = loadEnvE2E();

export const fixtures = {
  ownerEmail: env.ERP_E2E_EMAIL,
  ownerPassword: env.ERP_E2E_PASSWORD,
  restrictedEmail: env.ERP_E2E_RESTRICTED_EMAIL,
  restrictedPassword: env.ERP_E2E_RESTRICTED_PASSWORD,
  leadId: env.ERP_E2E_LEAD_ID,
  opportunityId: env.ERP_E2E_OPPORTUNITY_ID,
  accountId: env.ERP_E2E_ACCOUNT_ID,
  contactId: env.ERP_E2E_CONTACT_ID,
};
