import { extractAnchorHrefs, resolveBaseUrl, resolveCrawlLink } from "./crawler/html.js";
import { headerValue, loadPage } from "./crawler/http.js";
import { boundedInteger, normalizeCrawlUrl, resolveAndValidate, resolvePublicAddresses } from "./crawler/url-safety.js";
import type { CrawlLimits, CrawlOptions, CrawlPage, CrawlResult, CrawlStats, CrawlerNetworkForTests } from "./crawler/types.js";

const DEFAULT_MAX_PAGES = 100;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PAGES_LIMIT = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES_LIMIT = 10 * 1024 * 1024;
const MAX_DISCOVERED_URLS = 50_000;

export type { CrawlOptions, CrawlPage, CrawlResult, CrawlStats } from "./crawler/types.js";
export { isPublicIpAddress } from "./crawler/url-safety.js";

export async function crawl(startUrl: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  return crawlWithNetwork(startUrl, options, {
    resolveHost: resolvePublicAddresses,
  });
}

export async function crawlWithNetwork(
  startUrl: string,
  options: CrawlOptions,
  network: CrawlerNetworkForTests,
): Promise<CrawlResult> {
  const limits = normalizeLimits(options);
  const start = normalizeCrawlUrl(startUrl);
  const origin = start.origin;
  const startedAt = Date.now();
  await resolveAndValidate(start, network, limits.timeoutMs);

  const queue = [start.href];
  const discovered = new Set(queue);
  const visitedFinalUrls = new Set<string>();
  const pages: CrawlPage[] = [];
  const stats = createEmptyStats();

  while (queue.length > 0 && pages.length < limits.maxPages) {
    const requestedUrl = queue.shift();
    if (requestedUrl === undefined) break;
    if (visitedFinalUrls.has(requestedUrl)) continue;

    try {
      const loaded = await loadPage(
        new URL(requestedUrl),
        origin,
        network,
        limits.timeoutMs,
        limits.maxResponseBytes,
      );
      stats.redirectsFollowed += loaded.redirectsFollowed;
      visitedFinalUrls.add(loaded.finalUrl);
      addRedirectDestination(loaded.finalUrl, discovered, stats);

      const page: CrawlPage = {
        url: requestedUrl,
        finalUrl: loaded.finalUrl,
        statusCode: loaded.statusCode,
        contentType: headerValue(loaded.headers["content-type"]),
        links: [],
      };
      collectPageLinks(page, loaded.body, origin, discovered, queue, stats);
      pages.push(page);
    } catch (error) {
      pages.push({ url: requestedUrl, links: [], error: errorMessage(error) });
    }
  }

  return createResult(start.href, pages, discovered, stats, startedAt);
}

function normalizeLimits(options: CrawlOptions): CrawlLimits {
  return {
    maxPages: boundedInteger(options.maxPages ?? DEFAULT_MAX_PAGES, "maxPages", 1, MAX_PAGES_LIMIT),
    timeoutMs: boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", 1, MAX_TIMEOUT_MS),
    maxResponseBytes: boundedInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
      1,
      MAX_RESPONSE_BYTES_LIMIT,
    ),
  };
}

function collectPageLinks(
  page: CrawlPage,
  body: string,
  origin: string,
  discovered: Set<string>,
  queue: string[],
  stats: CrawlStats,
): void {
  const contentType = page.contentType?.toLowerCase() ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) return;

  const extracted = extractAnchorHrefs(body);
  stats.linksFound += extracted.foundCount;
  stats.linksTruncated += extracted.truncated;
  const baseUrl = resolveBaseUrl(extracted.baseHref, page.finalUrl ?? page.url);

  for (const href of extracted.hrefs) {
    const target = resolveCrawlLink(href, baseUrl);
    if (target === undefined || target.origin !== origin) {
      stats.externalLinksSkipped += 1;
      continue;
    }

    const normalized = target.href;
    if (discovered.has(normalized)) {
      stats.duplicateLinksSkipped += 1;
      continue;
    }
    if (discovered.size >= MAX_DISCOVERED_URLS) {
      stats.linksTruncated += 1;
      continue;
    }

    discovered.add(normalized);
    page.links.push(normalized);
    queue.push(normalized);
  }
}

function addRedirectDestination(url: string, discovered: Set<string>, stats: CrawlStats): void {
  if (discovered.has(url)) return;
  if (discovered.size >= MAX_DISCOVERED_URLS) {
    stats.linksTruncated += 1;
    return;
  }
  discovered.add(url);
}

function createEmptyStats(): CrawlStats {
  return {
    pagesVisited: 0,
    pagesSucceeded: 0,
    pagesFailed: 0,
    linksFound: 0,
    uniqueUrlsDiscovered: 0,
    externalLinksSkipped: 0,
    duplicateLinksSkipped: 0,
    linksTruncated: 0,
    redirectsFollowed: 0,
    durationMs: 0,
  };
}

function createResult(
  startUrl: string,
  pages: CrawlPage[],
  discovered: Set<string>,
  stats: CrawlStats,
  startedAt: number,
): CrawlResult {
  stats.pagesVisited = pages.length;
  stats.pagesSucceeded = pages.filter((page) => page.error === undefined).length;
  stats.pagesFailed = stats.pagesVisited - stats.pagesSucceeded;
  stats.uniqueUrlsDiscovered = discovered.size;
  stats.durationMs = Date.now() - startedAt;
  return { startUrl, discoveredUrls: [...discovered], pages, stats };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
