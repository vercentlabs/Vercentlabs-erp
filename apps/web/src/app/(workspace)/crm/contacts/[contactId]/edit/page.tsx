import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit contact" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)crm/contacts/[contactId]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("crm/contacts/[contactId]/edit", "crm/contacts/[contactId]", await params, await searchParams);
}
