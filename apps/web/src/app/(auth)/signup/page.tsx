import Link from "next/link";
import { redirect } from "next/navigation";
import AuthCard from "@/core/components/auth-card";
import SignupForm from "@/core/components/signup-form";
import { getSessionContext, nextPath } from "@/core/auth";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  const session = await getSessionContext();
  if (session) redirect(nextPath(session));
  return (
    <AuthCard
      pageClassName="viewport-auth-page"
      eyebrow="Create your account"
      title="Start your organisation workspace"
      description="Create the first administrator account. Organisation setup follows after email verification."
      footer={
        <p>
          Already registered? <Link href="/login">Sign in</Link>
        </p>
      }
    >
      <SignupForm />
    </AuthCard>
  );
}
