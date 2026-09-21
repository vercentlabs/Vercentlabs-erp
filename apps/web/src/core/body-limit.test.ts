import { test } from "node:test";
import assert from "node:assert/strict";

import { readJsonBody } from "./body-limit.ts";
import { HttpError } from "./http-errors.ts";

function post(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/x", { method: "POST", body, headers });
}
const status = (code: number) => (e: unknown) => e instanceof HttpError && e.status === code;

test("reads normal JSON", async () => {
  assert.deepEqual(await readJsonBody(post(JSON.stringify({ a: 1 }))), { a: 1 });
});

test("rejects a declared oversize body with 413", async () => {
  await assert.rejects(readJsonBody(post("{}", { "content-length": "999999" })), status(413));
});

test("rejects an oversize body even when Content-Length lies", async () => {
  const big = JSON.stringify({ s: "x".repeat(200_000) });
  await assert.rejects(readJsonBody(post(big, { "content-length": "10" })), status(413));
});

test("counts bytes, not characters, for multibyte payloads", async () => {
  const big = JSON.stringify({ s: "₹".repeat(40_000) });
  assert.ok(big.length < 100_000 && Buffer.byteLength(big) > 100_000);
  await assert.rejects(readJsonBody(post(big)), status(413));
});

test("empty and malformed bodies are 400", async () => {
  await assert.rejects(readJsonBody(post("")), status(400));
  await assert.rejects(readJsonBody(post("{nope")), status(400));
});
