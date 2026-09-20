import { ListPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "Purchase orders" };

export default function Page() {
  return <ListPage name="orders" />;
}
