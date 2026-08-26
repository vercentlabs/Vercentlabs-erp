import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getCrmContact } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import ContactDetailWorkspace from "@/modules/crm/components/contact-detail-workspace";
import { crmApiContext } from "@/modules/crm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contact" };

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const context = await crmApiContext(session);
  let contact: Record<string, unknown>;
  try {
    contact = await tenantTransaction(context.organizationId, (client) =>
      getCrmContact(client, context, id),
    );
  } catch {
    notFound();
  }
  return <ContactDetailWorkspace contact={JSON.parse(JSON.stringify(contact))} canManage={hasPermission(session, PERMISSIONS.partiesManage)} />;
}
