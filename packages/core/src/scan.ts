import { crawlWithNetwork } from "./crawler.js";
import { loadPage, ResponseSizeLimitError } from "./crawler/http.js";
import { boundedInteger, resolvePublicAddresses } from "./crawler/url-safety.js";
import type { CrawlOptions, CrawlPage, CrawlResult, CrawlerNetworkForTests } from "./crawler/types.js";
import type { ResourceType } from "./crawler/html.js";
import type { Finding, FindingEvidence, FindingType } from "./finding.js";

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 32;
const MAX_CHECK_TARGETS = 10_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface ScanOptions extends CrawlOptions {
  concurrency?: number;
}

export interface ScanResult extends CrawlResult {
  findings: Finding[];
  resourceChecksTruncated: boolean;
}

interface TargetUse {
  url: string;
  internalLinkSources: Set<string>;
  resourceSources: Map<ResourceType, Set<string>>;
}

interface CheckResult {
  statusCode?: number;
  error?: string;
}

export async function scan(url: string, options: ScanOptions = {}): Promise<ScanResult> {
  return scanWithNetwork(url, options, { resolveHost: resolvePublicAddresses });
}

export async function scanWithNetwork(
  url: string,
  options: ScanOptions,
  network: CrawlerNetworkForTests,
  maxCheckTargets = MAX_CHECK_TARGETS,
): Promise<ScanResult> {
  const concurrency = boundedInteger(options.concurrency ?? DEFAULT_CONCURRENCY, "concurrency", 1, MAX_CONCURRENCY);
  const timeoutMs = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", 1, 120_000);
  const maxResponseBytes = boundedInteger(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, "maxResponseBytes", 1, 10 * 1024 * 1024);
  const targetLimit = boundedInteger(maxCheckTargets, "maxCheckTargets", 1, MAX_CHECK_TARGETS);
  const crawl = await crawlWithNetwork(url, options, network);
  const { targets, truncated } = collectTargets(crawl.pages, targetLimit);
  const knownResults = collectCrawlResults(crawl.pages);
  const pending = [...targets.values()].filter((target) => !knownResults.has(target.url));
  const checked = await mapConcurrent(pending, concurrency, async (target): Promise<CheckResult> => {
    try {
      const targetUrl = new URL(target.url);
      const resourceOnly = target.internalLinkSources.size === 0 && target.resourceSources.size > 0;
      const result = await loadPage(
        targetUrl,
        targetUrl.origin,
        network,
        timeoutMs,
        maxResponseBytes,
        resourceOnly,
      );
      return { statusCode: result.statusCode };
    } catch (error) {
      return {
        ...(error instanceof ResponseSizeLimitError ? { statusCode: error.statusCode } : {}),
        error: errorMessage(error),
      };
    }
  });
  for (let index = 0; index < pending.length; index += 1) {
    const target = pending[index];
    const result = checked[index];
    if (target !== undefined && result !== undefined) knownResults.set(target.url, result);
  }

  const findings: Finding[] = [];
  const httpErrorUrls = new Set<string>();
  for (const page of crawl.pages) {
    if ((page.statusCode !== undefined && page.statusCode >= 400) ||
      (page.statusCode === undefined && page.error !== undefined)) {
      const pageUrl = page.finalUrl ?? page.url;
      findings.push(createFinding(
        "http-error",
        pageUrl,
        page.statusCode === undefined ? `Page request failed: ${page.error}.` : `Received HTTP ${page.statusCode}.`,
        {
        ...(page.statusCode === undefined ? {} : { statusCode: page.statusCode }),
        sourceUrls: [page.url],
        ...(page.error === undefined ? {} : { error: page.error }),
        },
      ));
      httpErrorUrls.add(pageUrl);
    }
  }
  for (const target of targets.values()) {
    const result = knownResults.get(target.url);
    if (result === undefined) continue;
    const failed = result.error !== undefined ||
      (result.statusCode !== undefined && (result.statusCode < 200 || result.statusCode >= 400));
    const sourceUrls = [...target.internalLinkSources, ...[...target.resourceSources.values()].flatMap((sources) => [...sources])]
      .filter((source, index, all) => all.indexOf(source) === index)
      .sort();
    const evidence: FindingEvidence = {
      ...(result.statusCode === undefined ? {} : { statusCode: result.statusCode }),
      sourceUrls,
      ...(result.error === undefined ? {} : { error: result.error }),
    };

    if (result.statusCode !== undefined && result.statusCode >= 400 && !httpErrorUrls.has(target.url)) {
      findings.push(createFinding("http-error", target.url, `Received HTTP ${result.statusCode}.`, evidence));
      httpErrorUrls.add(target.url);
    }
    if (!failed) continue;
    if (target.internalLinkSources.size > 0) {
      findings.push(createFinding(
        "broken-internal-link",
        target.url,
        result.statusCode === undefined
          ? `Internal link could not be checked: ${result.error ?? "unknown error"}.`
          : `Internal link returned HTTP ${result.statusCode}.`,
        evidence,
      ));
    }
    for (const [resourceType, sources] of target.resourceSources) {
      const type = findingTypeForResource(resourceType);
      findings.push(createFinding(
        type,
        target.url,
        result.statusCode === undefined
          ? `${resourceLabel(resourceType)} could not be checked: ${result.error ?? "unknown error"}.`
          : `${resourceLabel(resourceType)} returned HTTP ${result.statusCode}.`,
        { ...evidence, sourceUrls: [...sources].sort() },
      ));
    }
  }

  findings.sort(compareFindings);
  return { ...crawl, findings, resourceChecksTruncated: truncated };
}

function collectTargets(pages: CrawlPage[], targetLimit: number): { targets: Map<string, TargetUse>; truncated: boolean } {
  const targets = new Map<string, TargetUse>();
  let truncated = false;
  const getTarget = (url: string): TargetUse | undefined => {
    let target = targets.get(url);
    if (target === undefined) {
      if (targets.size >= targetLimit) {
        truncated = true;
        return undefined;
      }
      target = { url, internalLinkSources: new Set(), resourceSources: new Map() };
      targets.set(url, target);
    }
    return target;
  };
  for (const page of pages) {
    for (const url of page.internalLinks) {
      const target = getTarget(url);
      target?.internalLinkSources.add(page.finalUrl ?? page.url);
    }
    for (const resource of page.resources) {
      const target = getTarget(resource.url);
      if (target === undefined) continue;
      let sources = target.resourceSources.get(resource.type);
      if (sources === undefined) {
        sources = new Set();
        target.resourceSources.set(resource.type, sources);
      }
      sources.add(page.finalUrl ?? page.url);
    }
  }
  return { targets, truncated };
}

function collectCrawlResults(pages: CrawlPage[]): Map<string, CheckResult> {
  const results = new Map<string, CheckResult>();
  for (const page of pages) {
    const result = {
      ...(page.statusCode === undefined ? {} : { statusCode: page.statusCode }),
      ...(page.error === undefined ? {} : { error: page.error }),
    };
    results.set(page.url, result);
    if (page.finalUrl !== undefined && !results.has(page.finalUrl)) results.set(page.finalUrl, result);
  }
  return results;
}

function findingTypeForResource(type: ResourceType): FindingType {
  switch (type) {
    case "image": return "broken-image";
    case "stylesheet": return "failed-stylesheet";
    case "script": return "failed-script";
  }
}

function resourceLabel(type: ResourceType): string {
  switch (type) {
    case "image": return "Image";
    case "stylesheet": return "Stylesheet";
    case "script": return "Script";
  }
}

function createFinding(type: FindingType, url: string, message: string, evidence: FindingEvidence): Finding {
  return { id: `${type}:${encodeURIComponent(url)}`, type, severity: "error", url, message, evidence };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      const item = items[index];
      if (item !== undefined) results[index] = await task(item);
    }
  });
  await Promise.all(workers);
  return results;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function compareFindings(left: Finding, right: Finding): number {
  return compareStrings(left.url, right.url) || compareStrings(left.type, right.type);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
