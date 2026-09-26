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
  assert.deepEqual(await storage.head("k/one.txt"), { size: 5, contentType: "text/plain", sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" });
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

import { createGcsObjectStorage } from "../src/gcs.js";

// A fake of the @google-cloud/storage surface the adapter uses: no network.
function fakeGcsClient() {
  const objects = new Map();
  const calls = [];
  const file = (name) => ({
    async save(bytes, options) {
      calls.push({ op: "save", name, options });
      objects.set(name, { bytes: Buffer.from(bytes), contentType: options.contentType, sha256: options.metadata.metadata.sha256 });
    },
    async download() {
      if (!objects.has(name)) throw Object.assign(new Error("No such object"), { code: 404 });
      return [objects.get(name).bytes];
    },
    async delete() {
      objects.delete(name);
    },
    async getMetadata() {
      const object = objects.get(name);
      if (!object) throw Object.assign(new Error("No such object"), { code: 404 });
      return [{ size: String(object.bytes.length), contentType: object.contentType, metadata: object.sha256 ? { sha256: object.sha256 } : {} }];
    },
  });
  return { client: { bucket: (bucket) => ({ file: (name) => file(`${bucket}:${name}`) }) }, objects, calls };
}

test("GCS adapter: private objects under a prefix, sha256 metadata, 404 mapping, probe", async () => {
  const fake = fakeGcsClient();
  const storage = await createGcsObjectStorage({ bucket: "erp-files", prefix: "prod", client: fake.client });
  await storage.put("organizations/o/attachments/a.txt", Buffer.from("abc"), { contentType: "text/plain", sha256: "d".repeat(64) });
  assert.ok(fake.objects.has("erp-files:prod/organizations/o/attachments/a.txt"));
  assert.equal(fake.calls[0].options.metadata.cacheControl, "private, no-store");
  assert.equal(fake.calls[0].options.resumable, false);
  assert.deepEqual(await storage.head("organizations/o/attachments/a.txt"), { size: 3, contentType: "text/plain", sha256: "d".repeat(64) });
  assert.equal((await storage.get("organizations/o/attachments/a.txt")).toString(), "abc");
  assert.equal(await storage.head("organizations/o/attachments/missing.txt"), null);
  await assert.rejects(storage.get("organizations/o/attachments/missing.txt"), (error) => error.code === "OBJECT_NOT_FOUND");
  await assert.rejects(storage.get("../escape"));
  assert.equal(await storage.probe(), true, "a missing probe object means reachable and authorized");
  await storage.remove("organizations/o/attachments/a.txt");
  assert.equal(fake.objects.size, 0);
  await assert.rejects(createGcsObjectStorage({ bucket: "", client: fake.client }), /bucket/);
  await assert.rejects(createGcsObjectStorage({ bucket: "b", prefix: "../x", client: fake.client }), /prefix/);
});
