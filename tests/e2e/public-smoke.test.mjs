import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.E2E_BASE_URL?.replace(/\/$/, "");

test(
  "deployed public site responds with production security headers",
  { skip: baseUrl ? false : "Set E2E_BASE_URL to run deployment smoke tests." },
  async () => {
    const response = await fetch(baseUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(response.status >= 200 && response.status < 400);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy") || "", /default-src/);
  },
);
