"use client";

// The visitor's side of website chat (CRM plan 5.8), shown in the frame the embed script opens: a short form (name, email or mobile,
// message) starts the conversation; then the messages, refreshed every few seconds, and a box to write. The conversation's token is kept
// in this browser, so a reload continues it.
import { useCallback, useEffect, useRef, useState } from "react";

type Message = { id: string; sender: "visitor" | "agent" | "system"; body: string; authorName: string | null; at: string };

const storageKey = (key: string) => `vl-chat:${key}`;
function readToken(key: string) {
  try { return window.localStorage.getItem(storageKey(key)); } catch { return null; }
}
function writeToken(key: string, token: string | null) {
  try { if (token) window.localStorage.setItem(storageKey(key), token); else window.localStorage.removeItem(storageKey(key)); } catch { /* private mode: the chat lasts this page */ }
}

export function VisitorChat({ chatKey, welcome, pageUrl }: { chatKey: string; welcome: string; pageUrl: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [closed, setClosed] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", mobile: "", message: "" });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const pageOrigin = (() => { try { return pageUrl ? new URL(pageUrl).origin : null; } catch { return null; } })();

  // The stored token is read after the first render (the server has no localStorage), so the page hydrates the same.
  useEffect(() => {
    const read = window.setTimeout(() => setToken(readToken(chatKey)), 0);
    return () => window.clearTimeout(read);
  }, [chatKey]);
  const load = useCallback(async () => {
    if (!token) return;
    const response = await fetch(`/api/crm/public/chat/${chatKey}/messages`, { headers: { "x-chat-token": token }, cache: "no-store" });
    if (response.status === 404) { writeToken(chatKey, null); setToken(null); setMessages([]); return; }
    if (!response.ok) return;
    const result = (await response.json()) as { status: string; messages: Message[] };
    setMessages(result.messages);
    setClosed(result.status !== "open");
  }, [chatKey, token]);
  useEffect(() => {
    if (!token) return;
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 4000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load, token]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/public/chat/${chatKey}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...(pageOrigin ? { "x-chat-page-origin": pageOrigin } : {}) },
        body: JSON.stringify({ ...form, pageUrl }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message ?? "The chat could not start. Try again.");
      writeToken(chatKey, result.token);
      setToken(result.token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The chat could not start. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!token || !draft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/crm/public/chat/${chatKey}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-chat-token": token }, body: JSON.stringify({ body: draft.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message ?? "The message could not be sent.");
      setDraft("");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The message could not be sent.");
    } finally {
      setBusy(false);
    }
  };
  const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

  if (!token)
    return (
      <form className="flex flex-col gap-2 p-4" onSubmit={(event) => { event.preventDefault(); void start(); }}>
        <p className="rounded-lg bg-slate-100 p-3 text-sm">{welcome}</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <input className={input} aria-label="Your name" placeholder="Your name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        <input className={input} aria-label="Email" placeholder="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        <input className={input} aria-label="Mobile" placeholder="Mobile (or email)" type="tel" value={form.mobile} onChange={(event) => setForm({ ...form, mobile: event.target.value })} />
        <textarea className={input} aria-label="Your message" placeholder="How can we help?" required rows={3} value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} />
        <button type="submit" disabled={busy || !form.name.trim() || !form.message.trim() || (!form.email.trim() && !form.mobile.trim())}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Start chat</button>
      </form>
    );
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.sender === "visitor" ? "justify-end" : "justify-start"}`}>
            <p className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${message.sender === "visitor" ? "bg-slate-900 text-white" : "bg-slate-100"}`}>
              {message.sender === "agent" && message.authorName ? <span className="block text-xs font-semibold">{message.authorName}</span> : null}
              {message.body}
            </p>
          </div>
        ))}
        <div ref={end} />
      </div>
      {error && <p role="alert" className="px-3 text-sm text-red-700">{error}</p>}
      {closed ? (
        <div className="flex items-center justify-between gap-2 border-t p-3 text-sm">
          <span>This chat has ended.</span>
          <button type="button" className="underline" onClick={() => { writeToken(chatKey, null); setToken(null); setMessages([]); setClosed(false); }}>Start a new one</button>
        </div>
      ) : (
        <form className="flex gap-2 border-t p-3" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <input className={input} aria-label="Your message" placeholder="Write a message" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" disabled={busy || !draft.trim()} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Send</button>
        </form>
      )}
    </div>
  );
}
