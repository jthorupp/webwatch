import assert from "node:assert/strict";
import test from "node:test";
import { isValidHttpUrl, parseCommand } from "./index.js";

test("parses help and version options", () => {
  assert.deepEqual(parseCommand(["--help"]), { command: { name: "help" } });
  assert.deepEqual(parseCommand(["-v"]), { command: { name: "version" } });
});

test("parses init and scan commands", () => {
  assert.deepEqual(parseCommand(["init"]), { command: { name: "init" } });
  assert.deepEqual(parseCommand(["scan", "https://example.com/path"]), {
    command: { name: "scan", url: "https://example.com/path" },
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--max-pages", "5"]), {
    command: { name: "scan", url: "https://example.com", maxPages: 5 },
  });
});

test("rejects malformed commands and invalid scan URLs", () => {
  assert.deepEqual(parseCommand(["scan"]), {
    error: "Usage: webwatch scan <url> [--max-pages <number>]",
  });
  assert.deepEqual(parseCommand(["scan", "file:///tmp/page"]), {
    error: "Invalid URL. Use an absolute http:// or https:// URL without credentials.",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--max-pages", "0"]), {
    error: "--max-pages must be an integer from 1 to 1000.",
  });
  assert.deepEqual(parseCommand(["unknown"]), { error: "Unknown command: unknown" });
});

test("accepts only absolute HTTP and HTTPS URLs", () => {
  assert.equal(isValidHttpUrl("http://localhost:3000"), true);
  assert.equal(isValidHttpUrl("https://example.com"), true);
  assert.equal(isValidHttpUrl("example.com"), false);
  assert.equal(isValidHttpUrl("javascript:alert(1)"), false);
});
