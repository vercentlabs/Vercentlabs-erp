import { getSupportDeskSettings, listSupportCategories, listSupportMailboxes, saveSupportCategory, saveSupportDeskSettings, saveSupportMailbox } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { supportMutation, supportRead } from "@/features/support/shared/route-helpers";

// Support settings: targets and the reopen policy, the support mailboxes, the categories. POST { what: settings | mailbox | category, ... }.
export async function GET(request: Request) {
  return supportRead(request, async (client, context) => ({
    settings: await getSupportDeskSettings(client, context), mailboxes: await listSupportMailboxes(client, context),
    categories: await listSupportCategories(client, context, { includeInactive: true }),
  }));
}
export async function POST(request: Request) {
  return supportMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (input.what) {
      case "settings": return saveSupportDeskSettings(client, context, input);
      case "mailbox": return saveSupportMailbox(client, context, input);
      case "category": return saveSupportCategory(client, context, input);
      default: throw new HttpError(400, "Say what to save.");
    }
  });
}
