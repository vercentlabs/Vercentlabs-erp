import Link from "next/link";
import AuthCard from "@/components/auth-card";
import AuthForm from "@/components/auth-form";

export const metadata = { title: "Forgot password" };
export default function ForgotPasswordPage() {
  return (
    <AuthCard
      eyebrow="Account recovery"
      title="Reset your password"
      description="Enter the work email connected to your account."
      footer={<Link href="/login">Return to sign in</Link>}
    >
      <AuthForm mode="forgot" />
    </AuthCard>
  );
}
