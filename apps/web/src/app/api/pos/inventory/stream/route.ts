import { listPosInventoryChanges } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { workspaceRoute } from "@/core/workspace-route";
import { posContext } from "@/features/pos/shared/pos-context";

export const dynamic = "force-dynamic";

// GET ?outletId=&terminalId= (Last-Event-ID to resume): Server-Sent Events of availability changes for the warehouses this user's outlets use.
// Each event names a warehouse, an item, its new inventory version and why — never a quantity, a customer or a sale; the terminal fetches the
// authoritative availability itself. Authorization comes from the session (never a channel name) and is checked again on every poll, so a
// revoked outlet stops at once; the stream ends after a few minutes and the browser reconnects through the full session checks.
const POLL_MILLISECONDS = 500;
const HEARTBEAT_MILLISECONDS = 15_000;
const LIFETIME_MILLISECONDS = 5 * 60_000;

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const scope = { outletId: search.get("outletId"), terminalId: search.get("terminalId") };
  const resumeFrom = request.headers.get("last-event-id") ?? search.get("after");
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.view" }, async ({ client, session }) => {
    const context = posContext(session);
    // Checks access now (an unauthorised outlet is refused before any stream starts) and finds where to begin.
    const first = await listPosInventoryChanges(client, context, { ...scope, after: resumeFrom });
    const encoder = new TextEncoder();
    const sent = new Map<string, number>();
    let cursor = first.cursor;
    let closed = false;
    const stream = new ReadableStream({
      start(controller) {
        const write = (chunk: string) => { if (!closed) controller.enqueue(encoder.encode(chunk)); };
        const close = () => { if (!closed) { closed = true; controller.close(); } };
        const deliver = (events: typeof first.events) => {
          const now = Date.now();
          for (const [id, at] of sent) if (now - at > 60_000) sent.delete(id);
          for (const event of events) {
            if (sent.has(event.eventId)) continue;
            sent.set(event.eventId, now);
            write(`id: ${Math.max(cursor, event.sequence)}\nevent: availability\ndata: ${JSON.stringify(event)}\n\n`);
          }
        };
        request.signal.addEventListener("abort", close);
        write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ cursor, warehouseIds: first.warehouseIds })}\n\n`);
        deliver(first.events);
        const started = Date.now();
        let lastWrite = Date.now();
        // Polled in the background: the response starts streaming at once.
        void (async () => {
        while (!closed) {
          await new Promise((resolve) => setTimeout(resolve, POLL_MILLISECONDS));
          if (closed) break;
          if (Date.now() - started > LIFETIME_MILLISECONDS) { write("event: rotate\ndata: {}\n\n"); close(); break; }
          try {
            const next = await tenantTransaction(session.organizationId, (tx) => listPosInventoryChanges(tx, context, { ...scope, after: cursor }));
            if (next.events.length) { deliver(next.events); lastWrite = Date.now(); }
            cursor = next.cursor;
          } catch (error) {
            const code = (error as { code?: string }).code ?? "POS_INVENTORY_UNAVAILABLE";
            write(`event: ${code === "POS_INVENTORY_PERMISSION_DENIED" || code === "FORBIDDEN" ? "denied" : "unavailable"}\ndata: ${JSON.stringify({ code })}\n\n`);
            close();
            break;
          }
          if (Date.now() - lastWrite > HEARTBEAT_MILLISECONDS) { write(": keep-alive\n\n"); lastWrite = Date.now(); }
        }
        })();
      },
      cancel() { closed = true; },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
    });
  });
}
