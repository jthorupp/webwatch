import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { parse, type DefaultTreeAdapterTypes } from "parse5";

const DEFAULT_MAX_PAGES = 100;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PAGES_LIMIT = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES_LIMIT = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_LINKS_PER_PAGE = 10_000;
const MAX_DISCOVERED_URLS = 50_000;

export interface CrawlOptions {
  maxPages?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface CrawlPage {
  url: string;
  finalUrl?: string;
  statusCode?: number;
  contentType?: string;
  links: string[];
  error?: string;
}

export interface CrawlStats {
  pagesVisited: number;
  pagesSucceeded: number;
  pagesFailed: number;
  linksFound: number;
  uniqueUrlsDiscovered: number;
  externalLinksSkipped: number;
  duplicateLinksSkipped: number;
  linksTruncated: number;
  redirectsFollowed: number;
  durationMs: number;
}

export interface CrawlResult {
  startUrl: string;
  discoveredUrls: string[];
  pages: CrawlPage[];
  stats: CrawlStats;
}

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Internal dependency seam used by local HTTP tests. Not re-exported from the package entry point. */
export interface CrawlerNetworkForTests {
  resolveHost(hostname: string): Promise<ResolvedAddress[]>;
  lookup?: LookupFunction;
}

interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

interface LoadedPage extends HttpResponse {
  finalUrl: string;
  redirectsFollowed: number;
}

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
  const maxPages = boundedInteger(options.maxPages ?? DEFAULT_MAX_PAGES, "maxPages", 1, MAX_PAGES_LIMIT);
  const timeoutMs = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs", 1, MAX_TIMEOUT_MS);
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    "maxResponseBytes",
    1,
    MAX_RESPONSE_BYTES_LIMIT,
  );
  const start = normalizeCrawlUrl(startUrl);
  const origin = start.origin;

  const startedAt = Date.now();
  await resolveAndValidate(start, network, timeoutMs);
  const queue = [start.href];
  const discovered = new Set(queue);
  const visitedFinalUrls = new Set<string>();
  const pages: CrawlPage[] = [];
  let linksFound = 0;
  let externalLinksSkipped = 0;
  let duplicateLinksSkipped = 0;
  let linksTruncated = 0;
  let redirectsFollowed = 0;

  while (queue.length > 0 && pages.length < maxPages) {
    const requestedUrl = queue.shift();
    if (requestedUrl === undefined) break;
    if (visitedFinalUrls.has(requestedUrl)) continue;

    try {
      const loaded = await loadPage(
        new URL(requestedUrl),
        origin,
        network,
        timeoutMs,
        maxResponseBytes,
      );
      redirectsFollowed += loaded.redirectsFollowed;
      visitedFinalUrls.add(loaded.finalUrl);
      if (!discovered.has(loaded.finalUrl)) {
        if (discovered.size < MAX_DISCOVERED_URLS) discovered.add(loaded.finalUrl);
        else linksTruncated += 1;
      }
      const page: CrawlPage = {
        url: requestedUrl,
        finalUrl: loaded.finalUrl,
        statusCode: loaded.statusCode,
        contentType: headerValue(loaded.headers["content-type"]),
        links: [],
      };
      const contentType = page.contentType?.toLowerCase() ?? "";

      if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
        const extracted = extractAnchorHrefs(loaded.body);
        linksFound += extracted.foundCount;
        linksTruncated += extracted.truncated;
        const baseUrl = resolveBaseUrl(extracted.baseHref, loaded.finalUrl);

        for (const href of extracted.hrefs) {
          const target = resolveCrawlLink(href, baseUrl);
          if (target === undefined) {
            externalLinksSkipped += 1;
            continue;
          }
          if (target.origin !== origin) {
            externalLinksSkipped += 1;
            continue;
          }

          const normalized = target.href;
          if (discovered.has(normalized)) {
            duplicateLinksSkipped += 1;
            continue;
          }
          if (discovered.size >= MAX_DISCOVERED_URLS) {
            linksTruncated += 1;
            continue;
          }
          discovered.add(normalized);
          page.links.push(normalized);
          queue.push(normalized);
        }
      }
      pages.push(page);
    } catch (error) {
      pages.push({
        url: requestedUrl,
        links: [],
        error: errorMessage(error),
      });
    }
  }

  const pagesSucceeded = pages.filter((page) => page.error === undefined).length;
  return {
    startUrl: start.href,
    discoveredUrls: [...discovered],
    pages,
    stats: {
      pagesVisited: pages.length,
      pagesSucceeded,
      pagesFailed: pages.length - pagesSucceeded,
      linksFound,
      uniqueUrlsDiscovered: discovered.size,
      externalLinksSkipped,
      duplicateLinksSkipped,
      linksTruncated,
      redirectsFollowed,
      durationMs: Date.now() - startedAt,
    },
  };
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function normalizeCrawlUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Invalid URL.");
  }
  assertHttpUrl(url);
  url.hash = "";
  return url;
}

function assertHttpUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Only HTTP and HTTPS URLs can be crawled.");
  }
  if (url.username.length > 0 || url.password.length > 0 || url.hostname.length === 0) {
    throw new TypeError("URL credentials and empty hostnames are not allowed.");
  }
}

async function resolveAndValidate(
  url: URL,
  network: CrawlerNetworkForTests,
  timeoutMs: number,
): Promise<ResolvedAddress[]> {
  assertHttpUrl(url);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isBlockedHostname(hostname)) {
    throw new Error(`Blocked internal network hostname: ${hostname}`);
  }

  const addresses = await withTimeout(network.resolveHost(hostname), timeoutMs, "DNS lookup");
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error(`Blocked non-public network destination: ${hostname}`);
  }
  return addresses;
}

async function resolvePublicAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const literalFamily = isIP(hostname);
  const addresses = literalFamily === 4 || literalFamily === 6
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
}

function isBlockedHostname(hostname: string): boolean {
  const blockedSuffixes = [".localhost", ".local", ".internal", ".home.arpa", ".test", ".invalid", ".onion"];
  return hostname === "localhost" || !hostname.includes(".") || blockedSuffixes.some((suffix) => hostname.endsWith(suffix));
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const value = (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
  const blocked: Array<[string, number]> = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
    ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
    ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
  ];
  return !blocked.some(([network, prefix]) => ipv4Matches(value, network, prefix));
}

function ipv4Matches(value: number, network: string, prefix: number): boolean {
  const base = network.split(".").map(Number).reduce((result, octet) => result * 256 + octet, 0) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
}

function isPublicIpv6(address: string): boolean {
  const words = expandIpv6(address);
  if (words === undefined) return false;
  const first = words[0];
  const second = words[1];
  // Only global unicast space (2000::/3) is eligible for crawling.
  if (first < 0x2000 || first > 0x3fff) return false;
  // Exclude IETF special-purpose, documentation, and 6to4 ranges.
  if (first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) return false;
  if (first === 0x2002) return false;
  if (first === 0x3fff && (words[1] & 0xf000) === 0) return false;
  return true;
}

function expandIpv6(address: string): number[] | undefined {
  let source = address.toLowerCase();
  if (source.includes("%")) return undefined;
  const lastColon = source.lastIndexOf(":");
  const embeddedIpv4 = source.slice(lastColon + 1);
  if (embeddedIpv4.includes(".")) {
    const octets = embeddedIpv4.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
    const firstWord = ((octets[0] << 8) | octets[1]).toString(16);
    const secondWord = ((octets[2] << 8) | octets[3]).toString(16);
    source = `${source.slice(0, lastColon)}:${firstWord}:${secondWord}`;
  }

  const halves = source.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] === "" ? [] : halves[0].split(":");
  const right = halves.length === 1 || halves[1] === "" ? [] : halves[1].split(":");
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined;
  const parts = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  return parts.map((part) => Number.parseInt(part, 16));
}

async function loadPage(
  initialUrl: URL,
  origin: string,
  network: CrawlerNetworkForTests,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<LoadedPage> {
  let url = initialUrl;
  const redirectChain = new Set([url.href]);

  for (let redirectCount = 0; ; redirectCount += 1) {
    const addresses = await resolveAndValidate(url, network, timeoutMs);
    const response = await requestOnce(url, addresses[0], network.lookup, timeoutMs, maxResponseBytes);
    const location = headerValue(response.headers.location);
    if (!isRedirect(response.statusCode) || location === undefined) {
      return { ...response, finalUrl: url.href, redirectsFollowed: redirectCount };
    }
    if (redirectCount >= MAX_REDIRECTS) throw new Error(`Too many redirects (maximum ${MAX_REDIRECTS}).`);

    const nextUrl = normalizeCrawlUrl(new URL(location, url).href);
    if (nextUrl.origin !== origin) {
      throw new Error(`Blocked cross-origin redirect to ${nextUrl.origin}.`);
    }
    if (redirectChain.has(nextUrl.href)) throw new Error("Redirect loop detected.");
    // The next iteration resolves and validates this redirect target before connecting.
    redirectChain.add(nextUrl.href);
    url = nextUrl;
  }
}

function requestOnce(
  url: URL,
  address: ResolvedAddress,
  injectedLookup: LookupFunction | undefined,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const clientRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    const finish = (error?: Error, response?: HttpResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error !== undefined) reject(error);
      else if (response !== undefined) resolve(response);
    };

    const request = clientRequest(url, {
      method: "GET",
      agent: false,
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "accept-encoding": "identity",
        "user-agent": "WebWatch/0.1 (+https://github.com/jthorupp/webwatch)",
      },
      lookup: injectedLookup ?? pinnedLookup(address),
    }, (response) => {
      const headers = response.headers as Record<string, string | string[] | undefined>;
      if (isRedirect(response.statusCode ?? 0)) {
        response.resume();
        finish(undefined, { statusCode: response.statusCode ?? 0, headers, body: "" });
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.byteLength;
        if (size > maxResponseBytes) {
          response.destroy();
          request.destroy();
          finish(new Error(`Response exceeded the ${maxResponseBytes} byte limit.`));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        finish(undefined, {
          statusCode: response.statusCode ?? 0,
          headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      response.on("error", (error) => finish(error));
    });

    const timeout = setTimeout(() => {
      request.destroy(new Error(`Request timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    timeout.unref();
    request.on("error", (error) => finish(error));
    request.end();
  });
}

function pinnedLookup(address: ResolvedAddress): LookupFunction {
  return ((_hostname: string, options: LookupOptions, callback: (...args: unknown[]) => void) => {
    if (options.all) callback(null, [{ address: address.address, family: address.family } satisfies LookupAddress]);
    else callback(null, address.address, address.family);
  }) as LookupFunction;
}

function isRedirect(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function extractAnchorHrefs(
  html: string,
): { hrefs: string[]; baseHref?: string; foundCount: number; truncated: number } {
  const document = parse(html);
  const hrefs: string[] = [];
  let baseHref: string | undefined;
  let foundCount = 0;
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ("tagName" in node) {
      if (node.tagName === "base" && baseHref === undefined) {
        baseHref = node.attrs.find((attribute) => attribute.name === "href")?.value;
      }
      if (node.tagName === "a") {
        const href = node.attrs.find((attribute) => attribute.name === "href")?.value;
        if (href !== undefined) {
          foundCount += 1;
          if (hrefs.length < MAX_LINKS_PER_PAGE) hrefs.push(href);
        }
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(document);
  return { hrefs, baseHref, foundCount, truncated: foundCount - hrefs.length };
}

function resolveBaseUrl(baseHref: string | undefined, finalUrl: string): URL {
  if (baseHref === undefined) return new URL(finalUrl);
  try {
    return new URL(baseHref, finalUrl);
  } catch {
    return new URL(finalUrl);
  }
}

function resolveCrawlLink(href: string, baseUrl: URL): URL | undefined {
  try {
    const target = new URL(href.trim(), baseUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") return undefined;
    if (target.username.length > 0 || target.password.length > 0) return undefined;
    target.hash = "";
    return target;
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms.`)), timeoutMs);
    timeout.unref();
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
