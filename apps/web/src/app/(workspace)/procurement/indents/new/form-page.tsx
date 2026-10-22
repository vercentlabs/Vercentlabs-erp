import { IndentFormScreen } from "@/features/procurement/indents/IndentScreens";

export const metadata = { title: "New purchase indent" };

// A new indent: what a department or the store needs and by when.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await searchParams;
  return <IndentFormScreen />;
}
