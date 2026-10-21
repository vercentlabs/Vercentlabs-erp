import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit company" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)crm/accounts/[accountId]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("crm/accounts/[accountId]/edit", "crm/accounts/[accountId]", await params, await searchParams);
}
