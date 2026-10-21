import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New permission profile" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)pos/settings/cashier-permissions/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("pos/settings/cashier-permissions/new", "pos/settings/cashier-permissions", await params, await searchParams);
}
