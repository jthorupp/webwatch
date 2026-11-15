import test from "node:test";
import assert from "node:assert/strict";
import { version } from "./index.js";

test("core exposes its package version", () => {
  assert.equal(version, "0.1.0");
});
