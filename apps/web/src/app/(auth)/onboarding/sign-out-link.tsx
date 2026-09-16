"use client";

import { useRouter } from "next/navigation";

export function SignOutLink() {
  const router = useRouter();

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={handleSignOut} className="self-start text-sm font-medium text-brand hover:underline">
      Sign out
    </button>
  );
}
