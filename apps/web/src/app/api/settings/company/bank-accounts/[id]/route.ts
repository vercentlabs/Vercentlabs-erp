import { removeCompanyBankAccount } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.organizationManage, action: "organization.bank_account.remove" }, async ({ client, session }) =>
    ok({ bankAccounts: await removeCompanyBankAccount(client, session, id) }));
}
