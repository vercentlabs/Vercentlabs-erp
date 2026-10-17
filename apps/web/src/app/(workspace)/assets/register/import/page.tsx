import { redirect } from "next/navigation";

// Existing assets are brought in through Opening / Existing Assets.
export default function Page() {
  redirect("/assets/opening?view=import");
}
