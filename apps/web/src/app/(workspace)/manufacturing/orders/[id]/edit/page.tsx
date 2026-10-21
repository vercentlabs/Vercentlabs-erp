import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit manufacturing order" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)manufacturing/orders/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("manufacturing/orders/[id]/edit", "manufacturing/orders/[id]", await params, await searchParams);
}
