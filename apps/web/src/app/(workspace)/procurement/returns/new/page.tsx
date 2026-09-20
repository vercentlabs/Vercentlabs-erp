import { FormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "New return" };

export default async function Page({ searchParams }: { searchParams: Promise<{ receipt?: string }> }) {
  const { receipt } = await searchParams;
  return <FormPage name="returns" sourceKind={receipt ? "receipt" : undefined} sourceId={receipt} />;
}
