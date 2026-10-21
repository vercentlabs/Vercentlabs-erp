"use client";

// New workspace setup (MVP 44): Screen 1 (4 details) → Screen 2 (the 6-digit code) → Screen 3 (what the business does — only when the
// website told us nothing) → Screen 4 (what we understood and the suggested apps) → Screen 5 (setting up, then the first app).
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";

import { Button, Checkbox, TextArea, TextField } from "@vercentlabs/design-system";

import { CodeInput } from "@/shared/ui/CodeInput";
import { getModuleNavigation } from "@/shell/navigation/module-navigation-registry";

type AppCard = { key: string; name: string; reason: string; suggested: boolean };
type SignupState = { next: "code" | "wait" | "describe" | "apps" | "done"; companyName: string; websiteFailed: boolean;
  profile: { description: string; confidence: string } | null; apps: { suggested: AppCard[]; others: AppCard[] }; suggestionsLeft: number };
type Failure = { message: string; field?: string; retryAfterSeconds?: number };
type Step = "details" | "code" | "wait" | "describe" | "apps" | "setup";

async function call<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw { message: "Check your connection and try again." } satisfies Failure;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw { message: payload.message || "That did not work. Try again.", field: payload.field, retryAfterSeconds: payload.retryAfterSeconds } satisfies Failure;
  return payload as T;
}
const failure = (error: unknown): Failure => (error && typeof error === "object" && "message" in error ? (error as Failure) : { message: "That did not work. Try again." });
const EXAMPLES = ["We run a cafe in Pune", "We make cotton fabric and sell to shops", "We install solar panels for homes", "We are a CA firm with 6 people"];
const join = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "");

export function SignupFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("details");
  const [form, setForm] = useState({ fullName: "", email: "", companyName: "", website: "" });
  const [error, setError] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<SignupState | null>(null);
  const [resendIn, setResendIn] = useState(30);

  useEffect(() => {
    if (step !== "code" || resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [step, resendIn]);

  const fieldError = (field: string) => (error?.field === field ? error.message : undefined);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const local = (form.fullName.replace(/[^\p{L}]/gu, "").length < 2 && { field: "fullName", message: "Enter your name." })
      || (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim()) && { field: "email", message: "Enter a valid email, like ravi@sharmatextiles.in" })
      || (form.companyName.trim().length < 2 && { field: "companyName", message: "Enter your company name." });
    if (local) { setError(local); return; }
    setBusy(true);
    setError(null);
    try {
      await call("/api/auth/signup/start", { ...form, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      setResendIn(30);
      setStep("code");
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setBusy(false);
    }
  }

  async function verify(code: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await call<{ next: string }>("/api/auth/signup/verify", { code });
      if (result.next.startsWith("/")) { router.replace(result.next); return; }
      setStep("wait");
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setError(null);
    try {
      await call("/api/auth/signup/resend", {});
      setResendIn(30);
    } catch (caught) {
      const f = failure(caught);
      setError(f);
      if (f.retryAfterSeconds) setResendIn(f.retryAfterSeconds);
    }
  }

  // "Getting your workspace ready…": up to 8 seconds while the website is read, then the apps (or Screen 3).
  useEffect(() => {
    if (step !== "wait") return;
    let stopped = false;
    const startedAt = Date.now();
    const poll = async () => {
      try {
        const { state: next } = await call<{ state: SignupState }>("/api/auth/signup/state");
        if (stopped) return;
        if (next.next === "wait" && Date.now() - startedAt < 9000) { setTimeout(poll, 700); return; }
        setState(next);
        setStep(next.next === "apps" ? "apps" : "describe");
      } catch (caught) {
        if (!stopped) { setError(failure(caught)); setStep("details"); }
      }
    };
    void poll();
    return () => { stopped = true; };
  }, [step]);

  if (step === "details") {
    return (
      <form className="flex flex-col gap-6" onSubmit={start} noValidate>
        <Heading title="Set up your workspace" line="It takes about a minute. No password needed." />
        <div className="flex flex-col gap-4">
          <TextField label="Your name" autoComplete="name" value={form.fullName} onChange={set("fullName")} isInvalid={Boolean(fieldError("fullName"))} errorMessage={fieldError("fullName")} />
          <TextField label="Work email" type="email" autoComplete="email" value={form.email} onChange={set("email")} isInvalid={Boolean(fieldError("email"))} errorMessage={fieldError("email")} />
          <TextField label="Company name" autoComplete="organization" value={form.companyName} onChange={set("companyName")} isInvalid={Boolean(fieldError("companyName"))} errorMessage={fieldError("companyName")} />
          <TextField label="Website (optional)" inputMode="url" placeholder="sharmatextiles.in" description="We read it to suggest the right apps." value={form.website} onChange={set("website")} isInvalid={Boolean(fieldError("website"))} errorMessage={fieldError("website")} />
        </div>
        {error && !error.field && <p role="alert" className="text-sm text-danger">{error.message}</p>}
        <Button type="submit" variant="primary" size="standard" isLoading={busy}>Continue</Button>
        <p className="text-center text-sm text-text-secondary">Already have a workspace? <Link href="/login" className="font-medium text-brand hover:underline">Sign in</Link></p>
      </form>
    );
  }
  if (step === "code") {
    return (
      <div className="flex flex-col gap-6">
        <Heading title="Check your email" line={`We sent a 6-digit code to ${form.email.trim().toLowerCase()}. Enter it below.`} />
        <CodeInput disabled={busy} onComplete={verify} resetKey={error?.message} />
        {error && <p role="alert" className="text-sm text-danger">{error.message}</p>}
        <p className="text-center text-sm text-text-secondary">
          Didn&apos;t get it?{" "}
          {resendIn > 0 ? <span className="text-text-muted">{`Resend code in ${resendIn}s`}</span> : <button type="button" className="font-medium text-brand hover:underline" onClick={() => void resend()}>Resend code</button>}
          {" · "}Wrong email? <button type="button" className="font-medium text-brand hover:underline" onClick={() => { setError(null); setStep("details"); }}>Change it</button>
        </p>
      </div>
    );
  }
  if (step === "wait") return <Working line="Getting your workspace ready…" />;
  if (step === "describe") return <Describe state={state} onDone={(next) => { setState(next); setStep("apps"); }} />;
  if (step === "apps" && state) return <Apps state={state} onChange={setState} onSetUp={() => setStep("setup")} />;
  return <SettingUp state={state} />;
}

function Heading({ title, line }: { title: string; line?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
      {line && <p className="text-sm text-text-secondary">{line}</p>}
    </div>
  );
}
function Working({ line }: { line: string }) {
  return <div className="flex items-center gap-3 py-10 text-sm text-text-secondary"><LoaderCircle aria-hidden className="size-5 animate-spin" />{line}</div>;
}

function Describe({ state, onDone }: { state: SignupState | null; onDone: (state: SignupState) => void }) {
  const [text, setText] = useState("");
  const [example, setExample] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 3000);
    return () => clearInterval(timer);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim().length < 3) { setError("In one line, tell us what you sell or what service you give."); return; }
    setBusy(true);
    setError(null);
    try {
      onDone((await call<{ state: SignupState }>("/api/auth/signup/describe", { description: text })).state);
    } catch (caught) {
      setError(failure(caught).message);
      setBusy(false);
    }
  }
  if (busy) return <Working line="Finding the right apps for you…" />;
  return (
    <form className="flex flex-col gap-6" onSubmit={submit} noValidate>
      <div className="flex flex-col gap-2">
        {state?.websiteFailed && <p className="text-xs text-text-muted">We couldn&apos;t read your website, so tell us in your own words.</p>}
        <Heading title="What does your business do?" line="In one line, tell us what you sell or what service you give." />
      </div>
      <TextArea label="Your business" value={text} onChange={setText} maxLength={200} placeholder={EXAMPLES[example]} isInvalid={Boolean(error)} errorMessage={error ?? undefined} />
      <Button type="submit" variant="primary" size="standard">Continue</Button>
    </form>
  );
}

function AppTile({ app, checked, onToggle }: { app: AppCard; checked: boolean; onToggle: () => void }) {
  const Icon = getModuleNavigation(app.key)?.icon;
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border p-3 ${checked ? "border-brand bg-brand-soft" : "border-border bg-surface"}`}>
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-surface text-brand">{Icon ? <Icon aria-hidden className="size-4" /> : null}</span>
      <span className="flex flex-1 flex-col">
        <span className="text-sm font-medium text-text">{app.name}</span>
        <span className="text-xs text-text-secondary">{app.reason}</span>
      </span>
      <Checkbox aria-label={`Use ${app.name}`} isSelected={checked} onChange={onToggle} />
    </label>
  );
}

function Apps({ state, onChange, onSetUp }: { state: SignupState; onChange: (state: SignupState) => void; onSetUp: () => void }) {
  const [picked, setPicked] = useState<string[]>(() => state.apps.suggested.map((app) => app.key));
  const [showMore, setShowMore] = useState(state.apps.suggested.length === 0);
  const [editing, setEditing] = useState(false);
  const [line, setLine] = useState(state.profile?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (key: string) => setPicked((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
  const description = state.profile?.description ?? "";
  const unsure = state.profile?.confidence !== "high";
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = (await call<{ state: SignupState }>("/api/auth/signup/describe", { description: line })).state;
      onChange(next);
      setPicked(next.apps.suggested.map((app) => app.key));
      setEditing(false);
    } catch (caught) {
      setError(failure(caught).message);
    } finally {
      setBusy(false);
    }
  }
  const all = [...state.apps.suggested, ...state.apps.others];
  const ordered = all.filter((app) => picked.includes(app.key)).sort((a, b) => {
    const rank = (app: AppCard) => (app.suggested ? state.apps.suggested.indexOf(app) : 100 + picked.indexOf(app.key));
    return rank(a) - rank(b);
  });
  return (
    <div className="flex flex-col gap-6">
      <Heading title={`Your workspace for ${state.companyName}`} />
      <section className="flex flex-col gap-2" aria-label="What we understood">
        {editing ? (
          <div className="flex flex-col gap-2">
            <TextArea label="What your business does" value={line} onChange={setLine} maxLength={200} isInvalid={Boolean(error)} errorMessage={error ?? undefined} />
            <div className="flex gap-2"><Button size="compact" variant="primary" isLoading={busy} onPress={() => void save()}>Save</Button>
              <Button size="compact" variant="ghost" onPress={() => { setEditing(false); setError(null); }}>Cancel</Button></div>
          </div>
        ) : (
          <p className="text-sm text-text">
            {description ? (unsure ? `We think: ${description}` : description) : "Tell us what your business does and we'll suggest apps."}{" "}
            {state.suggestionsLeft > 0 && <button type="button" className="font-medium text-brand hover:underline" onClick={() => setEditing(true)}>Edit</button>}
          </p>
        )}
      </section>
      {busy ? <Working line="Finding the right apps for you…" /> : (
        <section className="flex flex-col gap-2" aria-label="Suggested apps">
          {state.apps.suggested.map((app) => <AppTile key={app.key} app={app} checked={picked.includes(app.key)} onToggle={() => toggle(app.key)} />)}
          {!showMore ? (
            <button type="button" className="self-start text-sm font-medium text-brand hover:underline" onClick={() => setShowMore(true)}>{`Add more apps (${state.apps.others.length} more)`}</button>
          ) : state.apps.others.map((app) => <AppTile key={app.key} app={app} checked={picked.includes(app.key)} onToggle={() => toggle(app.key)} />)}
        </section>
      )}
      <div className="flex flex-col gap-2">
        <Button variant="primary" size="standard" isDisabled={!ordered.length || busy || editing}
          onPress={() => { window.sessionStorage.setItem("vercentlabs-signup-apps", JSON.stringify(ordered.map((app) => ({ key: app.key, name: app.name })))); onSetUp(); }}>Set up workspace</Button>
        {!ordered.length && <p className="text-center text-xs text-danger">Pick at least one app.</p>}
        <p className="text-center text-xs text-text-muted">Free for 30 days. No card needed.</p>
        <p className="text-center text-xs text-text-muted">You can add or remove apps anytime in Settings.</p>
      </div>
    </div>
  );
}

function SettingUp({ state }: { state: SignupState | null }) {
  const router = useRouter();
  const apps = useMemo<Array<{ key: string; name: string }>>(() => {
    try { return JSON.parse(window.sessionStorage.getItem("vercentlabs-signup-apps") ?? "[]"); } catch { return []; }
  }, []);
  const steps = ["Creating your workspace", `Switching on ${join(apps.map((app) => app.name))}`, "Getting your workspace ready"];
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const run = async () => {
    setFailed(false);
    setDone(0);
    try {
      const result = await call<{ href: string }>("/api/auth/signup/complete", { apps: apps.map((app) => app.key) });
      for (let i = 1; i <= steps.length; i += 1) {
        setDone(i);
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      window.sessionStorage.removeItem("vercentlabs-signup-apps");
      router.replace(result.href);
      router.refresh();
    } catch {
      setFailed(true);
    }
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  });
  return (
    <div className="flex flex-col gap-6">
      <Heading title={state ? `Setting up ${state.companyName}` : "Setting up your workspace"} />
      <ol className="flex flex-col gap-3 text-sm">
        {steps.map((label, i) => (
          <li key={label} className="flex items-center gap-3">
            {i < done ? <Check aria-hidden className="size-4 text-success" /> : i === done && !failed ? <LoaderCircle aria-hidden className="size-4 animate-spin text-text-muted" />
              : <span className="size-4" />}
            <span className={i <= done ? "text-text" : "text-text-muted"}>{label}</span>
          </li>
        ))}
      </ol>
      {failed && (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-danger">Something went wrong while setting up. Try again.</p>
          <Button variant="primary" onPress={() => void run()}>Try again</Button>
        </div>
      )}
    </div>
  );
}
