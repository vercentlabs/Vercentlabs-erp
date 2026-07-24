import Link from "next/link";
import { redirect } from "next/navigation";
import AuthCard from "@/components/auth-card";
import AuthForm from "@/components/auth-form";
import { getSessionContext, nextPath } from "@/lib/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; expired?: string }>;
}) {
  const session = await getSessionContext();
  if (session) redirect(nextPath(session));
  const { reset, expired } = await searchParams;
  return (
    <AuthCard
      eyebrow="Welcome back"
      title="Sign in to your ERP workspace"
      description="Use your verified work account to continue."
      footer={
        <p>
          New to Vercent ERP? <Link href="/signup">Create an account</Link>
        </p>
      }
    >
      {reset === "success" ? (
        <p className="notice">
          Password changed successfully. Sign in with the new password.
        </p>
      ) : null}
      {expired === "1" ? (
        <p className="notice">
          Your session ended. Sign in again to continue securely.
        </p>
      ) : null}
      <AuthForm mode="login" />
    </AuthCard>
  );
}
