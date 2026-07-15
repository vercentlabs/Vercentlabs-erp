import Link from "next/link";
import AuthCard from "@/components/auth-card";
import SignupForm from "@/components/signup-form";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthCard
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
