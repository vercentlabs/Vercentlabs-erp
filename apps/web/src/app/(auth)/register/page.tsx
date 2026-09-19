import { redirect } from "next/navigation";

import { getSessionContext, nextPath } from "@/core/session";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Create your account" };

export default async function RegisterPage() {
  const session = await getSessionContext();
  if (session) redirect(nextPath(session));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">Vercentlabs ERP</p>
        <h1 className="text-xl font-semibold text-text">Create your account</h1>
        <p className="text-sm text-text-secondary">Set up your organization and start a free trial.</p>
      </div>
      <RegisterForm />
    </div>
  );
}
