import { formRedirect } from "@/shell/form-modal/form-redirect";

export const metadata = { title: "Edit finished-goods receipt" };

// Opened as an address of its own, this form opens over its record instead (see @modal/(.)manufacturing/finished-goods-receipts/[id]/edit).
export default async function Page({ params, searchParams }: { params: Promise<Record<string, string | string[] | undefined>>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  formRedirect("manufacturing/finished-goods-receipts/[id]/edit", "manufacturing/finished-goods-receipts/[id]", await params, await searchParams);
}
