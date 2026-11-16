import type { CrawlPage, CrawlStats, Finding, FindingEvidence, ScanResult } from "@webwatch/core";

export function isScanIncomplete(result: ScanResult): boolean {
  return result.stats.pagesFailed > 0 ||
    result.resourceChecksTruncated ||
    result.stats.linksTruncated > 0 ||
    result.stats.resourcesTruncated > 0 ||
    result.stats.pagesTruncated > 0;
}

export function getScanExitCode(result: ScanResult): 0 | 1 | 2 {
  if (result.findings.some((finding) => finding.severity === "error")) return 1;
  if (isScanIncomplete(result)) return 2;
  return 0;
}

export type CompletenessReason =
  | { type: "pages-failed"; count: number }
  | { type: "pages-truncated"; count: number }
  | { type: "links-truncated"; count: number }
  | { type: "resources-truncated"; count: number }
  | { type: "resource-checks-truncated" };

type JsonScanPage = Pick<CrawlPage, "url" | "links" | "internalLinks" | "resources"> &
  Partial<Pick<CrawlPage, "finalUrl" | "statusCode" | "contentType" | "error">>;

type JsonScanStats = Pick<CrawlStats,
  | "pagesVisited"
  | "pagesSucceeded"
  | "pagesFailed"
  | "linksFound"
  | "uniqueUrlsDiscovered"
  | "externalLinksSkipped"
  | "duplicateLinksSkipped"
  | "linksTruncated"
  | "resourcesTruncated"
  | "pagesTruncated"
  | "redirectsFollowed"
  | "durationMs"
>;

type JsonFinding = Pick<Finding, "id" | "type" | "severity" | "url" | "message"> & {
  evidence: Pick<FindingEvidence, "sourceUrls"> & Partial<Pick<FindingEvidence, "statusCode" | "error">>;
};

export interface JsonScanResult {
  startUrl: string;
  discoveredUrls: string[];
  pages: JsonScanPage[];
  stats: JsonScanStats;
  findings: JsonFinding[];
  resourceChecksTruncated: boolean;
  completeness: {
    isComplete: boolean;
    reasons: CompletenessReason[];
  };
}

export function formatScanJson(result: ScanResult): string {
  const reasons: CompletenessReason[] = [];
  if (result.stats.pagesFailed > 0) reasons.push({ type: "pages-failed", count: result.stats.pagesFailed });
  if (result.stats.pagesTruncated > 0) reasons.push({ type: "pages-truncated", count: result.stats.pagesTruncated });
  if (result.stats.linksTruncated > 0) reasons.push({ type: "links-truncated", count: result.stats.linksTruncated });
  if (result.stats.resourcesTruncated > 0) {
    reasons.push({ type: "resources-truncated", count: result.stats.resourcesTruncated });
  }
  if (result.resourceChecksTruncated) reasons.push({ type: "resource-checks-truncated" });

  const structuredResult: JsonScanResult = {
    startUrl: result.startUrl,
    discoveredUrls: [...result.discoveredUrls],
    pages: result.pages.map((page) => ({
      url: page.url,
      ...(page.finalUrl === undefined ? {} : { finalUrl: page.finalUrl }),
      ...(page.statusCode === undefined ? {} : { statusCode: page.statusCode }),
      ...(page.contentType === undefined ? {} : { contentType: page.contentType }),
      links: [...page.links],
      internalLinks: [...page.internalLinks],
      resources: page.resources.map((resource) => ({ type: resource.type, url: resource.url })),
      ...(page.error === undefined ? {} : { error: page.error }),
    })),
    stats: {
      pagesVisited: result.stats.pagesVisited,
      pagesSucceeded: result.stats.pagesSucceeded,
      pagesFailed: result.stats.pagesFailed,
      linksFound: result.stats.linksFound,
      uniqueUrlsDiscovered: result.stats.uniqueUrlsDiscovered,
      externalLinksSkipped: result.stats.externalLinksSkipped,
      duplicateLinksSkipped: result.stats.duplicateLinksSkipped,
      linksTruncated: result.stats.linksTruncated,
      resourcesTruncated: result.stats.resourcesTruncated,
      pagesTruncated: result.stats.pagesTruncated,
      redirectsFollowed: result.stats.redirectsFollowed,
      durationMs: result.stats.durationMs,
    },
    findings: result.findings.map((finding) => ({
      id: finding.id,
      type: finding.type,
      severity: finding.severity,
      url: finding.url,
      message: finding.message,
      evidence: {
        ...(finding.evidence.statusCode === undefined ? {} : { statusCode: finding.evidence.statusCode }),
        sourceUrls: [...finding.evidence.sourceUrls],
        ...(finding.evidence.error === undefined ? {} : { error: finding.evidence.error }),
      },
    })),
    resourceChecksTruncated: result.resourceChecksTruncated,
    completeness: { isComplete: reasons.length === 0, reasons },
  };
  return JSON.stringify(structuredResult, null, 2);
}

export function formatScanReport(result: ScanResult): string {
  const incomplete = isScanIncomplete(result);
  const hasFindings = result.findings.length > 0;
  const state = hasFindings
    ? `FINDINGS${incomplete ? " (INCOMPLETE)" : ""}`
    : incomplete
      ? "INCOMPLETE"
      : "CLEAN";
  const lines = [
    `WebWatch scan: ${result.startUrl}`,
    `Result: ${state}`,
    `Pages: ${result.stats.pagesVisited} visited (${result.stats.pagesSucceeded} succeeded, ${result.stats.pagesFailed} failed); ${result.stats.uniqueUrlsDiscovered} discovered`,
    `Redirects followed: ${result.stats.redirectsFollowed}`,
    `Findings: ${result.findings.length}`,
  ];

  if (incomplete) {
    lines.push("Completeness:");
    if (result.stats.pagesFailed > 0) {
      lines.push(`- Could not inspect the content of ${result.stats.pagesFailed} failed page(s).`);
    }
    if (result.stats.pagesTruncated > 0) {
      lines.push(`- Page limit left ${result.stats.pagesTruncated} page(s) unvisited.`);
    }
    if (result.stats.linksTruncated > 0) {
      lines.push(`- URL discovery omitted ${result.stats.linksTruncated} link(s) at its safety limit.`);
    }
    if (result.stats.resourcesTruncated > 0) {
      lines.push(`- Resource extraction omitted ${result.stats.resourcesTruncated} reference(s) at its per-page limit.`);
    }
    if (result.resourceChecksTruncated) {
      lines.push("- Resource checks reached their safety limit; some targets were not checked.");
    }
  }

  if (hasFindings) {
    lines.push("Findings by severity and type:");
    for (const group of groupFindings(result.findings)) {
      lines.push(`${group.severity.toUpperCase()} / ${group.type} (${group.findings.length})`);
      for (const finding of group.findings) {
        lines.push(`- ${finding.url}`);
        lines.push(`  ${finding.message}`);
      }
    }
  }

  return lines.join("\n");
}

interface FindingGroup {
  severity: Finding["severity"];
  type: Finding["type"];
  findings: Finding[];
}

function groupFindings(findings: Finding[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const finding of findings) {
    const key = `${finding.severity}\0${finding.type}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { severity: finding.severity, type: finding.type, findings: [] };
      groups.set(key, group);
    }
    group.findings.push(finding);
  }

  return [...groups.values()]
    .sort((left, right) => compareStrings(left.severity, right.severity) || compareStrings(left.type, right.type))
    .map((group) => ({
      ...group,
      findings: group.findings.sort((left, right) =>
        compareStrings(left.url, right.url) || compareStrings(left.message, right.message)),
    }));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
