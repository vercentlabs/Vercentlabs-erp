import { ListPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "Supplier quotations" };

export default function Page() {
  return <ListPage name="quotations" />;
}
