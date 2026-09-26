// Server-side CSV parsing for imports and the data-exchange registry.
import assert from "node:assert/strict";
import test from "node:test";

import { rowsToCsv } from "@vercentlabs/reporting-engine";

import { parseCsvUpload } from "../../src/core/platform/data-exchange/index.js";
import { DATA_EXCHANGE_DEFINITIONS } from "../../src/orchestration/data-exchange/registry.js";

const csv = (text) => Buffer.from(text, "utf8");
const code = (expected) => (error) => error.code === expected;

test("RFC 4180: quotes, escaped quotes, commas and newlines inside quotes; BOM removed", () => {
  const parsed = parseCsvUpload(csv('﻿Name,Notes\r\n"Asha ""A"" Rao","line one\nline two, with comma"\r\nRavi,plain\r\n'));
  assert.deepEqual(parsed.headers, ["Name", "Notes"]);
  assert.deepEqual(parsed.records, [
    { Name: 'Asha "A" Rao', Notes: "line one\nline two, with comma" },
    { Name: "Ravi", Notes: "plain" },
  ]);
  assert.equal(parsed.rowCount, 2);
});

test("malformed CSV, inconsistent columns and bad encodings are refused", () => {
  assert.throws(() => parseCsvUpload(csv('Name\n"unterminated\n')), code("CSV_MALFORMED"));
  assert.throws(() => parseCsvUpload(csv("A,B\n1,2,3\n")), code("CSV_MALFORMED"));
  assert.throws(() => parseCsvUpload(Buffer.from([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0xff, 0xfe, 0x41])), code("CSV_ENCODING_INVALID"));
  assert.throws(() => parseCsvUpload(csv("")), code("CSV_EMPTY"));
});

test("headers must be present and unique (case and spacing ignored)", () => {
  assert.throws(() => parseCsvUpload(csv("Email,email \n a,b\n")), code("CSV_DUPLICATE_HEADER"));
  assert.throws(() => parseCsvUpload(csv("Name,,City\na,b,c\n")), code("CSV_HEADER_EMPTY"));
});

test("row, column, field and size caps", () => {
  const rows = ["Name", ...Array.from({ length: 11 }, (_, index) => `n${index}`)].join("\n");
  assert.throws(() => parseCsvUpload(csv(rows), { maxRows: 10 }), code("CSV_TOO_MANY_ROWS"));
  assert.equal(parseCsvUpload(csv(rows), { maxRows: 11 }).rowCount, 11);
  assert.throws(() => parseCsvUpload(csv(`${Array.from({ length: 5 }, (_, i) => `c${i}`).join(",")}\n1,2,3,4,5\n`), { maxColumns: 4 }), code("CSV_TOO_MANY_COLUMNS"));
  assert.throws(() => parseCsvUpload(csv(`Notes\n${"x".repeat(51)}\n`), { maxFieldLength: 50 }), code("CSV_FIELD_TOO_LONG"));
  assert.throws(() => parseCsvUpload(csv("Name\nabc\n"), { maxBytes: 5 }), code("CSV_TOO_LARGE"));
});

test("values stay plain strings; formula cells are neutralised again on export", () => {
  const parsed = parseCsvUpload(csv('Name\n"=HYPERLINK(""http://evil"")"\n'));
  assert.equal(parsed.records[0].Name, '=HYPERLINK("http://evil")');
  assert.match(rowsToCsv([{ key: "Name", label: "Name" }], parsed.records), /'=HYPERLINK/);
});

test("the data-exchange registry lists only real, permissioned imports and exports", () => {
  for (const definition of DATA_EXCHANGE_DEFINITIONS) {
    assert.ok(definition.permissions.length > 0 && definition.maximumRows > 0 && definition.moduleKey, definition.key);
  }
  assert.deepEqual(DATA_EXCHANGE_DEFINITIONS.map((definition) => definition.key).sort(), ["crm.leads.export", "crm.leads.import"]);
});
