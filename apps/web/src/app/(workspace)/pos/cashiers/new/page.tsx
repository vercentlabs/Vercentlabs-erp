import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New cashier" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)pos/cashiers/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("pos/cashiers/new", "pos/cashiers", await params, await searchParams);
}
