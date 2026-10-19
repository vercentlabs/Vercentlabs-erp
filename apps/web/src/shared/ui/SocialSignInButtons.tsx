"use client";

// "Continue with Google / Microsoft" (Shared Platform plan 6): shown only for the providers the operator configured.
import { useEffect, useState } from "react";

const LABEL: Record<string, string> = { google: "Continue with Google", microsoft: "Continue with Microsoft" };

export function SocialSignInButtons({ returnTo }: { returnTo?: string }) {
  const [providers, setProviders] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    fetch("/api/auth/oauth/providers").then((response) => response.json()).then((payload) => { if (live) setProviders(payload.providers ?? []); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (!providers.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {providers.map((provider) => (
        <a key={provider} href={`/api/auth/oauth/${provider}/start?purpose=sign_in${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`}
          className="flex h-10 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface text-sm font-medium text-text hover:bg-surface-hover">
          {LABEL[provider] ?? provider}
        </a>
      ))}
      <p className="text-center text-xs text-text-muted">or with your email</p>
    </div>
  );
}
