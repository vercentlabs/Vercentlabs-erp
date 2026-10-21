import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New contact" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)crm/contacts/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("crm/contacts/new", "crm/contacts", await params, await searchParams);
}
