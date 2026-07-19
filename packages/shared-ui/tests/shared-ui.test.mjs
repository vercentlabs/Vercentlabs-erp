import assert from "node:assert/strict";
import test from "node:test";
import { StatusBadge } from "../src/index.js";

test("status badge exposes semantic reusable state", () => {
  const element = StatusBadge({ children: "Roadmap", tone: "roadmap" });
  assert.equal(element.type, "span");
  assert.match(element.props.className, /pending/);
});
