import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New manufacturing order" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)manufacturing/orders/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("manufacturing/orders/new", "manufacturing/orders", await params, await searchParams);
}
