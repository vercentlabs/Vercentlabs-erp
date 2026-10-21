import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit permission profile" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)pos/settings/cashier-permissions/[profileId]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("pos/settings/cashier-permissions/[profileId]/edit", "pos/settings/cashier-permissions/[profileId]", await params, await searchParams);
}
