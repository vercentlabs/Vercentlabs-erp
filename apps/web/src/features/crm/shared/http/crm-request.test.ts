import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  RequestError,
  requestJson,
} from "../../../../shared/http/request-json.ts";
import { CrmApiError } from "./crm-api-error.ts";
import { crmRequest, parseCrmResponse } from "./crm-request.ts";
import {
  AccountApiError,
  createAccount,
} from "../../customers/accounts/api/accounts-api.ts";
import {
  ContactApiError,
  createContact,
} from "../../customers/contacts/api/contacts-api.ts";
import {
  LeadApiError,
  createLead,
} from "../../customers/leads/api/leads-api.ts";
import {
  MeetingApiError,
  getMeeting,
} from "../../work/meetings/api/meetings-api.ts";
import { CallApiError } from "../../work/calls/api/calls-api.ts";
import {
  LeadLifecycleApiError,
  createLeadStage,
} from "../../setup/lead-lifecycle/api/lead-lifecycle-api.ts";
import { AttachmentApiError, uploadAttachment } from "../attachments-api.ts";
import {
  ImportExportApiError,
  analyzeLeadImportRequest,
} from "../../data/import-export/api/import-export-api.ts";
import {
  PublicBookingApiError,
  getPublicMeetingLink,
} from "../../public/booking/api/public-booking-api.ts";
import { getCrmOptions } from "../crm-options-api.ts";

type Sent = { url: string; init?: RequestInit };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function respond(status: number, body: string | null): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url, init });
    return new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return sent;
}
const json = (value: unknown) => JSON.stringify(value);
const response = (status: number, body: string | null) =>
  new Response(body, { status });

// --- shared parser ------------------------------------------------------------

test("parseCrmResponse returns the full successful payload unchanged", async () => {
  const payload = { ok: true, record: { id: "r1" }, rows: [1, 2] };
  assert.deepEqual(
    await parseCrmResponse(response(200, json(payload))),
    payload,
  );
});

test("parseCrmResponse throws on non-2xx and on ok:false with the server message, status and code", async () => {
  await assert.rejects(
    parseCrmResponse(
      response(403, json({ message: "Denied.", code: "CRM_FORBIDDEN" })),
    ),
    (error: unknown) => {
      assert.ok(error instanceof CrmApiError);
      assert.deepEqual(
        [error.message, error.status, error.code],
        ["Denied.", 403, "CRM_FORBIDDEN"],
      );
      assert.equal(
        "details" in error,
        false,
        "no details unless the client keeps them",
      );
      return true;
    },
  );
  await assert.rejects(
    parseCrmResponse(response(200, json({ ok: false, message: "Nope." }))),
    { message: "Nope.", status: 200 },
  );
});

test("parseCrmResponse falls back to the CRM message for 5xx, message-less and malformed bodies", async () => {
  for (const [status, body] of [
    [500, "<html>oops</html>"],
    [422, json({ code: "X" })],
    [502, ""],
  ] as const)
    await assert.rejects(parseCrmResponse(response(status, body)), {
      message: "The request could not be completed.",
      status,
    });
  // An unreadable successful body counts as {} (not a JSON parse error).
  assert.deepEqual(await parseCrmResponse(response(200, "not json")), {});
  assert.deepEqual(await parseCrmResponse(response(204, null)), {});
});

test("parseCrmResponse keeps the whole body or the details field only when asked", async () => {
  const body = {
    message: "Duplicate.",
    code: "D",
    matches: [{ id: "m1" }],
    canOverride: true,
    details: { a: 1 },
  };
  await assert.rejects(
    parseCrmResponse(response(409, json(body)), CrmApiError, "body"),
    (e: CrmApiError) => (assert.deepEqual(e.details, body), true),
  );
  await assert.rejects(
    parseCrmResponse(response(409, json(body)), CrmApiError, "details-field"),
    (e: CrmApiError) => (assert.deepEqual(e.details, { a: 1 }), true),
  );
});

test("a literal null body is an empty payload (the old per-file parsers crashed with a TypeError here)", async () => {
  assert.equal(await parseCrmResponse(response(200, "null")), null);
  await assert.rejects(
    parseCrmResponse(response(500, "null"), CallApiError),
    (e: unknown) => e instanceof CallApiError && e.status === 500,
  );
});

test("crmRequest sends JSON bodies with a JSON Content-Type and passes plain requests through", async () => {
  const sent = respond(200, json({ ok: true }));
  await crmRequest("/api/crm/x", { method: "POST", json: { a: 1 } });
  await crmRequest("/api/crm/x", { method: "DELETE" });
  await crmRequest("/api/crm/x", undefined);
  assert.deepEqual(sent[0].init, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"a":1}',
  });
  assert.deepEqual(sent[1].init, { method: "DELETE" });
  assert.equal(sent[2].init, undefined);
});

test("requestJson keeps its own contract (RequestError, generic fallback)", async () => {
  respond(403, json({ message: "No.", code: "C" }));
  await assert.rejects(
    requestJson("/api/x"),
    (e: unknown) =>
      e instanceof RequestError &&
      e.name === "RequestError" &&
      e.status === 403 &&
      e.code === "C",
  );
  respond(500, "oops");
  await assert.rejects(requestJson("/api/x"), {
    message: "Something went wrong.",
  });
});

// --- feature error compatibility ---------------------------------------------

test("Lead duplicate refusals reach the form as LeadApiError with matches and canOverride", async () => {
  const body = {
    ok: false,
    message: "Possible duplicate.",
    code: "CRM_LEAD_DUPLICATE_PROBABLE",
    matches: [{ id: "l2", name: "Asha" }, { restricted: true }],
    canOverride: true,
  };
  const sent = respond(409, json(body));
  await assert.rejects(createLead({ firstName: "Asha" }), (error: unknown) => {
    assert.ok(error instanceof LeadApiError);
    assert.ok(error instanceof CrmApiError);
    assert.ok(error instanceof Error);
    assert.equal(error.name, "Error");
    assert.equal(error.code, "CRM_LEAD_DUPLICATE_PROBABLE");
    assert.deepEqual(error.details.matches, body.matches);
    assert.equal(error.details.canOverride, true);
    return true;
  });
  assert.equal(sent[0].url, "/api/crm/leads");
  assert.deepEqual(sent[0].init, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"firstName":"Asha"}',
  });
});

test("Account and Contact exact-duplicate refusals keep the matches the forms render", async () => {
  const body = {
    message: "Exact duplicate.",
    code: "CRM_ACCOUNT_DUPLICATE_EXACT",
    matches: [{ id: "a2" }],
  };
  respond(409, json(body));
  await assert.rejects(
    createAccount({ name: "Acme" }),
    (e: unknown) =>
      e instanceof AccountApiError &&
      e instanceof CrmApiError &&
      (e.details.matches as unknown[]).length === 1,
  );
  respond(409, json({ ...body, code: "CRM_CONTACT_DUPLICATE_EXACT" }));
  await assert.rejects(
    createContact({ firstName: "R" }),
    (e: unknown) =>
      e instanceof ContactApiError && e.code === "CRM_CONTACT_DUPLICATE_EXACT",
  );
  // Constructed directly (as screens do), the rich classes default details to {}.
  assert.deepEqual(new LeadApiError("m", 400).details, {});
});

test("ordinary clients throw their own class with message/status/code and no details", async () => {
  respond(
    404,
    json({ message: "Meeting not found.", code: "CRM_MEETING_NOT_FOUND" }),
  );
  await assert.rejects(getMeeting("m1"), (e: unknown) => {
    assert.ok(e instanceof MeetingApiError && e instanceof CrmApiError);
    assert.deepEqual(
      [e.message, e.status, e.code, Object.keys(e)],
      ["Meeting not found.", 404, "CRM_MEETING_NOT_FOUND", ["status", "code"]],
    );
    assert.equal(
      e instanceof LeadApiError,
      false,
      "feature classes stay distinct",
    );
    return true;
  });
});

test("Lead lifecycle errors always carry the response's details field", async () => {
  respond(
    409,
    json({
      message: "In use.",
      code: "CRM_LEAD_STAGE_IN_USE",
      details: { leads: 3 },
    }),
  );
  await assert.rejects(
    createLeadStage({ name: "X" }),
    (e: unknown) =>
      e instanceof LeadLifecycleApiError &&
      (e.details as { leads: number }).leads === 3,
  );
  respond(400, json({ message: "Invalid." }));
  await assert.rejects(
    createLeadStage({}),
    (e: unknown) =>
      e instanceof LeadLifecycleApiError &&
      "details" in e &&
      e.details === undefined,
  );
});

// --- special transports -------------------------------------------------------

test("attachment upload keeps its multipart request and parses failures as AttachmentApiError", async () => {
  const sent = respond(
    413,
    json({ message: "File too large.", code: "CRM_ATTACHMENT_TOO_LARGE" }),
  );
  const file = new File(["hello"], "note.txt", { type: "text/plain" });
  await assert.rejects(
    uploadAttachment("lead", "l1", file, "logical-1"),
    (e: unknown) =>
      e instanceof AttachmentApiError &&
      e.status === 413 &&
      e.code === "CRM_ATTACHMENT_TOO_LARGE",
  );
  assert.equal(sent[0].url, "/api/crm/attachments/lead/l1");
  assert.equal(sent[0].init?.method, "POST");
  assert.equal(
    sent[0].init?.headers,
    undefined,
    "the browser sets the multipart boundary",
  );
  const form = sent[0].init?.body as FormData;
  assert.ok(form instanceof FormData);
  assert.equal((form.get("file") as File).name, "note.txt");
  assert.equal(form.get("replacesLogicalId"), "logical-1");
});

test("lead import analysis keeps its multipart request and parses failures as ImportExportApiError", async () => {
  const sent = respond(
    400,
    json({ message: "Not a CSV.", code: "CRM_IMPORT_INVALID" }),
  );
  await assert.rejects(
    analyzeLeadImportRequest(new File(["a,b"], "leads.csv")),
    (e: unknown) =>
      e instanceof ImportExportApiError && e.code === "CRM_IMPORT_INVALID",
  );
  assert.ok(sent[0].init?.body instanceof FormData);
});

test("public booking requests stay plain unauthenticated fetches", async () => {
  const sent = respond(
    404,
    json({ message: "This booking link is no longer available." }),
  );
  await assert.rejects(
    getPublicMeetingLink("tok"),
    (e: unknown) => e instanceof PublicBookingApiError && e.status === 404,
  );
  assert.equal(
    sent[0].init,
    undefined,
    "no credentials, headers or workspace context are added",
  );
});

test("CRM options keep their plain Error and own fallback message", async () => {
  respond(500, "");
  await assert.rejects(
    getCrmOptions(),
    (e: unknown) =>
      e instanceof Error &&
      !(e instanceof CrmApiError) &&
      (e as Error).message === "Could not load CRM reference data.",
  );
});
