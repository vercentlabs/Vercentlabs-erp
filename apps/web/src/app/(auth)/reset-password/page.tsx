import { ResetPasswordForm } from "./reset-password-form";

export const metadata = { title: "Reset password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">Vercentlabs ERP</p>
        <h1 className="text-xl font-semibold text-text">Choose a new password</h1>
      </div>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p role="alert" className="text-sm text-danger">
          This link is missing its reset token. Request a new password reset link.
        </p>
      )}
    </div>
  );
}
