import type { Finding, ScanResult } from "@webwatch/core";

export function isScanIncomplete(result: ScanResult): boolean {
  return result.resourceChecksTruncated ||
    result.stats.linksTruncated > 0 ||
    result.stats.pagesTruncated > 0;
}

export function getScanExitCode(result: ScanResult): 0 | 1 | 2 {
  if (result.findings.some((finding) => finding.severity === "error")) return 1;
  if (isScanIncomplete(result)) return 2;
  return 0;
}

export type CompletenessReason =
  | { type: "pages-truncated"; count: number }
  | { type: "links-truncated"; count: number }
  | { type: "resource-checks-truncated" };

export interface JsonScanResult extends ScanResult {
  completeness: {
    isComplete: boolean;
    reasons: CompletenessReason[];
  };
}

export function formatScanJson(result: ScanResult): string {
  const reasons: CompletenessReason[] = [];
  if (result.stats.pagesTruncated > 0) reasons.push({ type: "pages-truncated", count: result.stats.pagesTruncated });
  if (result.stats.linksTruncated > 0) reasons.push({ type: "links-truncated", count: result.stats.linksTruncated });
  if (result.resourceChecksTruncated) reasons.push({ type: "resource-checks-truncated" });

  const structuredResult: JsonScanResult = {
    ...result,
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
    if (result.stats.pagesTruncated > 0) {
      lines.push(`- Page limit left ${result.stats.pagesTruncated} page(s) unvisited.`);
    }
    if (result.stats.linksTruncated > 0) {
      lines.push(`- URL discovery omitted ${result.stats.linksTruncated} link(s) at its safety limit.`);
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
