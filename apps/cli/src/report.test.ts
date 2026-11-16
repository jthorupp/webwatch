import assert from "node:assert/strict";
import test from "node:test";
import type { ScanResult } from "@webwatch/core";
import { formatScanReport, getScanExitCode } from "./report.js";

function createResult(): ScanResult {
  return {
    startUrl: "https://example.com/",
    discoveredUrls: ["https://example.com/"],
    pages: [],
    stats: {
      pagesVisited: 1,
      pagesSucceeded: 1,
      pagesFailed: 0,
      linksFound: 0,
      uniqueUrlsDiscovered: 1,
      externalLinksSkipped: 0,
      duplicateLinksSkipped: 0,
      linksTruncated: 0,
      resourcesTruncated: 0,
      pagesTruncated: 0,
      redirectsFollowed: 0,
      durationMs: 12,
    },
    findings: [],
    linkChecks: [],
    resourceChecksTruncated: false,
  };
}

test("formats a complete clean scan and returns exit code 0", () => {
  const result = createResult();

  assert.equal(formatScanReport(result), [
    "WebWatch scan: https://example.com/",
    "Result: CLEAN",
    "Pages: 1 visited (1 succeeded, 0 failed); 1 discovered",
    "Links: 0 passed, 0 failed, 0 unverified",
    "Redirects followed: 0",
    "Findings: 0",
  ].join("\n"));
  assert.equal(getScanExitCode(result), 0);
});

test("groups findings deterministically and returns exit code 1", () => {
  const result = createResult();
  result.findings = [
    {
      id: "broken-image:z",
      type: "broken-image",
      severity: "error",
      status: "failed",
      url: "https://example.com/z.png",
      message: "Image returned HTTP 404.",
      evidence: { statusCode: 404, sourceUrls: ["https://example.com/"] },
    },
    {
      id: "http-error:a",
      type: "http-error",
      severity: "error",
      status: "failed",
      url: "https://example.com/a",
      message: "Received HTTP 500.",
      evidence: { statusCode: 500, sourceUrls: ["https://example.com/"] },
    },
    {
      id: "broken-image:b",
      type: "broken-image",
      severity: "error",
      status: "failed",
      url: "https://example.com/b.png",
      message: "Image returned HTTP 404.",
      evidence: { statusCode: 404, sourceUrls: ["https://example.com/"] },
    },
  ];

  const report = formatScanReport(result);
  assert.equal(report.indexOf("ERROR / broken-image (2)"), report.lastIndexOf("ERROR / broken-image (2)"));
  assert.ok(report.indexOf("ERROR / broken-image (2)") < report.indexOf("ERROR / http-error (1)"));
  assert.ok(report.indexOf("https://example.com/b.png") < report.indexOf("https://example.com/z.png"));
  assert.match(report, /Result: FINDINGS/);
  assert.match(report, /Image returned HTTP 404\./);
  assert.equal(getScanExitCode(result), 1);
});

test("reports incomplete scans and returns exit code 2 unless findings exist", () => {
  const result = createResult();
  result.stats.pagesTruncated = 2;
  result.resourceChecksTruncated = true;

  const report = formatScanReport(result);
  assert.match(report, /Result: INCOMPLETE/);
  assert.match(report, /Page limit left 2 page\(s\) unvisited/);
  assert.match(report, /Resource checks reached their safety limit/);
  assert.equal(getScanExitCode(result), 2);

  result.findings.push({
    id: "http-error:a",
    type: "http-error",
    severity: "error",
    status: "failed",
    url: "https://example.com/a",
    message: "Received HTTP 500.",
    evidence: { statusCode: 500, sourceUrls: [] },
  });
  assert.match(formatScanReport(result), /Result: FINDINGS \(INCOMPLETE\)/);
  assert.equal(getScanExitCode(result), 1);
});

test("labels an unverified link without treating it as failed or clean", () => {
  const result = createResult();
  result.stats.pagesFailed = 1;
  result.stats.pagesSucceeded = 0;
  result.linkChecks = [{
    url: "https://example.com/about",
    sourceUrls: ["https://example.com/"],
    status: "unverified",
    reason: "cross-origin-redirect-blocked",
    error: "Blocked cross-origin redirect to https://about.example.net.",
  }];
  result.findings = [{
    id: "unverified-internal-link:about",
    type: "unverified-internal-link",
    severity: "warning",
    status: "unverified",
    url: "https://example.com/about",
    message: "This internal link was not verified because the crawler blocked a cross-origin redirect.",
    evidence: {
      sourceUrls: ["https://example.com/"],
      error: "Blocked cross-origin redirect to https://about.example.net.",
      reason: "cross-origin-redirect-blocked",
    },
  }];

  const report = formatScanReport(result);
  assert.match(report, /Result: UNVERIFIED \(INCOMPLETE\)/);
  assert.match(report, /Links: 0 passed, 0 failed, 1 unverified/);
  assert.match(report, /WARNING \/ unverified-internal-link/);
  assert.equal(getScanExitCode(result), 2);
});
