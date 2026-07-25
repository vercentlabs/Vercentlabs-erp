import { redirect } from "next/navigation";

export default function LegacySignupVerifyPage() {
  redirect("/request-received");
}
