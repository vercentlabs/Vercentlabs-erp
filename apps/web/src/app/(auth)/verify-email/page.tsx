import Link from "next/link";
import AuthCard from "@/components/auth-card";
import AuthForm from "@/components/auth-form";
import ResendVerificationForm from "@/components/resend-verification-form";

export const metadata = { title: "Verify email" };
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token = "", email = "" } = await searchParams;
  return (
    <AuthCard
      eyebrow="Email verification"
      title={token ? "Verify your work email" : "Check your work email"}
      description={
        token
          ? "Confirm this single-use verification link to continue."
          : "Open the verification link sent to your email, or request a new one below."
      }
      footer={<Link href="/login">Return to sign in</Link>}
    >
      {token ? (
        <AuthForm mode="verify" token={token} />
      ) : (
        <ResendVerificationForm defaultEmail={email} />
      )}
    </AuthCard>
  );
}
