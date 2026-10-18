import { unsubscribeFromMailing } from "@vercentlabs/api/crm";

import { ingressTransaction } from "@/core/db";

// Unsubscribe from campaign emails (CRM plan 5.8). GET shows the button (mail scanners that open links never unsubscribe anyone);
// POST — the button, or a mail app's one-click List-Unsubscribe-Post — adds the address to the opt-out list for email.
type Params = { params: Promise<{ token: string }> };
const page = (body: string) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#0f172a}button{font:inherit;padding:.6rem 1rem;border-radius:.5rem;border:1px solid #0f172a;background:#0f172a;color:#fff;cursor:pointer}</style>
</head><body>${body}</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" } });

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  if (!/^[0-9a-f]{48}$/.test(token)) return page("<p>This link is not valid.</p>");
  return page(`<h1>Stop these emails?</h1><p>You will not receive campaign emails from us at this address again.</p><form method="post"><button type="submit">Unsubscribe</button></form>`);
}

export async function POST(_request: Request, { params }: Params) {
  const { token } = await params;
  const result = await ingressTransaction((client) => unsubscribeFromMailing(client, token)).catch(() => ({ done: false }));
  return page(result.done ? "<h1>You are unsubscribed</h1><p>We will not send campaign emails to this address again.</p>" : "<p>This link is not valid any more.</p>");
}
