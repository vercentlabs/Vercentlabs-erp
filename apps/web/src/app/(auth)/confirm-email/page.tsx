import { ConfirmEmailClient } from "./confirm-email-client";

export const metadata = { title: "Confirm your new email" };

export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <ConfirmEmailClient token={token} />;
}
