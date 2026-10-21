import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "New quality hold" };

// Opened as an address of its own, this form opens over its list instead (see @modal/(.)inventory/quality-holds/new).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("inventory/quality-holds/new", "inventory/quality-holds", await params, await searchParams);
}
