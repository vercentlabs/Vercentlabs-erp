import { redirect } from "next/navigation";

import { getSessionContext, nextPath } from "@/core/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await getSessionContext();
  if (session) redirect(nextPath(session));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">
          Vercentlabs ERP
        </p>
        <h1 className="text-xl font-semibold text-text">Sign in</h1>
      </div>
      <LoginForm />
    </div>
  );
}
