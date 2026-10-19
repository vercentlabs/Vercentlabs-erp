import { saveCompanyBankAccount } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Add or change a bank account printed on invoices. Body: { id?, accountName, bankName, accountNumber, ifsc, branch?, accountType?, isDefault?, showOnDocuments? }
export async function POST(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.organizationManage, action: "organization.bank_account.save" }, async ({ client, session }) =>
    ok({ bankAccounts: await saveCompanyBankAccount(client, session, (await readJson(request)) as Record<string, unknown>) }));
}
