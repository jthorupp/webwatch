import type { LookupFunction } from "node:net";
import type { ResourceType } from "./html.js";

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
  internalLinks: string[];
  resources: Array<{ type: ResourceType; url: string }>;
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

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Internal dependency seam used by local HTTP tests. Not re-exported from the package entry point. */
export interface CrawlerNetworkForTests {
  resolveHost(hostname: string): Promise<ResolvedAddress[]>;
  lookup?: LookupFunction;
}

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface LoadedPage extends HttpResponse {
  finalUrl: string;
  redirectsFollowed: number;
}

export interface CrawlLimits {
  maxPages: number;
  timeoutMs: number;
  maxResponseBytes: number;
}
