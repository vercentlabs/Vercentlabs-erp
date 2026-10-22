import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Payment received" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)sales/payments/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("sales/payments/new", "sales/payments", await params, await searchParams);
}
