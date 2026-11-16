import assert from "node:assert/strict";
import test from "node:test";
import type { ScanResult } from "@webwatch/core";
import { formatScanJson } from "./report.js";
import { runScanCommand } from "./scan-command.js";

function createResult(): ScanResult {
  return {
    startUrl: "https://example.com/",
    discoveredUrls: ["https://example.com/", "https://example.com/missing.png"],
    pages: [{
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      statusCode: 200,
      contentType: "text/html",
      links: [],
      internalLinks: [],
      resources: [],
    }],
    stats: {
      pagesVisited: 1,
      pagesSucceeded: 1,
      pagesFailed: 0,
      linksFound: 1,
      uniqueUrlsDiscovered: 2,
      externalLinksSkipped: 0,
      duplicateLinksSkipped: 0,
      linksTruncated: 0,
      resourcesTruncated: 0,
      pagesTruncated: 0,
      redirectsFollowed: 0,
      durationMs: 18,
    },
    findings: [{
      id: "broken-image:https%3A%2F%2Fexample.com%2Fmissing.png",
      type: "broken-image",
      severity: "error",
      url: "https://example.com/missing.png",
      message: "Image returned HTTP 404.",
      evidence: { statusCode: 404, sourceUrls: ["https://example.com/"] },
    }],
    resourceChecksTruncated: true,
  };
}

test("serializes structured JSON deterministically with findings, stats, and completeness", async () => {
  const result = createResult();
  result.stats.pagesTruncated = 2;
  result.stats.linksTruncated = 3;
  result.stats.resourcesTruncated = 4;
  result.stats.pagesFailed = 1;
  const first = formatScanJson(result);
  assert.equal(formatScanJson(result), first);

  const parsed: unknown = JSON.parse(first);
  assert.deepEqual(parsed, {
    ...result,
    completeness: {
      isComplete: false,
      reasons: [
        { type: "pages-failed", count: 1 },
        { type: "pages-truncated", count: 2 },
        { type: "links-truncated", count: 3 },
        { type: "resources-truncated", count: 4 },
        { type: "resource-checks-truncated" },
      ],
    },
  });

  const extended = createResult();
  Object.assign(extended, { internalDebugInfo: "must not be serialized" });
  Object.assign(extended.stats, { internalCounter: 42 });
  Object.assign(extended.pages[0] ?? {}, { internalCacheKey: "private" });
  Object.assign(extended.findings[0] ?? {}, { internalDebugInfo: "private" });
  Object.assign(extended.findings[0]?.evidence ?? {}, { internalResolverData: "private" });
  const projected = JSON.parse(formatScanJson(extended)) as {
    internalDebugInfo?: string;
    stats: { internalCounter?: number };
    pages: Array<{ internalCacheKey?: string }>;
    findings: Array<{ internalDebugInfo?: string; evidence: { internalResolverData?: string } }>;
  };
  assert.equal(projected.internalDebugInfo, undefined);
  assert.equal(projected.stats.internalCounter, undefined);
  assert.equal(projected.pages[0]?.internalCacheKey, undefined);
  assert.equal(projected.findings[0]?.internalDebugInfo, undefined);
  assert.equal(projected.findings[0]?.evidence.internalResolverData, undefined);
});

test("marks failed page fetches as incomplete even without another truncation limit", () => {
  const result = createResult();
  result.stats.pagesFailed = 1;
  result.stats.pagesSucceeded = 0;
  result.resourceChecksTruncated = false;

  const parsed = JSON.parse(formatScanJson(result)) as {
    completeness: { isComplete: boolean; reasons: Array<{ type: string; count?: number }> };
  };
  assert.equal(parsed.completeness.isComplete, false);
  assert.deepEqual(parsed.completeness.reasons, [{ type: "pages-failed", count: 1 }]);
});

test("writes only JSON to stdout and preserves finding exit code 1", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runScanCommand(
    "https://example.com/",
    {},
    "json",
    { stdout: (message) => stdout.push(message), stderr: (message) => stderr.push(message) },
    async () => createResult(),
  );

  assert.equal(stdout.length, 1);
  const parsed = JSON.parse(stdout[0] ?? "") as { findings: Array<{ severity: string }> };
  assert.equal(parsed.findings[0]?.severity, "error");
  assert.deepEqual(stderr, []);
  assert.equal(exitCode, 1);
});

test("keeps human-readable output as the default format", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const clean = createResult();
  clean.findings = [];
  clean.resourceChecksTruncated = false;
  const exitCode = await runScanCommand(
    "https://example.com/",
    {},
    undefined,
    { stdout: (message) => stdout.push(message), stderr: (message) => stderr.push(message) },
    async () => clean,
  );

  assert.match(stdout[0] ?? "", /^WebWatch scan: .*\nResult: CLEAN/);
  assert.deepEqual(stderr, []);
  assert.equal(exitCode, 0);
});

test("preserves clean and incomplete exit codes in JSON mode", async () => {
  const output = { stdout: () => {}, stderr: () => {} };
  const clean = createResult();
  clean.findings = [];
  clean.resourceChecksTruncated = false;
  assert.equal(await runScanCommand("https://example.com/", {}, "json", output, async () => clean), 0);

  const incomplete = createResult();
  incomplete.findings = [];
  assert.equal(await runScanCommand("https://example.com/", {}, "json", output, async () => incomplete), 2);
});

test("writes scan runtime errors to stderr without contaminating JSON stdout", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runScanCommand(
    "https://example.com/",
    {},
    "json",
    { stdout: (message) => stdout.push(message), stderr: (message) => stderr.push(message) },
    async () => { throw new Error("Network unavailable."); },
  );

  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ["Network unavailable."]);
  assert.equal(exitCode, 1);
});
