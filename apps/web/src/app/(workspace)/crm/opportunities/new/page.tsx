import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New deal" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)crm/opportunities/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("crm/opportunities/new", "crm/opportunities", await params, await searchParams);
}
