"use client";

// New workspace setup (MVP 44): Screen 1 (4 details) → Screen 2 (the 6-digit code) → Screen 3 (what the business does — only when the
// website told us nothing) → Screen 4 (what we understood and the suggested apps) → Screen 5 (setting up, then the home page).
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Sparkles } from "lucide-react";

import { Button, TextArea, TextField } from "@vercentlabs/design-system";

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
        <Heading title="Set up your workspace" line="Tell us a little about you and your business. It takes about a minute." />
        <div className="flex flex-col gap-4">
          <TextField label="Your name" autoComplete="name" value={form.fullName} onChange={set("fullName")} isInvalid={Boolean(fieldError("fullName"))} errorMessage={fieldError("fullName")} />
          <TextField label="Work email" type="email" autoComplete="email" value={form.email} onChange={set("email")} isInvalid={Boolean(fieldError("email"))} errorMessage={fieldError("email")} />
          <TextField label="Company name" autoComplete="organization" value={form.companyName} onChange={set("companyName")} isInvalid={Boolean(fieldError("companyName"))} errorMessage={fieldError("companyName")} />
          <TextField label="Website (optional)" inputMode="url" placeholder="sharmatextiles.in" value={form.website} onChange={set("website")} isInvalid={Boolean(fieldError("website"))} errorMessage={fieldError("website")} />
        </div>
        {error && !error.field && <p role="alert" className="text-sm text-danger">{error.message}</p>}
        <div className="flex flex-col gap-2">
          <Button type="submit" variant="primary" size="standard" isLoading={busy}>Continue</Button>
          <p className="text-center text-xs text-text-muted">We&apos;ll read your public website to suggest the right apps for you.</p>
        </div>
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
      <p className="text-xs font-semibold tracking-wide text-text-muted uppercase md:hidden">Vercentlabs</p>
      <h1 className="text-xl font-semibold text-text">{title}</h1>
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

// One app as a single checkbox: the whole tile toggles it. Picked tiles keep a white surface with a brand outline and a filled icon,
// so a long list of picked apps stays calm.
// One app: its icon is the tick — filled in the brand colour when the app is on. The AI's reason (or the app's own line) is the tooltip;
// the suggested ones say so under their name.
function AppTile({ app, checked, onToggle, index }: { app: AppCard; checked: boolean; onToggle: () => void; index: number }) {
  const Icon = getModuleNavigation(app.key)?.icon;
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={onToggle} title={app.reason} style={{ animationDelay: `${index * 35}ms` }}
      className={`signup-reveal flex h-11 min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] border px-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand ${
        checked ? "border-brand bg-surface" : "border-border bg-surface-muted hover:border-border-strong"}`}>
      <span className={`flex size-7 shrink-0 items-center justify-center rounded-[calc(var(--radius-control)-2px)] transition-colors ${checked ? "bg-brand text-text-inverse" : "bg-surface text-text-muted"}`}>
        {Icon ? <Icon aria-hidden className="size-3.5" /> : <Check aria-hidden className="size-3.5" />}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={`truncate text-sm font-medium ${checked ? "text-text" : "text-text-secondary"}`}>{app.name}</span>
        {app.suggested && <span className="text-[11px] font-medium text-brand">Suggested</span>}
      </span>
    </button>
  );
}

// The 2 seconds before the apps appear: three steps tick through, a thin bar fills and the apps light up one by one — what is being done,
// shown rather than a spinner. Reduced motion: no movement and a shorter pause.
const ANALYSIS_MS = 2000;
function Analysing({ companyName, apps }: { companyName: string; apps: AppCard[] }) {
  const steps = [`Reading about ${companyName}`, "Understanding what you do", "Matching your apps"];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timers = [1, 2].map((next) => setTimeout(() => setStep(next), (ANALYSIS_MS / 3) * next));
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite">
      <Heading title={`Your workspace for ${companyName}`} />
      <ol className="flex flex-col gap-2.5">
        {steps.map((label, index) => (
          <li key={label} className={`flex items-center gap-2.5 text-sm transition-colors ${index <= step ? "text-text" : "text-text-muted"}`}>
            <span className={`flex size-5 items-center justify-center rounded-full border transition-colors ${index < step ? "border-brand bg-brand text-text-inverse" : index === step ? "border-brand" : "border-border"}`}>
              {index < step ? <Check aria-hidden className="size-3" strokeWidth={3} /> : index === step ? <span className="size-1.5 animate-pulse rounded-full bg-brand" /> : null}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <div className="h-1 overflow-hidden rounded-full bg-surface-muted"><div className="signup-progress h-full rounded-full bg-brand" /></div>
      <div aria-hidden className="grid grid-cols-6 gap-2">
        {apps.map((app, index) => {
          const Icon = getModuleNavigation(app.key)?.icon;
          return (
            <span key={app.key} className="signup-light flex aspect-square items-center justify-center rounded-[var(--radius-control)]" style={{ animationDelay: `${index * 140}ms` }}>
              {Icon ? <Icon className="size-4" /> : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Apps({ state, onChange, onSetUp }: { state: SignupState; onChange: (state: SignupState) => void; onSetUp: () => void }) {
  // Every app starts on — a business that grows uses more of them; the suggested ones lead. The first kept app is the one they land in.
  const all = useMemo(() => [...state.apps.suggested, ...state.apps.others], [state.apps]);
  const [picked, setPicked] = useState<string[]>(() => all.map((app) => app.key));
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [line, setLine] = useState(state.profile?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => setReady(true), reduced ? 600 : ANALYSIS_MS);
    return () => clearTimeout(timer);
  }, []);
  const toggle = (key: string) => setPicked((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
  const description = state.profile?.description ?? "";
  const unsure = state.profile?.confidence !== "high";
  async function save() {
    setBusy(true);
    setError(null);
    try {
      // A new description changes which apps are marked Suggested; what is ticked stays as the person left it.
      onChange((await call<{ state: SignupState }>("/api/auth/signup/describe", { description: line })).state);
      setEditing(false);
    } catch (caught) {
      setError(failure(caught).message);
    } finally {
      setBusy(false);
    }
  }
  const ordered = all.filter((app) => picked.includes(app.key));
  if (!ready) return <Analysing companyName={state.companyName} apps={all} />;
  return (
    <div className="flex flex-col gap-4">
      <Heading title={`Your workspace for ${state.companyName}`} />
      <section aria-label="What we understood" className="signup-reveal rounded-[var(--radius-card)] border border-border bg-surface p-3">
        {editing ? (
          <div className="flex flex-col gap-2">
            <TextArea label="What your business does" value={line} onChange={setLine} maxLength={200} isInvalid={Boolean(error)} errorMessage={error ?? undefined} />
            <div className="flex gap-2"><Button size="compact" variant="primary" isLoading={busy} onPress={() => void save()}>Save</Button>
              <Button size="compact" variant="ghost" onPress={() => { setEditing(false); setError(null); }}>Cancel</Button></div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-xs font-medium text-text-muted">{unsure && state.apps.suggested.length ? "We think" : "What we understood"}</p>
              <p className="line-clamp-2 text-sm text-text" title={description || undefined}>
                {!description ? "Tell us what your business does and we'll mark the apps that fit it."
                  : !state.apps.suggested.length ? `We couldn't tell which apps fit "${description}". Every app is on; untick what you don't need.` : description}
              </p>
            </div>
            {state.suggestionsLeft > 0 && <button type="button" className="shrink-0 text-sm font-medium text-brand hover:underline" onClick={() => setEditing(true)}>Edit</button>}
          </div>
        )}
      </section>
      {busy ? <Working line="Finding the right apps for you…" /> : (
        <section className="flex flex-col gap-2" aria-labelledby="your-apps">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="your-apps" className="text-sm font-semibold text-text">Your apps</h2>
            <span className="text-xs text-text-muted tabular-nums">{`${ordered.length} of ${all.length} on`}</span>
          </div>
          <p className="-mt-1 text-xs text-text-secondary">
            {state.apps.suggested.length ? "All are on so you have room to grow; the suggested ones fit what you do today." : "All are on so you have room to grow."}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {all.map((app, index) => <AppTile key={app.key} app={app} index={index} checked={picked.includes(app.key)} onToggle={() => toggle(app.key)} />)}
          </div>
        </section>
      )}
      <div className="flex flex-col gap-2 pt-1">
        <Button variant="primary" size="standard" isDisabled={!ordered.length || busy || editing}
          onPress={() => { window.sessionStorage.setItem("vercentlabs-signup-apps", JSON.stringify(ordered.map((app) => ({ key: app.key, name: app.name })))); onSetUp(); }}>
          {ordered.length ? `Set up workspace with ${ordered.length} ${ordered.length === 1 ? "app" : "apps"}` : "Set up workspace"}
        </Button>
        <p className={`text-center text-xs ${ordered.length ? "text-text-muted" : "text-danger"}`}>
          {ordered.length ? "Free for 30 days, no card needed. Change apps anytime in Settings." : "Pick at least one app."}
        </p>
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
