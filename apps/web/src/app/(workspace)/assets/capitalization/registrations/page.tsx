import { redirect } from "next/navigation";

export default function Page() {
  redirect("/assets/capitalization?view=batches");
}
