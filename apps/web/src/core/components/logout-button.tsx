"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import AppIcon from "@/shared/components/app-icon";
import { requestJson } from "@/core/client-request";

export default function LogoutButton({
  iconOnly = false,
  className,
}: {
  iconOnly?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    if (pending) return;

    setPending(true);
    const result = await requestJson("/api/auth/logout", { method: "POST" });
    if (result.ok) {
      router.replace("/login");
      router.refresh();
      return;
    }

    setPending(false);
    window.alert(result.message || "Sign out could not be completed.");
  }

  return (
    <button
      aria-label={pending ? "Signing out" : "Sign out"}
      className={className ?? (iconOnly ? "logout-icon-button" : "text-button")}
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
