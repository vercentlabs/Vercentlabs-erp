"use client";

// The card at the top of an app's main screen: "Get started with CRM" for the owner and administrators of a new workspace (3 tasks that
// tick themselves, however they were done; closed, it comes back from the profile menu's Get started), or "Welcome to Sharma Textiles" for
// a teammate in their first week (what already exists in their apps). Also the "Welcome back" line when signup found a workspace.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, X } from "lucide-react";

import { Notice } from "@/shared/ui/Panel";
import { APP_LANDING, moduleKeyForPath } from "@/shell/navigation/app-landing";

import { GstDetailsDialog } from "./GstDetailsDialog";

type Guide =
  | { kind: "get_started"; moduleKey: string; title: string; tasks: Array<{ label: string; href: string | null; action: string | null; done: boolean }>; done: number }
  | { kind: "welcome"; title: string; line: string; metrics: Array<{ label: string; count: number; href: string; mine?: boolean }> };
export const GUIDE_REOPEN_EVENT = "vercentlabs:guide-reopen";

async function send(body: Record<string, unknown>) {
  await fetch("/api/workspace/guide", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
// From the profile menu: brings back the card closed on this app.
export async function reopenGuide(pathname: string) {
  await send({ action: "reopen", moduleKey: moduleKeyForPath(pathname) ?? "" });
  window.dispatchEvent(new Event(GUIDE_REOPEN_EVENT));
}

export function WorkspaceGuideCard() {
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const moduleKey = moduleKeyForPath(pathname);
  const onLanding = Boolean(moduleKey && APP_LANDING[moduleKey] === pathname);
  const key = ["workspace", "guide", moduleKey];
  const query = useQuery({ queryKey: key, enabled: onLanding, retry: false, staleTime: 30_000,
    queryFn: async () => (await (await fetch(`/api/workspace/guide?module=${moduleKey}`, { credentials: "same-origin" })).json()).guide as Guide | null });
  const [gst, setGst] = useState(false);
  useEffect(() => {
    const again = () => void queryClient.invalidateQueries({ queryKey: ["workspace", "guide"] });
    window.addEventListener(GUIDE_REOPEN_EVENT, again);
    return () => window.removeEventListener(GUIDE_REOPEN_EVENT, again);
  }, [queryClient]);
  const welcomeBack = params.get("welcome") === "back";
  const guide = onLanding ? query.data : null;
  const close = async (guideKind: string) => {
    queryClient.setQueryData(key, null);
    await send({ action: "dismiss", guide: guideKind, moduleKey: moduleKey ?? "" });
  };
  return (
    <>
      {welcomeBack && <div className="mb-4"><Notice tone="info">Welcome back, you already have a workspace.</Notice></div>}
      {guide?.kind === "get_started" && (
        <section aria-label={guide.title} className="mb-4 rounded-[var(--radius-card)] border border-brand/40 bg-brand-soft p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-text">{guide.title}</h2>
              <p className="text-xs text-text-secondary">{`${guide.done} of ${guide.tasks.length} done`}</p>
            </div>
            <button type="button" aria-label="Close" className="rounded p-1 text-text-muted hover:text-text" onClick={() => void close("get_started")}><X aria-hidden className="size-4" /></button>
          </div>
          <ul className="mt-3 flex flex-col gap-2 text-sm sm:flex-row sm:gap-6">
            {guide.tasks.map((task) => (
              <li key={task.label} className="flex items-center gap-2">
                {task.done ? <CheckCircle2 aria-hidden className="size-4 text-success" /> : <Circle aria-hidden className="size-4 text-text-muted" />}
                {task.done ? <span className="text-text-secondary line-through">{task.label}</span>
                  : task.action === "gst" ? <button type="button" className="font-medium text-brand hover:underline" onClick={() => setGst(true)}>{task.label}</button>
                    : task.href ? <Link className="font-medium text-brand hover:underline" href={task.href}>{task.label}</Link>
                      : <span className="text-text-secondary" title="Switch on Sales or Stock in Settings › Modules to add products">{task.label}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {guide?.kind === "welcome" && (
        <section aria-label={guide.title} className="mb-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-text">{guide.title}</h2>
              <p className="text-sm text-text-secondary">{guide.line}</p>
            </div>
            <button type="button" aria-label="Close" className="rounded p-1 text-text-muted hover:text-text" onClick={() => void close("welcome")}><X aria-hidden className="size-4" /></button>
          </div>
          {guide.metrics.length > 0 && <p className="mt-2 text-sm">{guide.metrics.map((m, i) => (
            <span key={m.label}>{i > 0 && " · "}<Link className="text-brand hover:underline" href={m.href}>{`${m.count.toLocaleString("en-IN")} ${m.label}`}</Link></span>))}</p>}
          <p className="mt-2 text-sm">
            <Link className="font-medium text-brand hover:underline" href={guide.metrics.find((m) => m.mine)?.href ?? pathname}>See what&apos;s assigned to you</Link>
            {" · "}<Link className="font-medium text-brand hover:underline" href="/settings/profile">Add your phone number</Link>
          </p>
        </section>
      )}
      <GstDetailsDialog isOpen={gst} onClose={() => { setGst(false); void queryClient.invalidateQueries({ queryKey: ["workspace", "guide"] }); }} />
    </>
  );
}
