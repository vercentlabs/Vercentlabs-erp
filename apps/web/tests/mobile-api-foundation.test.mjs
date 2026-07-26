import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("mobile sessions rotate opaque tokens and detect refresh reuse", () => {
  const source = read("src/lib/mobile-session.ts");
  const migration = read(
    "../../database/control-plane/migrations/011_mobile_sessions.sql",
  );
  assert.match(source, /createOpaqueToken/);
  assert.match(source, /mobile_refresh_token_history/);
  assert.match(source, /refresh_token_reuse/);
  assert.match(source, /FOR UPDATE OF session/);
  assert.match(migration, /session_type IN \('browser', 'mobile'\)/);
  assert.match(migration, /mobile_idempotency_keys/);
});

test("native authentication is bearer-bound and does not weaken browser CSRF", () => {
  const auth = read("src/lib/auth.ts");
  const mobile = read("src/lib/mobile-session.ts");
  const browserLogin = read("src/app/api/auth/login/route.ts");
  const nativeLogin = read("src/app/api/mobile/v1/auth/login/route.ts");
  assert.match(auth, /session\.session_type = \$2/);
  assert.match(mobile, /\^Bearer/);
  assert.match(browserLogin, /assertSameOrigin\(request\)/);
  assert.doesNotMatch(nativeLogin, /setSessionCookie|assertSameOrigin/);
});

test("all mobile API responses are private and versioned", () => {
  const source = read("src/lib/mobile-http.ts");
  assert.match(source, /X-Vercentlabs-API-Version/);
  assert.match(source, /private, no-store/);
  assert.match(source, /X-Request-ID/);
});
