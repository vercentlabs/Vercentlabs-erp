import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit deal" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)crm/opportunities/[opportunityId]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("crm/opportunities/[opportunityId]/edit", "crm/opportunities/[opportunityId]", await params, await searchParams);
}
