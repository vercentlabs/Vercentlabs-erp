import { IndentDetailScreen } from "@/features/procurement/indents/IndentScreens";

export const metadata = { title: "Purchase indent" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IndentDetailScreen indentId={id} />;
}
