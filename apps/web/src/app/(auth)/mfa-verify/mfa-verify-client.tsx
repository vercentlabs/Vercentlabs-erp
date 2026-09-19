"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button, TextField } from "@vercentlabs/design-system";

type EnrollStartResponse = { secretBase32: string; otpauthUri: string };
type EnrollConfirmResponse = { recoveryCodes: string[] };

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data: T | null; message?: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as (T & { ok?: boolean; message?: string }) | { ok?: boolean; message?: string };
  if (!response.ok || (payload as { ok?: boolean }).ok === false) {
    return { ok: false, data: null, message: (payload as { message?: string }).message || "Something went wrong. Try again." };
  }
  return { ok: true, data: payload as T };
}

export function MfaVerifyClient({ mfaEnrolled, email }: { mfaEnrolled: boolean; email: string }) {
  const router = useRouter();

  // --- Already-enrolled path: just verify a code from the existing authenticator ---
  const [code, setCode] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVerifyError(null);
    setVerifying(true);
    try {
      const result = await postJson<{ verified: boolean }>("/api/auth/mfa/verify", { code });
      if (!result.ok) {
        setVerifyError(result.message ?? "That code is incorrect or has already been used.");
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setVerifying(false);
    }
  }

  if (mfaEnrolled) {
    return (
      <form className="flex flex-col gap-4" onSubmit={handleVerify} noValidate>
        <p className="text-sm text-text-secondary">
          Enter the 6-digit code from your authenticator app for {email}, or one of your recovery codes.
        </p>
        <TextField label="Code" autoComplete="one-time-code" isRequired value={code} onChange={setCode} />
        {verifyError ? (
          <p role="alert" className="text-sm text-danger">
            {verifyError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="standard" isLoading={verifying} className="mt-2">
          Verify
        </Button>
      </form>
    );
  }

  return <MfaMandatoryEnrollment email={email} />;
}

// Reached only when an organization/admin policy requires MFA and this
// user hasn't set up an authenticator yet — enrollment IS the step-up
// requirement here, so it happens inline rather than sending them to
// Settings first (they can't reach the workspace to get there anyway).
function MfaMandatoryEnrollment({ email }: { email: string }) {
  const router = useRouter();
  const [starting, setStarting] = useState(true);
  const [startError, setStartError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollStartResponse | null>(null);

  const [confirmCode, setConfirmCode] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await postJson<EnrollStartResponse>("/api/auth/mfa/enroll/start", {});
      if (cancelled) return;
      if (!result.ok || !result.data) {
        setStartError(result.message ?? "Could not start MFA enrollment.");
      } else {
        setEnrollment(result.data);
      }
      setStarting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfirmError(null);
    setConfirming(true);
    try {
      const result = await postJson<EnrollConfirmResponse>("/api/auth/mfa/enroll/confirm", { code: confirmCode });
      if (!result.ok || !result.data) {
        setConfirmError(result.message ?? "That code is incorrect. Check your authenticator app and try again.");
        return;
      }
      setRecoveryCodes(result.data.recoveryCodes);
    } finally {
      setConfirming(false);
    }
  }

  if (recoveryCodes) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          Multi-factor authentication is now enabled for {email}. Save these recovery codes somewhere safe — each one
          can be used once if you lose access to your authenticator app. They will not be shown again.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-[var(--radius-card)] border border-border bg-surface-muted p-4 font-mono text-sm text-text">
          {recoveryCodes.map((recoveryCode) => (
            <li key={recoveryCode}>{recoveryCode}</li>
          ))}
        </ul>
        <Button
          type="button"
          variant="primary"
          size="standard"
          onPress={() => {
            router.push("/");
            router.refresh();
          }}
        >
          I&rsquo;ve saved these codes — continue
        </Button>
      </div>
    );
  }

  if (starting) return <p className="text-sm text-text-secondary">Setting up multi-factor authentication…</p>;

  if (startError || !enrollment) {
    return (
      <p role="alert" className="text-sm text-danger">
        {startError ?? "Could not start MFA enrollment."}
      </p>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleConfirm} noValidate>
      <p className="text-sm text-text-secondary">
        Your organization requires multi-factor authentication. Add this account to an authenticator app (Google
        Authenticator, 1Password, Authy, or similar) using the key below, then enter the 6-digit code it shows.
      </p>
      <div className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface-muted p-3">
        <span className="text-xs font-medium text-text-muted uppercase">Setup key</span>
        <span className="break-all font-mono text-sm text-text">{enrollment.secretBase32}</span>
      </div>
      <TextField label="6-digit code" autoComplete="one-time-code" isRequired value={confirmCode} onChange={setConfirmCode} />
      {confirmError ? (
        <p role="alert" className="text-sm text-danger">
          {confirmError}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="standard" isLoading={confirming} className="mt-2">
        Enable multi-factor authentication
      </Button>
    </form>
  );
}
