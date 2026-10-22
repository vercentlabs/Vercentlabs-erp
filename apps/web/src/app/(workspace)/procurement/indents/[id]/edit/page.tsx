import { IndentFormScreen } from "@/features/procurement/indents/IndentScreens";

export const metadata = { title: "Edit purchase indent" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IndentFormScreen indentId={id} />;
}
