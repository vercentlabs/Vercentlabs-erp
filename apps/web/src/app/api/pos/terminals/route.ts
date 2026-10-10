import { z } from "zod";

import { createTerminal, listTerminals } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

const FILTERS = ["view", "search", "status", "state", "outletId", "cash"] as const;

// ?view=all|active|inactive|session_open|available, ?search=, ?outletId=, ?state=available|session_open, ?cash=yes|no
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return posRead(request, (client, context) => listTerminals(client, context, filters), "pos.terminals.view");
}

// Active when its outlet is; inherits everything it does not override.
export async function POST(request: Request) {
  return posMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ terminal: await createTerminal(client, context, input) }), 201,
    "pos.terminals.view");
}
