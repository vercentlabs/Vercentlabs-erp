"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import AppIcon from "@/components/app-icon";

export default function LogoutButton({
  iconOnly = false,
}: {
  iconOnly?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      aria-label={pending ? "Signing out" : "Sign out"}
      className={iconOnly ? "logout-icon-button" : "text-button"}
      disabled={pending}
      onClick={logout}
      title="Sign out"
      type="button"
    >
      {iconOnly ? <AppIcon name="logout" size={18} /> : null}
      {!iconOnly ? (pending ? "Signing out…" : "Sign out") : null}
    </button>
  );
}
