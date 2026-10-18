import { notFound } from "next/navigation";
import { getPublicChat } from "@vercentlabs/api/crm";

import { ingressTransaction } from "@/core/db";
import { VisitorChat } from "@/features/crm/chat/components/VisitorChat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chat", robots: { index: false, follow: false } };

// A website chat (CRM plan 5.8), opened in a frame by the embed script (/api/crm/public/chat/{key}/widget.js), or directly.
export default async function ChatPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ page?: string }> }) {
  const { key } = await params;
  const { page } = await searchParams;
  const chat = await ingressTransaction((client) => getPublicChat(client, key)).catch(() => null);
  if (!chat) notFound();
  return (
    <main className="flex h-dvh flex-col bg-white text-slate-900">
      <header className="border-b px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">{chat.organizationName}</p>
        <h1 className="text-base font-semibold">{chat.name}</h1>
      </header>
      <div className="min-h-0 flex-1"><VisitorChat chatKey={key} welcome={chat.welcomeMessage} pageUrl={page ?? null} /></div>
    </main>
  );
}
