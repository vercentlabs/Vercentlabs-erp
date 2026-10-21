import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit store / outlet" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)pos/outlets/[outletId]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("pos/outlets/[outletId]/edit", "pos/outlets/[outletId]", await params, await searchParams);
}
