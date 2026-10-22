import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New rate contract" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)procurement/rate-contracts/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("procurement/rate-contracts/new", "procurement/rate-contracts", await params, await searchParams);
}
