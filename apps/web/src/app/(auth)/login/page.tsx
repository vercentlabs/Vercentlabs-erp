import Link from "next/link";
import AuthCard from "@/components/auth-card";
import AuthForm from "@/components/auth-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const { reset } = await searchParams;
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
      <AuthForm mode="login" />
    </AuthCard>
  );
}
