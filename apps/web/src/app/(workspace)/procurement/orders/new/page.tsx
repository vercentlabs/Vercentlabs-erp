import { FormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "New purchase order" };

export default function Page() {
  return <FormPage name="orders" />;
}
