import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_LOCALE, resolveLocale } from "./resolve-locale.ts";

test("valid stored locales are kept", () => {
  assert.equal(resolveLocale("en-US"), "en-US");
  assert.equal(resolveLocale("hi-IN"), "hi-IN");
});

test("missing or malformed locales fall back", () => {
  assert.equal(resolveLocale(null), DEFAULT_LOCALE);
  assert.equal(resolveLocale(""), DEFAULT_LOCALE);
  assert.equal(resolveLocale("not a locale!!"), DEFAULT_LOCALE);
});
