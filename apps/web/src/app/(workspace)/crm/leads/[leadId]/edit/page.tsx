import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit lead" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)crm/leads/[leadId]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("crm/leads/[leadId]/edit", "crm/leads/[leadId]", await params, await searchParams);
}
