import Link from "next/link";
import AuthCard from "@/components/auth-card";
import AuthForm from "@/components/auth-form";

export const metadata = { title: "Reset password" };
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return (
    <AuthCard
      eyebrow="Choose a new password"
      title="Secure your account"
      description="The reset link is single-use and expires after one hour."
      footer={<Link href="/login">Return to sign in</Link>}
    >
      {token ? (
        <AuthForm mode="reset" token={token} />
      ) : (
        <p className="notice error">
          The password-reset token is missing. Request a new link.
        </p>
      )}
    </AuthCard>
  );
}
