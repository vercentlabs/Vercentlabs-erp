"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Badge, Button, Dialog, EmptyState, ErrorState, PageHeader, TextField } from "@vercentlabs/design-system";
import { Laptop, Smartphone } from "lucide-react";

import { listSessions, revokeOtherSessions, revokeSession, SessionApiError, type SessionRow } from "../api/sessions-api";
import { confirmMfaEnrollment, disableMfa, MfaApiError, regenerateRecoveryCodes, startMfaEnrollment } from "../api/mfa-api";

const SESSIONS_QUERY_KEY = ["settings", "sessions"];

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function SecuritySettingsScreen({ initialMfaEnrolled }: { initialMfaEnrolled: boolean }) {
  const queryClient = useQueryClient();
  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null);
  const [confirmingRevokeOthers, setConfirmingRevokeOthers] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [revokedOthersCount, setRevokedOthersCount] = useState<number | null>(null);

  const query = useQuery({ queryKey: SESSIONS_QUERY_KEY, queryFn: listSessions });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeSession(id),
    onSuccess: () => {
      setActionError(null);
      setRevokeTarget(null);
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      setActionError(error instanceof SessionApiError ? error.message : "This session could not be revoked.");
    },
  });

  const revokeOthersMutation = useMutation({
    mutationFn: revokeOtherSessions,
    onSuccess: (result) => {
      setActionError(null);
      setConfirmingRevokeOthers(false);
      setRevokedOthersCount(result.revokedCount);
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      setActionError(error instanceof SessionApiError ? error.message : "Other sessions could not be revoked.");
    },
  });

  const sessions = query.data?.sessions ?? [];
  const otherSessionCount = sessions.filter((row) => !row.isCurrent).length;

  // --- Multi-factor authentication ---
  const [mfaEnrolled, setMfaEnrolled] = useState(initialMfaEnrolled);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollSecret, setEnrollSecret] = useState<string | null>(null);
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);

  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regenerateCode, setRegenerateCode] = useState("");
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [regeneratedCodes, setRegeneratedCodes] = useState<string[] | null>(null);

  const startEnrollMutation = useMutation({
    mutationFn: startMfaEnrollment,
    onSuccess: (result) => {
      setEnrollError(null);
      setEnrollSecret(result.secretBase32);
    },
    onError: (error: unknown) => {
      setEnrollError(error instanceof MfaApiError ? error.message : "Could not start MFA enrollment.");
    },
  });

  const confirmEnrollMutation = useMutation({
    mutationFn: (code: string) => confirmMfaEnrollment(code),
    onSuccess: (result) => {
      setEnrollError(null);
      setRecoveryCodes(result.recoveryCodes);
      setMfaEnrolled(true);
    },
    onError: (error: unknown) => {
      setEnrollError(error instanceof MfaApiError ? error.message : "That code is incorrect. Try again.");
    },
  });

  const disableMutation = useMutation({
    mutationFn: (code: string) => disableMfa(code),
    onSuccess: () => {
      setDisableError(null);
      setDisableOpen(false);
      setDisableCode("");
      setMfaEnrolled(false);
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
    onError: (error: unknown) => {
      setDisableError(error instanceof MfaApiError ? error.message : "That code is incorrect.");
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (code: string) => regenerateRecoveryCodes(code),
    onSuccess: (result) => {
      setRegenerateError(null);
      setRegeneratedCodes(result.recoveryCodes);
    },
    onError: (error: unknown) => {
      setRegenerateError(error instanceof MfaApiError ? error.message : "That code is incorrect.");
    },
  });

  function closeEnrollDialog() {
    setEnrollOpen(false);
    setEnrollSecret(null);
    setEnrollCode("");
    setEnrollError(null);
    setRecoveryCodes(null);
  }

  function closeRegenerateDialog() {
    setRegenerateOpen(false);
    setRegenerateCode("");
    setRegenerateError(null);
    setRegeneratedCodes(null);
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-8 py-10">
      <PageHeader
        title="Security"
        description="Devices and browsers currently signed in to your account. Revoke any session you don't recognize."
        primaryAction={
          otherSessionCount > 0 ? (
            <Button variant="secondary" onPress={() => setConfirmingRevokeOthers(true)}>
              Sign out all other sessions
            </Button>
          ) : undefined
        }
      />

      <div className="flex max-w-[640px] flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-text">Multi-factor authentication</span>
            <span className="text-xs text-text-muted">
              {mfaEnrolled ? "Enabled — a code from your authenticator app is required at sign-in." : "Not enabled."}
            </span>
          </div>
          <Badge tone={mfaEnrolled ? "success" : "neutral"}>{mfaEnrolled ? "Enabled" : "Disabled"}</Badge>
        </div>
        <div className="flex gap-2">
          {mfaEnrolled ? (
            <>
              <Button variant="secondary" size="compact" onPress={() => setRegenerateOpen(true)}>
                Regenerate recovery codes
              </Button>
              <Button variant="secondary" size="compact" onPress={() => setDisableOpen(true)}>
                Disable
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="compact"
              onPress={() => {
                setEnrollOpen(true);
                startEnrollMutation.mutate();
              }}
            >
              Enable multi-factor authentication
            </Button>
          )}
        </div>
      </div>

      {actionError && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      )}
      {revokedOthersCount !== null && (
        <p className="rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-3 py-2 text-sm text-success">
          Signed out {revokedOthersCount} other session{revokedOthersCount === 1 ? "" : "s"}.
        </p>
      )}

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading sessions…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load sessions" description="Something went wrong loading your active sessions." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : sessions.length === 0 ? (
        <EmptyState title="No active sessions" />
      ) : (
        <ul className="flex max-w-[640px] flex-col gap-2">
          {sessions.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-4"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-text-secondary">
                  {row.sessionType === "mobile" ? (
                    <Smartphone className="size-4" aria-hidden="true" />
                  ) : (
                    <Laptop className="size-4" aria-hidden="true" />
                  )}
                </span>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">{row.deviceName}</span>
                    {row.isCurrent && <Badge tone="success">This device</Badge>}
                  </div>
                  <span className="text-xs text-text-muted">
                    {row.ipAddress ? `${row.ipAddress} · ` : ""}
                    Last active {dateTimeFormatter.format(new Date(row.lastSeenAt))}
                  </span>
                </div>
              </div>
              {!row.isCurrent && (
                <Button variant="secondary" size="compact" onPress={() => setRevokeTarget(row)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        isOpen={Boolean(revokeTarget)}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke this session?"
        description={`This will immediately sign out "${revokeTarget?.deviceName}". They'll need to log in again to continue.`}
        confirmLabel="Revoke session"
        isConfirming={revokeMutation.isPending}
        onConfirm={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
      />

      <AlertDialog
        isOpen={confirmingRevokeOthers}
        onOpenChange={(open) => !open && setConfirmingRevokeOthers(false)}
        title="Sign out all other sessions?"
        description={`This device stays signed in. ${otherSessionCount} other session${otherSessionCount === 1 ? "" : "s"} will be signed out immediately.`}
        confirmLabel="Sign out others"
        isConfirming={revokeOthersMutation.isPending}
        onConfirm={() => revokeOthersMutation.mutate()}
      />

      <Dialog isOpen={enrollOpen} onOpenChange={(open) => !open && closeEnrollDialog()} title="Enable multi-factor authentication">
        {recoveryCodes ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary">
              Enabled. Save these recovery codes somewhere safe — each can be used once if you lose access to your
              authenticator app. They will not be shown again.
            </p>
            <ul className="grid grid-cols-2 gap-2 rounded-[var(--radius-card)] border border-border bg-surface-muted p-4 font-mono text-sm text-text">
              {recoveryCodes.map((recoveryCode) => (
                <li key={recoveryCode}>{recoveryCode}</li>
              ))}
            </ul>
            <Button variant="primary" onPress={closeEnrollDialog}>
              Done
            </Button>
          </div>
        ) : startEnrollMutation.isPending || !enrollSecret ? (
          <p className="text-sm text-text-secondary">Setting up…</p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              confirmEnrollMutation.mutate(enrollCode);
            }}
            noValidate
          >
            <p className="text-sm text-text-secondary">
              Add this account to an authenticator app (Google Authenticator, 1Password, Authy, or similar) using the
              key below, then enter the 6-digit code it shows.
            </p>
            <div className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface-muted p-3">
              <span className="text-xs font-medium text-text-muted uppercase">Setup key</span>
              <span className="break-all font-mono text-sm text-text">{enrollSecret}</span>
            </div>
            <TextField label="6-digit code" autoComplete="one-time-code" isRequired value={enrollCode} onChange={setEnrollCode} />
            {enrollError ? (
              <p role="alert" className="text-sm text-danger">
                {enrollError}
              </p>
            ) : null}
            <Button type="submit" variant="primary" isLoading={confirmEnrollMutation.isPending}>
              Enable
            </Button>
          </form>
        )}
      </Dialog>

      <Dialog isOpen={disableOpen} onOpenChange={(open) => !open && setDisableOpen(false)} title="Disable multi-factor authentication">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            disableMutation.mutate(disableCode);
          }}
          noValidate
        >
          <p className="text-sm text-text-secondary">
            Enter a current code from your authenticator app (or a recovery code) to confirm. This will sign you out
            of every device.
          </p>
          <TextField label="Code" autoComplete="one-time-code" isRequired value={disableCode} onChange={setDisableCode} />
          {disableError ? (
            <p role="alert" className="text-sm text-danger">
              {disableError}
            </p>
          ) : null}
          <Button type="submit" variant="danger" isLoading={disableMutation.isPending}>
            Disable
          </Button>
        </form>
      </Dialog>

      <Dialog isOpen={regenerateOpen} onOpenChange={(open) => !open && closeRegenerateDialog()} title="Regenerate recovery codes">
        {regeneratedCodes ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary">
              Every previous recovery code has been invalidated. Save these new codes somewhere safe — they will not
              be shown again.
            </p>
            <ul className="grid grid-cols-2 gap-2 rounded-[var(--radius-card)] border border-border bg-surface-muted p-4 font-mono text-sm text-text">
              {regeneratedCodes.map((recoveryCode) => (
                <li key={recoveryCode}>{recoveryCode}</li>
              ))}
            </ul>
            <Button variant="primary" onPress={closeRegenerateDialog}>
              Done
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              regenerateMutation.mutate(regenerateCode);
            }}
            noValidate
          >
            <p className="text-sm text-text-secondary">
              Enter a current code from your authenticator app to confirm. Every existing recovery code will stop
              working.
            </p>
            <TextField label="Code" autoComplete="one-time-code" isRequired value={regenerateCode} onChange={setRegenerateCode} />
            {regenerateError ? (
              <p role="alert" className="text-sm text-danger">
                {regenerateError}
              </p>
            ) : null}
            <Button type="submit" variant="primary" isLoading={regenerateMutation.isPending}>
              Regenerate
            </Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
