import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getCrmAccount, listCrmContacts } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import ContactsWorkspace from "@/modules/crm/components/contacts-workspace";
import { crmApiContext } from "@/modules/crm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contacts" };

function string(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function CrmContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const parameters = await searchParams;
  const search = string(parameters.search).trim();
  const status = ["active", "inactive", "all"].includes(string(parameters.status))
    ? string(parameters.status)
    : "active";
  const accountId = string(parameters.accountId).trim();
  const page = Math.max(1, Number.parseInt(string(parameters.page) || "1", 10) || 1);
  const pageSize = 25;
  const context = await crmApiContext(session);

  const data = await tenantTransaction(context.organizationId, async (client) => {
    const contacts = await listCrmContacts(client, context, {
      search,
      status,
      accountId,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    let accountName = "";
    if (accountId) {
      try {
        const account = await getCrmAccount(client, context, accountId);
        accountName = String(account.displayName || "");
      } catch {
        accountName = "";
      }
    }
    return { contacts, accountName };
  });

  return (
    <ContactsWorkspace
      rows={JSON.parse(JSON.stringify(data.contacts.rows))}
      total={data.contacts.total}
      page={page}
      pageSize={pageSize}
      search={search}
      status={status}
      accountId={accountId}
      accountName={data.accountName}
      canManage={hasPermission(session, PERMISSIONS.partiesManage)}
      create={string(parameters.create) === "1"}
    />
  );
}
