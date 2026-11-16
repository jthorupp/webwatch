import assert from "node:assert/strict";
import test from "node:test";
import { isValidHttpUrl, parseCommand } from "../src/index.js";

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
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--max-pages", "5", "--concurrency", "3"]), {
    command: { name: "scan", url: "https://example.com", maxPages: 5, concurrency: 3 },
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--format", "json"]), {
    command: { name: "scan", url: "https://example.com", format: "json" },
  });
  assert.deepEqual(parseCommand([
    "scan", "https://example.com", "--format", "json", "--concurrency", "3", "--max-pages", "25",
  ]), {
    command: { name: "scan", url: "https://example.com", format: "json", concurrency: 3, maxPages: 25 },
  });
});

test("rejects malformed commands and invalid scan URLs", () => {
  assert.deepEqual(parseCommand(["scan"]), {
    error: "Usage: webwatch scan <url> [--max-pages <number>] [--concurrency <number>] [--format json]",
  });
  assert.deepEqual(parseCommand(["scan", "file:///tmp/page"]), {
    error: "Invalid URL. Use an absolute http:// or https:// URL without credentials.",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--max-pages", "0"]), {
    error: "--max-pages must be an integer from 1 to 1000.",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--concurrency", "33"]), {
    error: "--concurrency must be an integer from 1 to 32.",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--format", "yaml"]), {
    error: "--format only supports json.",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--format"]), {
    error: "--format requires a value: json.",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--format", "json", "--format", "json"]), {
    error: "--format may only be specified once.",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--max-pages", "10", "--max-pages", "20"]), {
    error: "--max-pages may only be specified once.",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--concurrency", "2", "--concurrency", "3"]), {
    error: "--concurrency may only be specified once.",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--max-pages"]), {
    error: "--max-pages requires a value.",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--concurrency"]), {
    error: "--concurrency requires a value.",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--max-pages", "--format", "json"]), {
    error: "--max-pages requires a value.",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--format", "--max-pages", "5"]), {
    error: "--format requires a value: json.",
  });
  assert.deepEqual(parseCommand(["unknown"]), { error: "Unknown command: unknown" });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--unknown"]), {
    error: "Usage: webwatch scan <url> [--max-pages <number>] [--concurrency <number>] [--format json]",
  });
  assert.deepEqual(parseCommand(["scan", "https://example.com", "--unknown", "value"]), {
    error: "Usage: webwatch scan <url> [--max-pages <number>] [--concurrency <number>] [--format json]",
  });
});

test("accepts only absolute HTTP and HTTPS URLs", () => {
  assert.equal(isValidHttpUrl("http://localhost:3000"), true);
  assert.equal(isValidHttpUrl("https://example.com"), true);
  assert.equal(isValidHttpUrl("example.com"), false);
  assert.equal(isValidHttpUrl("javascript:alert(1)"), false);
});

