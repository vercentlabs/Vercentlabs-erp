import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertStorageKey, createLocalObjectStorage, createMemoryObjectStorage, defineObjectStorage } from "../src/index.js";
import { renderDocumentPdf, safePdfFileName, validateDocumentModel } from "../src/pdf.js";

test("storage keys are opaque internal identifiers; traversal and odd keys are refused", () => {
  assert.equal(assertStorageKey("organizations/1/attachments/a.pdf"), "organizations/1/attachments/a.pdf");
  for (const bad of ["../etc/passwd", "a/../b", "/absolute", "a//b", "", "https://x"]) assert.throws(() => assertStorageKey(bad), bad);
  assert.throws(() => defineObjectStorage({ name: "x", put() {}, get() {} }), /remove/);
});

test("memory storage: put, head, get, remove", async () => {
  const storage = createMemoryObjectStorage();
  await storage.put("k/one.txt", Buffer.from("hello"), { contentType: "text/plain" });
  assert.deepEqual(await storage.head("k/one.txt"), { size: 5, contentType: "text/plain" });
  assert.equal((await storage.get("k/one.txt")).toString(), "hello");
  await storage.remove("k/one.txt");
  assert.equal(await storage.head("k/one.txt"), null);
  await assert.rejects(storage.get("k/one.txt"), (error) => error.code === "OBJECT_NOT_FOUND");
});

test("local storage stays inside its root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vl-storage-"));
  try {
    const storage = await createLocalObjectStorage({ root });
    await storage.put("organizations/o/attachments/a.txt", Buffer.from("abc"));
    assert.equal((await storage.get("organizations/o/attachments/a.txt")).toString(), "abc");
    assert.equal((await storage.head("organizations/o/attachments/a.txt")).size, 3);
    await assert.rejects(storage.get("../outside.txt"));
    await storage.remove("organizations/o/attachments/a.txt");
    assert.equal(await storage.head("organizations/o/attachments/a.txt"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PDF: renders a validated model; refuses malformed ones; safe file names", async () => {
  const pdf = await renderDocumentPdf({
    title: "Sales order",
    documentNumber: "SO-00001",
    organizationName: "Acme <script>alert(1)</script>",
    table: { columns: [{ key: "item", label: "Item" }, { key: "total", label: "Amount", align: "right" }], rows: [{ item: "Widget", total: "236.00" }] },
    totals: [{ label: "Total (INR)", value: "236.00", emphasis: true }],
  });
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.throws(() => validateDocumentModel({}), /title/);
  assert.throws(() => validateDocumentModel({ title: "x", table: { columns: "nope" } }));
  assert.equal(safePdfFileName("sales-order-SO/00001"), "sales-order-SO-00001.pdf");
  assert.equal(safePdfFileName("../../etc/passwd"), "etc-passwd.pdf");
  assert.equal(safePdfFileName(""), "document.pdf");
});
