import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const forgotPassword = fs.readFileSync(
  "src/app/(auth)/forgot-password/page.tsx",
  "utf8",
);
const styles = fs.readFileSync("src/app/globals.css", "utf8");

test("forgot-password uses the viewport-constrained authentication layout", () => {
  assert.match(forgotPassword, /pageClassName="viewport-auth-page"/);
  assert.match(
    styles,
    /\.viewport-auth-page\s*\{[^}]*height:\s*100dvh[^}]*overflow:\s*hidden/s,
  );
  assert.match(
    styles,
    /\.viewport-auth-page \.auth-form-panel\s*\{[^}]*overflow-y:\s*auto/s,
  );
});
