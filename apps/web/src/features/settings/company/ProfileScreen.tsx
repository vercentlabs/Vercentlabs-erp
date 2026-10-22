"use client";

// Your profile (Shared Platform plan 3): name, phone, time zone, language, date and number format; change password; change email.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, PasswordField, Select, TextField } from "@vercentlabs/design-system";

import { timeZoneOptions } from "@/shared/locale-options";
import { IdentityField } from "@/shared/ui/IdentityField";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";

import { changeEmail, changePassword, CompanyApiError, getOwnProfile, saveOwnProfile, type OwnProfile } from "./company-api";

const KEY = ["settings", "profile"];
const message = (error: unknown) => (error instanceof Error ? error.message : "That did not work.");
const fieldOf = (error: unknown) => (error instanceof CompanyApiError ? error.field : undefined);
const EXAMPLE = new Date(2026, 3, 30);
const dateExample = (format: string) => {
  const dd = "30", mm = "04", yyyy = "2026";
  return format.replace("DD", dd).replace("MMM", EXAMPLE.toLocaleString("en-IN", { month: "short" })).replace("MM", mm).replace("YYYY", yyyy);
};

export function ProfileScreen() {
  const query = useQuery({ queryKey: KEY, queryFn: getOwnProfile });
  if (query.isLoading) return <LoadingState label="Loading your profile" rows={4} />;
  if (query.isError || !query.data) return <ErrorState title="Could not load your profile" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />;
  return <ProfileForms profile={query.data.profile} />;
}

function ProfileForms({ profile }: { profile: OwnProfile }) {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  const [form, setForm] = useState({ fullName: profile.fullName, phone: profile.phone ?? "", timezone: profile.timezone, dateFormat: profile.dateFormat, numberFormat: profile.numberFormat });
  const [zones] = useState(timeZoneOptions);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const save = useMutation({ mutationFn: () => saveOwnProfile(form), onSuccess: refresh });
  const [password, setPassword] = useState({ currentPassword: "", newPassword: "", repeat: "" });
  const change = useMutation({ mutationFn: () => changePassword({ currentPassword: password.currentPassword, newPassword: password.newPassword }), onSuccess: () => { setPassword({ currentPassword: "", newPassword: "", repeat: "" }); refresh(); } });
  const [email, setEmail] = useState({ newEmail: "", password: "" });
  const move = useMutation({ mutationFn: () => changeEmail(email), onSuccess: () => { setEmail({ newEmail: "", password: "" }); refresh(); } });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title="Your profile" description={profile.email} />
      <Panel title="About you" description="Your name and how dates and numbers are shown to you.">
        {save.error && <Notice>{message(save.error)}</Notice>}
        {save.isSuccess && <Notice tone="success">Saved. Some pages show the new format after a reload.</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Name" isRequired value={form.fullName} onChange={set("fullName")} />
          <TextField label="Phone" value={form.phone} onChange={set("phone")} errorMessage={fieldOf(save.error) === "phone" ? message(save.error) : undefined} isInvalid={fieldOf(save.error) === "phone"} />
          <Select label="Time zone" description={profile.timezoneIsCompany ? "The company's, until you choose your own." : undefined} selectedKey={form.timezone} onSelectionChange={(key) => set("timezone")(String(key))} options={zones} />
          <Select label="Date format" selectedKey={form.dateFormat} onSelectionChange={(key) => set("dateFormat")(String(key))}
            options={profile.options.dateFormats.map((format) => ({ value: format, label: `${format} (${dateExample(format)})` }))} />
          <Select label="Numbers" selectedKey={form.numberFormat} onSelectionChange={(key) => set("numberFormat")(String(key))}
            options={[{ value: "indian", label: "Indian (12,34,567.00)" }, { value: "international", label: "International (1,234,567.00)" }]} />
        </div>
        <div className="flex justify-end"><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save</Button></div>
      </Panel>
      <Panel title={profile.hasPassword ? "Password" : "Set a password"} description={profile.hasPassword
        ? `Changing it signs you out everywhere else. You cannot reuse your last five passwords.${profile.passwordChangedAt ? ` Last changed ${new Date(profile.passwordChangedAt).toLocaleDateString("en-IN")}.` : ""}`
        : "You sign in with a code from your email. A password is optional — the mobile app needs one."}>
        {change.error && !fieldOf(change.error) && <Notice>{message(change.error)}</Notice>}
        {change.isSuccess && <Notice tone="success">{`Password changed${change.data.otherSessionsSignedOut ? `; ${change.data.otherSessionsSignedOut} other session${change.data.otherSessionsSignedOut === 1 ? "" : "s"} signed out` : ""}.`}</Notice>}
        <div className="grid gap-3 sm:grid-cols-3">
          <IdentityField label="Current password" value={password.currentPassword} onChange={(value) => setPassword((current) => ({ ...current, currentPassword: value }))}
            errorMessage={fieldOf(change.error) === "currentPassword" ? message(change.error) : undefined} />
          <PasswordField label="New password" value={password.newPassword} onChange={(value) => setPassword((current) => ({ ...current, newPassword: value }))}
            errorMessage={fieldOf(change.error) === "newPassword" ? message(change.error) : undefined} isInvalid={fieldOf(change.error) === "newPassword"} />
          <PasswordField label="New password again" value={password.repeat} onChange={(value) => setPassword((current) => ({ ...current, repeat: value }))}
            errorMessage={password.repeat && password.repeat !== password.newPassword ? "The two new passwords are different." : undefined} isInvalid={Boolean(password.repeat && password.repeat !== password.newPassword)} />
        </div>
        <div className="flex justify-end">
          <Button variant="primary" isLoading={change.isPending} isDisabled={!password.currentPassword || !password.newPassword || password.newPassword !== password.repeat} onPress={() => change.mutate()}>{profile.hasPassword ? "Change password" : "Set password"}</Button>
        </div>
      </Panel>
      <Panel title="Email" description="You sign in with this address. A new one works once you confirm it from that inbox.">
        {profile.pendingEmail && <Notice tone="info">{`Waiting for you to confirm ${profile.pendingEmail.email} (the link is in that inbox).`}</Notice>}
        {move.error && !fieldOf(move.error) && <Notice>{message(move.error)}</Notice>}
        {move.isSuccess && <Notice tone="success">{`We sent a confirmation link to ${move.data.sentTo}.`}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="New email" type="email" value={email.newEmail} onChange={(value) => setEmail((current) => ({ ...current, newEmail: value }))}
            errorMessage={fieldOf(move.error) === "newEmail" ? message(move.error) : undefined} isInvalid={fieldOf(move.error) === "newEmail"} />
          <IdentityField value={email.password} onChange={(value) => setEmail((current) => ({ ...current, password: value }))}
            errorMessage={fieldOf(move.error) === "password" ? message(move.error) : undefined} />
        </div>
        <div className="flex justify-end"><Button variant="secondary" isLoading={move.isPending} isDisabled={!email.newEmail || !email.password} onPress={() => move.mutate()}>Send confirmation</Button></div>
      </Panel>
      <SignInAccounts />
    </div>
  );
}

// Sign in with Google / Microsoft (Shared Platform plan 6): connect an account here, then use "Continue with …" on the sign-in page.
type Identity = { id: string; provider: "google" | "microsoft"; email: string | null; linkedAt: string; lastUsedAt: string | null };
const PROVIDER_NAME = { google: "Google", microsoft: "Microsoft" } as const;
function SignInAccounts() {
  const queryClient = useQueryClient();
  const key = ["profile", "sign-in-accounts"];
  const query = useQuery({ queryKey: key, queryFn: () => fetch("/api/settings/profile/sign-in-accounts").then((response) => response.json()) as Promise<{ identities: Identity[]; providers: Array<"google" | "microsoft"> }> });
  const unlink = useMutation({ mutationFn: (id: string) => fetch(`/api/settings/profile/sign-in-accounts?id=${id}`, { method: "DELETE" }), onSuccess: () => void queryClient.invalidateQueries({ queryKey: key }) });
  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const providers = query.data?.providers ?? [];
  if (!providers.length && !(query.data?.identities ?? []).length) return null;
  return (
    <Panel title="Sign-in accounts" description="Sign in with Google or Microsoft instead of your password. Two-step verification still applies.">
      {params?.get("linked") && <Notice tone="success">{`Your ${PROVIDER_NAME[params.get("linked") as "google"] ?? ""} account is connected.`}</Notice>}
      {params?.get("signInError") && <Notice>{params.get("signInError") === "AUTH_SOCIAL_ALREADY_LINKED" ? "That account is already connected to another user." : "The account could not be connected. Try again."}</Notice>}
      <ul className="flex flex-col divide-y divide-border text-sm">
        {(query.data?.identities ?? []).map((identity) => (
          <li key={identity.id} className="flex items-center justify-between gap-2 py-2">
            <span>{PROVIDER_NAME[identity.provider]}{identity.email ? ` · ${identity.email}` : ""}</span>
            <Button variant="ghost" size="compact" onPress={() => unlink.mutate(identity.id)}>Disconnect</Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {providers.map((provider) => (
          <a key={provider} href={`/api/auth/oauth/${provider}/start?purpose=link`}
            className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-hover">{`Connect ${PROVIDER_NAME[provider]}`}</a>
        ))}
      </div>
    </Panel>
  );
}
