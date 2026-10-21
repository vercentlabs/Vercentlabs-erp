import { redirect } from "next/navigation";

import { getSessionContext, nextPath } from "@/core/session";
import { SignupFlow } from "./signup-flow";

export const metadata = { title: "Set up your workspace" };

export default async function RegisterPage() {
  const session = await getSessionContext();
  if (session) redirect(nextPath(session));
  return <SignupFlow />;
}
